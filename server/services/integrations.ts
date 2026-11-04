import { z } from 'zod';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm } from '../core/context';
import { conflict, invalid, notFound } from '../core/errors';
import { parse, uuid } from '../core/validation';
import { config } from '../core/config';
import { encryptSecret, randomToken, sha256 } from '../core/crypto';
import { audit } from './audit';
import { webhookHostAllowed } from './notifications';

export const WEBHOOK_EVENTS = ['goal.activated', 'goal.completed'] as const;

// ---- Identity provider (OIDC) ----

const idpSchema = z.object({
  issuer: z.string().trim().url().max(300),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().min(1).max(500).optional(),
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
  jitProvisioning: z.boolean().default(false),
  enforceSso: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).strict();

export function assertIssuerAllowed(issuer: string) {
  const u = new URL(issuer);
  if (u.protocol !== 'https:' && !(config().oidcAllowHttp && u.protocol === 'http:')) throw invalid('The issuer must use https.');
  if (u.username || u.password || u.hash) throw invalid('Invalid issuer URL.');
}

export async function getIdentityProvider(ctx: Ctx) {
  requirePerm(ctx, 'integrations.manage');
  return withOrg(ctx.orgId, (tx) => tx.one(
    `select id, kind, issuer, client_id, scopes, allowed_domains, jit_provisioning, enforce_sso, enabled, (client_secret_enc is not null) as has_secret, updated_at from identity_providers where org_id = $1`, [ctx.orgId]));
}

export async function saveIdentityProvider(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'integrations.manage');
  const d = parse(idpSchema, input);
  assertIssuerAllowed(d.issuer);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from identity_providers where org_id = $1', [ctx.orgId]);
    if (!cur && !d.clientSecret) throw invalid('A client secret is required.');
    const secret = d.clientSecret ? encryptSecret(d.clientSecret) : cur.client_secret_enc;
    if (d.enforceSso && d.enabled) {
      // Never lock everyone out: SSO can only be enforced once the admin has proven SSO works for them.
      const linked = await tx.one(`select 1 from users where org_id = $1 and oidc_subject is not null limit 1`, [ctx.orgId]);
      if (!linked) throw conflict('Sign in with SSO at least once before enforcing it, so you cannot lock yourself out.');
    }
    await tx.exec(
      `insert into identity_providers (org_id, issuer, client_id, client_secret_enc, allowed_domains, jit_provisioning, enforce_sso, enabled)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (org_id) do update set issuer = excluded.issuer, client_id = excluded.client_id, client_secret_enc = excluded.client_secret_enc,
         allowed_domains = excluded.allowed_domains, jit_provisioning = excluded.jit_provisioning, enforce_sso = excluded.enforce_sso, enabled = excluded.enabled, updated_at = now()`,
      [ctx.orgId, d.issuer.replace(/\/$/, ''), d.clientId, secret, d.allowedDomains, d.jitProvisioning, d.enforceSso, d.enabled]);
    await audit(tx, ctx, { action: 'idp.configured', entityType: 'integration', entityId: ctx.orgId,
      before: cur ? { issuer: cur.issuer, enforce_sso: cur.enforce_sso, enabled: cur.enabled } : undefined,
      after: { issuer: d.issuer, clientId: d.clientId, allowedDomains: d.allowedDomains, jit: d.jitProvisioning, enforce: d.enforceSso, enabled: d.enabled, secretChanged: !!d.clientSecret } });
    return { ok: true };
  });
}

export async function removeIdentityProvider(ctx: Ctx) {
  requirePerm(ctx, 'integrations.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const n = await tx.exec('delete from identity_providers where org_id = $1', [ctx.orgId]);
    if (n) await audit(tx, ctx, { action: 'idp.removed', entityType: 'integration', entityId: ctx.orgId });
    return { ok: true };
  });
}

// ---- SCIM tokens ----

export async function createScimToken(ctx: Ctx, name: unknown) {
  requirePerm(ctx, 'integrations.manage');
  const n = parse(z.string().trim().min(2).max(80), name);
  const token = `plm_scim_${randomToken(32)}`;
  return withOrg(ctx.orgId, async (tx) => {
    const row = await tx.one<{ id: string }>('insert into scim_tokens (org_id, name, token_hash, created_by) values ($1,$2,$3,$4) returning id', [ctx.orgId, n, sha256(token), ctx.userId]);
    await audit(tx, ctx, { action: 'scim.token_created', entityType: 'integration', entityId: row!.id, after: { name: n } });
    return { id: row!.id, token };   // shown exactly once
  });
}

