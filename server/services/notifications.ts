import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg, withSystem } from '../db/pool';
import { type Ctx } from '../core/context';
import { pageParams, parse, uuid } from '../core/validation';
import { config } from '../core/config';
import { decryptSecret } from '../core/crypto';
import { logger } from '../core/logger';
import { escapeHtml, mailEnabled, sendMail } from './mailer';

export const CATEGORIES = ['approvals', 'goals', 'checkins', 'feedback', 'org'] as const;
export type Category = typeof CATEGORIES[number];

export interface NotifyInput {
  userId: string; category: Category; type: string; title: string; body: string; link?: string;
  entityType?: string; entityId?: string; dedupeKey?: string;
}

/**
 * Create an in-app notification (and queue an email) in the CALLER'S transaction — if the
 * business change rolls back, so does the notification. `dedupeKey` makes it idempotent.
 * Returns false when it was a duplicate.
 */
export async function notify(tx: Tx, ctx: Pick<Ctx, 'orgId'>, n: NotifyInput): Promise<boolean> {
  const pref = await tx.one<{ in_app: boolean; email: boolean }>(
    'select in_app, email from notification_preferences where org_id = $1 and user_id = $2 and category = $3', [ctx.orgId, n.userId, n.category]);
  const inApp = pref?.in_app ?? true;
  const email = (pref?.email ?? true) && mailEnabled();
  let notificationId: string | null = null;
  if (inApp) {
    const row = await tx.one<{ id: string }>(
      `insert into notifications (org_id, user_id, category, type, title, body, link, entity_type, entity_id, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing returning id`,
      [ctx.orgId, n.userId, n.category, n.type, n.title, n.body, n.link ?? null, n.entityType ?? null, n.entityId ?? null, n.dedupeKey ?? null]);
    if (!row) return false;
    notificationId = row.id;
  }
  if (email) {
    await tx.exec(
      `insert into notification_deliveries (org_id, channel, notification_id, user_id, payload, dedupe_key)
       values ($1,'email',$2,$3,$4,$5) on conflict do nothing`,
      [ctx.orgId, notificationId, n.userId, JSON.stringify({ subject: n.title, text: n.body, link: n.link ?? null }),
       n.dedupeKey ? `${n.userId}:${n.dedupeKey}` : notificationId ? `n:${notificationId}` : null]);
  }
  return true;
}

/** Broadcast an organisation-level event (never personal data) to subscribed Slack/Teams webhooks. */
export async function publishOrgEvent(tx: Tx, ctx: Pick<Ctx, 'orgId'>, e: { event: string; text: string; link?: string; dedupeKey: string }) {
  const targets = await tx.query<{ id: string; kind: string }>(
    `select id, kind from webhook_integrations where org_id = $1 and enabled and $2 = any(events)`, [ctx.orgId, e.event]);
  for (const t of targets) {
    await tx.exec(
      `insert into notification_deliveries (org_id, channel, integration_id, payload, dedupe_key) values ($1,$2,$3,$4,$5) on conflict do nothing`,
      [ctx.orgId, t.kind, t.id, JSON.stringify({ text: e.text, link: e.link ?? null }), `${t.id}:${e.dedupeKey}`]);
  }
  return targets.length;
}

export async function listNotifications(ctx: Ctx, q: { unreadOnly?: boolean; limit?: number; offset?: number }) {
  const { limit, offset } = parse(pageParams, { limit: q.limit, offset: q.offset });
  return withOrg(ctx.orgId, async (tx) => {
    const w = `org_id = $1 and user_id = $2 ${q.unreadOnly ? 'and read_at is null' : ''}`;
    const total = (await tx.one<{ n: number }>(`select count(*)::int as n from notifications where ${w}`, [ctx.orgId, ctx.userId]))!.n;
    const unread = (await tx.one<{ n: number }>(`select count(*)::int as n from notifications where org_id = $1 and user_id = $2 and read_at is null`, [ctx.orgId, ctx.userId]))!.n;
    const data = await tx.query(
      `select id, category, type, title, body, link, entity_type, entity_id, read_at, created_at from notifications where ${w}
       order by created_at desc limit ${limit} offset ${offset}`, [ctx.orgId, ctx.userId]);
    return { data, page: { limit, offset, total }, unread };
  });
}

export async function markRead(ctx: Ctx, ids: string[] | 'all') {
  return withOrg(ctx.orgId, async (tx) => {
    if (ids === 'all') return { updated: await tx.exec('update notifications set read_at = now() where org_id = $1 and user_id = $2 and read_at is null', [ctx.orgId, ctx.userId]) };
    ids.forEach((i) => parse(uuid, i));
    return { updated: await tx.exec('update notifications set read_at = now() where org_id = $1 and user_id = $2 and read_at is null and id = any($3::uuid[])', [ctx.orgId, ctx.userId, ids]) };
  });
}

export async function getPreferences(ctx: Ctx) {
  return withOrg(ctx.orgId, async (tx) => {
    const rows = await tx.query<{ category: string; in_app: boolean; email: boolean }>('select category, in_app, email from notification_preferences where org_id = $1 and user_id = $2', [ctx.orgId, ctx.userId]);
    return CATEGORIES.map((c) => ({ category: c, in_app: rows.find((r) => r.category === c)?.in_app ?? true, email: rows.find((r) => r.category === c)?.email ?? true, emailAvailable: mailEnabled() }));
  });
}

