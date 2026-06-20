import 'server-only';

/*
 * Notification delivery. The app writes notification rows un-sent; this module
 * actually ships the external channels (MS Teams, email) and records an honest
 * result back onto the row: sent_at on success, delivery_error + attempts on
 * failure. In-app notifications need no delivery — they're read straight from
 * the table — so they're ignored here.
 *
 * Transports are configured by environment variable and degrade cleanly: with
 * nothing configured, rows simply stay queued and the notification centre shows
 * them as un-sent rather than pretending they were delivered.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/result';

const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;
const EMAIL_WEBHOOK_URL = process.env.EMAIL_WEBHOOK_URL;

export function isDeliveryConfigured(): boolean {
  return Boolean(TEAMS_WEBHOOK_URL || EMAIL_WEBHOOK_URL);
}

type DeliverableRow = {
  id: string;
  channel: 'Email' | 'Teams' | 'InApp';
  subject: string;
  body: string;
  deep_link: string | null;
  recipient?: { upn: string | null; full_name: string | null } | null;
};

/** MS Teams "MessageCard" payload — the shape an incoming webhook expects. */
function teamsCard(row: DeliverableRow) {
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: '7c4dff',
    summary: row.subject,
    title: row.subject,
    text: row.body,
    potentialAction: row.deep_link
      ? [{
          '@type': 'OpenUri',
          name: 'Open in Plumeo',
          targets: [{ os: 'default', uri: absoluteLink(row.deep_link) }],
        }]
      : [],
  };
}

function absoluteLink(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

async function ship(row: DeliverableRow): Promise<{ ok: boolean; error?: string }> {
  try {
    if (row.channel === 'Teams') {
      if (!TEAMS_WEBHOOK_URL) return { ok: false, error: 'TEAMS_WEBHOOK_URL not configured' };
      const res = await fetch(TEAMS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamsCard(row)),
      });
      return res.ok ? { ok: true } : { ok: false, error: `Teams webhook responded ${res.status}` };
    }

    if (row.channel === 'Email') {
      if (!EMAIL_WEBHOOK_URL) return { ok: false, error: 'EMAIL_WEBHOOK_URL not configured' };
      const res = await fetch(EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: row.recipient?.upn,
          name: row.recipient?.full_name,
          subject: row.subject,
          text: row.body,
          link: row.deep_link ? absoluteLink(row.deep_link) : null,
        }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `Email relay responded ${res.status}` };
    }

    return { ok: false, error: `Channel ${row.channel} needs no delivery` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Drain queued Email/Teams notifications. Safe to call repeatedly (idempotent)
 * and never throws — returns counts so callers can log without try/catch.
 */
export async function deliverNotifications(limit = 50): Promise<{ delivered: number; failed: number }> {
  if (!isDeliveryConfigured()) return { delivered: 0, failed: 0 };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { delivered: 0, failed: 0 };
  }

  const { data: rows } = await admin
    .from('notifications')
    .select('id, channel, subject, body, deep_link, recipient:users!notifications_recipient_id_fkey(upn, full_name)')
    .is('sent_at', null)
    .in('channel', ['Email', 'Teams'])
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (!rows || rows.length === 0) return { delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  for (const row of rows as unknown as DeliverableRow[]) {
    const result = await ship(row);
    if (result.ok) {
      await admin
        .from('notifications')
        .update({ sent_at: new Date().toISOString(), delivery_error: null })
        .eq('id', row.id);
      delivered++;
    } else {
      // bump attempts and record the latest error, leaving sent_at null for retry
      const { data: current } = await admin.from('notifications').select('attempts').eq('id', row.id).single();
      await admin
        .from('notifications')
        .update({ delivery_error: result.error, attempts: (current?.attempts ?? 0) + 1 })
        .eq('id', row.id);
      failed++;
    }
  }
  return { delivered, failed };
}