export async function listScimTokens(ctx: Ctx) {
  requirePerm(ctx, 'integrations.manage');
  return withOrg(ctx.orgId, (tx) => tx.query('select id, name, created_at, last_used_at, revoked_at from scim_tokens where org_id = $1 order by created_at desc', [ctx.orgId]));
}

export async function revokeScimToken(ctx: Ctx, id: string) {
  requirePerm(ctx, 'integrations.manage');
  parse(uuid, id);
  return withOrg(ctx.orgId, async (tx) => {
    const n = await tx.exec('update scim_tokens set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null', [ctx.orgId, id]);
    if (!n) throw notFound('Token');
    await audit(tx, ctx, { action: 'scim.token_revoked', entityType: 'integration', entityId: id });
    return { ok: true };
  });
}

// ---- Chat webhooks (Slack / Teams) ----

const webhookSchema = z.object({
  kind: z.enum(['slack', 'teams']),
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(1000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
}).strict();

export async function createWebhook(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'integrations.manage');
  const d = parse(webhookSchema, input);
  if (!webhookHostAllowed(d.kind, d.url)) {
    throw invalid(d.kind === 'slack' ? 'Use a Slack incoming-webhook URL (https://hooks.slack.com/...).' : 'Use a Microsoft Teams Workflows / incoming-webhook URL (https://*.webhook.office.com/... or *.logic.azure.com).');
  }
  return withOrg(ctx.orgId, async (tx) => {
    const row = await tx.one<{ id: string }>(
      `insert into webhook_integrations (org_id, kind, name, url_enc, url_hint, events, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [ctx.orgId, d.kind, d.name, encryptSecret(d.url), new URL(d.url).host, d.events, ctx.userId]);
    await audit(tx, ctx, { action: 'webhook.created', entityType: 'integration', entityId: row!.id, after: { kind: d.kind, name: d.name, events: d.events, host: new URL(d.url).host } });
    return { id: row!.id };
  });
}

export async function listWebhooks(ctx: Ctx) {
  requirePerm(ctx, 'integrations.manage');
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select w.id, w.kind, w.name, w.url_hint, w.events, w.enabled, w.created_at,
       (select count(*)::int from notification_deliveries d where d.org_id = w.org_id and d.integration_id = w.id and d.status = 'sent') as sent,
       (select count(*)::int from notification_deliveries d where d.org_id = w.org_id and d.integration_id = w.id and d.status in ('failed','dead')) as failed
     from webhook_integrations w where w.org_id = $1 order by w.created_at desc`, [ctx.orgId]));
}

export async function setWebhookEnabled(ctx: Ctx, id: string, enabled: boolean) {
  requirePerm(ctx, 'integrations.manage');
  parse(uuid, id);
  return withOrg(ctx.orgId, async (tx) => {
    const n = await tx.exec('update webhook_integrations set enabled = $3 where org_id = $1 and id = $2', [ctx.orgId, id, enabled]);
    if (!n) throw notFound('Integration');
    await audit(tx, ctx, { action: enabled ? 'webhook.enabled' : 'webhook.disabled', entityType: 'integration', entityId: id });
    return { ok: true };
  });
}

export async function deleteWebhook(ctx: Ctx, id: string) {
  requirePerm(ctx, 'integrations.manage');
  parse(uuid, id);
  return withOrg(ctx.orgId, async (tx) => {
    await tx.exec(`update notification_deliveries set integration_id = null, status = 'skipped' where org_id = $1 and integration_id = $2 and status in ('pending','failed')`, [ctx.orgId, id]);
    const n = await tx.exec('delete from webhook_integrations where org_id = $1 and id = $2', [ctx.orgId, id]);
    if (!n) throw notFound('Integration');
    await audit(tx, ctx, { action: 'webhook.deleted', entityType: 'integration', entityId: id });
    return { ok: true };
  });
}

export async function sendWebhookTest(ctx: Ctx, id: string) {
  requirePerm(ctx, 'integrations.manage');
  parse(uuid, id);
  return withOrg(ctx.orgId, async (tx) => {
    const w = await tx.one<{ kind: string }>('select kind from webhook_integrations where org_id = $1 and id = $2', [ctx.orgId, id]);
    if (!w) throw notFound('Integration');
    await tx.exec(`insert into notification_deliveries (org_id, channel, integration_id, payload, dedupe_key) values ($1,$2,$3,$4,$5)`,
      [ctx.orgId, w.kind, id, JSON.stringify({ text: 'Plumeo test message — your integration is connected.' }), `${id}:test:${Date.now()}`]);
    return { queued: true };
  });
}