export async function setPreferences(ctx: Ctx, input: unknown) {
  const items = parse(z.array(z.object({ category: z.enum(CATEGORIES), in_app: z.boolean(), email: z.boolean() }).strict()).max(10), input);
  return withOrg(ctx.orgId, async (tx) => {
    for (const i of items) {
      await tx.exec(`insert into notification_preferences (org_id, user_id, category, in_app, email) values ($1,$2,$3,$4,$5)
        on conflict (user_id, category) do update set in_app = excluded.in_app, email = excluded.email`, [ctx.orgId, ctx.userId, i.category, i.in_app, i.email]);
    }
    return { ok: true };
  });
}

// --------------------------------------------------------------------------
// Delivery worker (email + chat webhooks). Safe to run on many instances at once.
// --------------------------------------------------------------------------

const BACKOFF_MIN = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = 6;

export function webhookHostAllowed(kind: 'slack' | 'teams', rawUrl: string): boolean {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return false; }
  const extra = config().webhookExtraHosts;
  if (extra.includes(u.host)) return u.protocol === 'https:' || u.protocol === 'http:';
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (kind === 'slack') return h === 'hooks.slack.com';
  return /(^|\.)webhook\.office\.com$/.test(h) || /(^|\.)logic\.azure\.com$/.test(h) || /(^|\.)powerplatform\.com$/.test(h) || h === 'outlook.office.com';
}

function chatBody(kind: string, p: { text: string; link?: string | null }) {
  const text = p.link ? `${p.text}\n${config().APP_URL}${p.link}` : p.text;
  if (kind === 'slack') return { text };
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text, wrap: true }] } }] };
}

interface Claimed { id: string; org_id: string; channel: string; payload: any; attempts: number; email: string | null; user_name: string | null; url_enc: string | null }

/** Claims a batch with FOR UPDATE SKIP LOCKED, delivers outside the transaction, records the outcome. */
export async function processDeliveries(limit = 50, now = new Date()) {
  const batch = await withSystem((tx) => tx.query<Claimed>(
    `with due as (
       select d.id from notification_deliveries d
       where d.status in ('pending', 'failed') and d.next_attempt_at <= $2 and (d.locked_until is null or d.locked_until < $2)
       order by d.next_attempt_at limit $1 for update skip locked)
     update notification_deliveries d set locked_until = $2::timestamptz + interval '5 minutes', attempts = d.attempts + 1
       from due where d.id = due.id
     returning d.id, d.org_id, d.channel, d.payload, d.attempts,
       (select u.email from users u where u.org_id = d.org_id and u.id = d.user_id and u.status in ('active','invited')) as email,
       (select u.full_name from users u where u.org_id = d.org_id and u.id = d.user_id) as user_name,
       (select w.url_enc from webhook_integrations w where w.org_id = d.org_id and w.id = d.integration_id and w.enabled) as url_enc`, [limit, now]));
  const stats = { sent: 0, failed: 0, dead: 0, skipped: 0 };
  for (const d of batch) {
    let outcome: 'sent' | 'skipped' | 'failed'; let error: string | null = null;
    try {
      if (d.channel === 'email') {
        if (!d.email) outcome = 'skipped', error = 'recipient unavailable';
        else if (!mailEnabled()) outcome = 'skipped', error = 'SMTP not configured';
        else {
          const link = d.payload.link ? `${config().APP_URL}${d.payload.link}` : null;
          await sendMail({ to: d.email, subject: d.payload.subject, text: link ? `${d.payload.text}\n\n${link}` : d.payload.text,
            html: `<p>${escapeHtml(d.payload.text).replace(/\n/g, '<br>')}</p>${link ? `<p><a href="${escapeHtml(link)}">Open in Plumeo</a></p>` : ''}` });
          outcome = 'sent';
        }
      } else {
        if (!d.url_enc) outcome = 'skipped', error = 'integration disabled or removed';
        else {
          const url = decryptSecret(d.url_enc);
          if (!webhookHostAllowed(d.channel as 'slack' | 'teams', url)) throw new Error('webhook host not allowed');
          const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chatBody(d.channel, d.payload)), redirect: 'manual', signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`webhook responded ${res.status}`);
          outcome = 'sent';
        }
      }
    } catch (e: any) {
      outcome = 'failed'; error = String(e?.message ?? e).slice(0, 300);
    }
    await withSystem(async (tx) => {
      if (outcome === 'sent' || outcome === 'skipped') {
        await tx.exec(`update notification_deliveries set status = $2, last_error = $3, sent_at = case when $2 = 'sent' then now() else null end, locked_until = null, payload = case when payload ? 'sensitive' then '{"redacted":true}'::jsonb else payload end where id = $1`, [d.id, outcome, error]);
        stats[outcome === 'sent' ? 'sent' : 'skipped']++;
      } else if (d.attempts >= MAX_ATTEMPTS) {
        await tx.exec(`update notification_deliveries set status = 'dead', last_error = $2, locked_until = null where id = $1`, [d.id, error]);
        stats.dead++;
      } else {
        await tx.exec(`update notification_deliveries set status = 'failed', last_error = $2, locked_until = null, next_attempt_at = $4::timestamptz + make_interval(mins => $3) where id = $1`,
          [d.id, error, BACKOFF_MIN[Math.min(d.attempts - 1, BACKOFF_MIN.length - 1)], now]);
        stats.failed++;
        logger.warn('delivery.failed', { id: d.id, channel: d.channel, attempts: d.attempts, error });
      }
    });
  }
  return { claimed: batch.length, ...stats };
}

export async function deliveryStats(ctx: Ctx) {
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select channel, status, count(*)::int as n from notification_deliveries where org_id = $1 group by channel, status order by channel, status`, [ctx.orgId]));
}
