import { withOrg, withSystem } from '../db/pool';
import { randomToken, sha256 } from '../core/crypto';
import type { Ctx } from '../core/context';
import { resolvePolicy } from '@/lib/policy';
import { loadAccess } from '../services/rbac-load';

export const SESSION_COOKIE = 'plumeo_session';

export async function createSession(orgId: string, userId: string, method: 'password' | 'oidc', meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const row = await withOrg(orgId, async (tx) => {
    const policy = resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [orgId]))?.settings);
    return tx.one<{ id: string; expires_at: Date }>(
      `insert into sessions (org_id, user_id, token_hash, auth_method, expires_at, ip, user_agent)
       values ($1,$2,$3,$4, now() + make_interval(hours => $5), $6, $7) returning id, expires_at`,
      [orgId, userId, sha256(token), method, policy.security.sessionMaxHours, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300) || null]);
  });
  return { token, sessionId: row!.id, expiresAt: row!.expires_at };
}

/** Validate a session token and build the request context. Returns null for any invalid/expired/revoked session. */
export async function resolveSession(token: string | undefined | null, meta: { requestId: string; ip?: string; userAgent?: string }): Promise<Ctx | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const hash = sha256(token);
  return withSystem(async (tx) => {
    const s = await tx.one<any>(
      `select s.id, s.org_id, s.user_id, s.last_seen_at, u.full_name, p.settings
       from sessions s
       join users u on u.org_id = s.org_id and u.id = s.user_id
       join orgs o on o.id = s.org_id
       left join org_policies p on p.org_id = s.org_id
       where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
         and u.status = 'active' and o.status = 'active'`, [hash]);
    if (!s) return null;
    const policy = resolvePolicy(s.settings);
    if (Date.now() - new Date(s.last_seen_at).getTime() > policy.security.sessionIdleMinutes * 60_000) {
      await tx.exec('update sessions set revoked_at = now() where id = $1', [s.id]);
      return null;
    }
    if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
      await tx.exec('update sessions set last_seen_at = now() where id = $1', [s.id]);
    }
    const access = await loadAccess(tx, s.org_id, s.user_id);
    return {
      orgId: s.org_id, userId: s.user_id, userName: s.full_name, perms: access.perms, roleKeys: access.roleKeys,
      requestId: meta.requestId, actorType: 'user', sessionId: s.id, ip: meta.ip, userAgent: meta.userAgent,
    } satisfies Ctx;
  });
}

export async function revokeSession(orgId: string, sessionId: string) {
  await withOrg(orgId, (tx) => tx.exec('update sessions set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null', [orgId, sessionId]));
}

export async function revokeUserSessions(tx: { exec: (sql: string, p?: unknown[]) => Promise<number> }, orgId: string, userId: string, exceptSessionId?: string) {
  return tx.exec(
    `update sessions set revoked_at = now() where org_id = $1 and user_id = $2 and revoked_at is null and ($3::uuid is null or id <> $3)`,
    [orgId, userId, exceptSessionId ?? null]);
}

export async function listMySessions(ctx: Ctx) {
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select id, created_at, last_seen_at, expires_at, ip, user_agent, auth_method, (id = $3) as current
     from sessions where org_id = $1 and user_id = $2 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
    [ctx.orgId, ctx.userId, ctx.sessionId ?? null]));
}

export function tokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
