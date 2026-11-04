import { withOrg, withSystem } from '../db/pool';
import { hashPassword, passwordProblem, randomToken, sha256, verifyPassword } from '../core/crypto';
import { AppError, conflict, invalid } from '../core/errors';
import type { Ctx } from '../core/context';
import { audit } from '../services/audit';
import { createSession, revokeUserSessions } from './sessions';
import { rateLimit } from './ratelimit';
import { resolvePolicy } from '@/lib/policy';

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

export interface LoginMeta { ip?: string; userAgent?: string; requestId: string }

/** The same generic error for every credential failure so accounts/orgs cannot be enumerated. */
const badCreds = () => new AppError('unauthenticated', 'Incorrect organisation, email or password.');

export async function loginWithPassword(input: { orgSlug: string; email: string; password: string }, meta: LoginMeta) {
  const slug = input.orgSlug.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  if (!slug || !email || !input.password || input.password.length > 500) throw badCreds();
  await rateLimit('login-ip', meta.ip ?? 'unknown', 60, 600);
  await rateLimit('login-acct', `${slug}|${email}`, 10, 600);

  const org = await withSystem((tx) => tx.one<{ id: string; status: string }>('select id, status from orgs where slug = $1', [slug]));
  if (!org || org.status !== 'active') {
    await verifyPassword(input.password, null); // equalise timing
    throw badCreds();
  }
  const ctxBase: Ctx = { orgId: org.id, userId: '', userName: '', perms: new Set(), roleKeys: [], requestId: meta.requestId, actorType: 'user', ip: meta.ip };

  const user = await withOrg(org.id, (tx) => tx.one<any>(
    `select id, full_name, status, password_hash, failed_login_count, locked_until from users where org_id = $1 and email = $2`, [org.id, email]));
  const okPw = await verifyPassword(input.password, user?.password_hash ?? null);

  if (!user || user.status !== 'active') { await verifyPassword(input.password, null); throw badCreds(); }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError('unauthenticated', 'This account is temporarily locked after repeated failed sign-ins. Try again later or reset your password.');
  }

  if (!okPw) {
    await withOrg(org.id, async (tx) => {
      const r = await tx.one<{ failed_login_count: number }>(
        `update users set failed_login_count = failed_login_count + 1,
           locked_until = case when failed_login_count + 1 >= $3 then now() + make_interval(mins => $4) else locked_until end
         where org_id = $1 and id = $2 returning failed_login_count`, [org.id, user.id, LOCK_AFTER, LOCK_MINUTES]);
      await audit(tx, { ...ctxBase, userId: user.id, userName: user.full_name }, {
        action: 'auth.login_failed', entityType: 'user', entityId: user.id, metadata: { failures: r!.failed_login_count },
      });
    });
    throw badCreds();
  }

  const sso = await withOrg(org.id, async (tx) => {
    const idp = await tx.one<{ enforce_sso: boolean; enabled: boolean }>('select enforce_sso, enabled from identity_providers where org_id = $1', [org.id]);
    if (!idp?.enabled || !idp.enforce_sso) return false;
    // Org admins keep a password break-glass path so a broken IdP cannot lock the tenant out.
    const admin = await tx.one(`select 1 from user_roles ur join roles r on r.org_id = ur.org_id and r.id = ur.role_id
      where ur.org_id = $1 and ur.user_id = $2 and r.key = 'org_admin'`, [org.id, user.id]);
    return !admin;
  });
  if (sso) throw new AppError('forbidden', 'Your organisation requires single sign-on. Use "Sign in with SSO".');

  const session = await createSession(org.id, user.id, 'password', meta);
  await withOrg(org.id, async (tx) => {
    await tx.exec('update users set failed_login_count = 0, locked_until = null, last_login_at = now() where org_id = $1 and id = $2', [org.id, user.id]);
    await audit(tx, { ...ctxBase, userId: user.id, userName: user.full_name }, { action: 'auth.login', entityType: 'user', entityId: user.id, metadata: { method: 'password' } });
  });
  return { ...session, userId: user.id, orgId: org.id };
}

export async function logout(ctx: Ctx) {
  if (!ctx.sessionId) return;
  await withOrg(ctx.orgId, async (tx) => {
    await tx.exec('update sessions set revoked_at = now() where org_id = $1 and id = $2', [ctx.orgId, ctx.sessionId]);
    await audit(tx, ctx, { action: 'auth.logout', entityType: 'user', entityId: ctx.userId });
  });
}

// ---- credentials: invitations, resets, password change ----

export async function issueCredentialToken(tx: import('../db/pool').Tx, orgId: string, userId: string, purpose: 'invite' | 'reset', createdBy: string | null) {
  const token = randomToken(32);
  // one live token per user+purpose
  await tx.exec(`update credential_tokens set used_at = now() where org_id = $1 and user_id = $2 and purpose = $3 and used_at is null`, [orgId, userId, purpose]);
  await tx.exec(
    `insert into credential_tokens (org_id, user_id, purpose, token_hash, expires_at, created_by)
     values ($1,$2,$3,$4, now() + make_interval(hours => $5), $6)`,
    [orgId, userId, purpose, sha256(token), purpose === 'invite' ? 24 * 7 : 2, createdBy]);
  return token;
}

/** Consume an invite / reset token and set the password. Unauthenticated by design; the token is the credential. */
export async function redeemCredentialToken(input: { token: string; password: string }, meta: LoginMeta) {
  await rateLimit('redeem-ip', meta.ip ?? 'unknown', 20, 600);
  const prob = passwordProblem(input.password);
  if (prob) throw invalid(prob);
  const hash = sha256(input.token);
  const found = await withSystem((tx) => tx.one<{ id: string; org_id: string; user_id: string; purpose: string }>(
    `select id, org_id, user_id, purpose from credential_tokens where token_hash = $1 and used_at is null and expires_at > now()`, [hash]));
  if (!found) throw new AppError('unauthenticated', 'This link is invalid or has expired. Ask for a new one.');
  const pwHash = await hashPassword(input.password);
  await withOrg(found.org_id, async (tx) => {
    // claim the token atomically: a second concurrent use gets 0 rows
    const claimed = await tx.exec('update credential_tokens set used_at = now() where id = $1 and used_at is null', [found.id]);
    if (!claimed) throw conflict('This link has already been used.');
    const u = await tx.one<{ id: string; full_name: string; status: string }>('select id, full_name, status from users where org_id = $1 and id = $2 for update', [found.org_id, found.user_id]);
    if (!u || !['active', 'invited'].includes(u.status)) throw new AppError('forbidden', 'This account cannot be activated.');
    await tx.exec(`update users set password_hash = $3, password_changed_at = now(), status = 'active', failed_login_count = 0, locked_until = null where org_id = $1 and id = $2`,
      [found.org_id, found.user_id, pwHash]);
    await revokeUserSessions(tx, found.org_id, found.user_id);
    await audit(tx, { orgId: found.org_id, userId: found.user_id, userName: u.full_name, perms: new Set(), roleKeys: [], requestId: meta.requestId, actorType: 'user', ip: meta.ip },
      { action: found.purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset', entityType: 'user', entityId: found.user_id });
  });
  return { orgId: found.org_id, userId: found.user_id };
}

export async function changeOwnPassword(ctx: Ctx, input: { current: string; next: string }) {
  const prob = passwordProblem(input.next);
  if (prob) throw invalid(prob);
  await rateLimit('pwchange', ctx.userId, 10, 600);
  return withOrg(ctx.orgId, async (tx) => {
    const u = await tx.one<{ password_hash: string | null }>('select password_hash from users where org_id = $1 and id = $2 for update', [ctx.orgId, ctx.userId]);
    if (!(await verifyPassword(input.current, u?.password_hash ?? null))) throw new AppError('forbidden', 'Your current password is incorrect.');
    await tx.exec('update users set password_hash = $3, password_changed_at = now() where org_id = $1 and id = $2', [ctx.orgId, ctx.userId, await hashPassword(input.next)]);
    const revoked = await revokeUserSessions(tx, ctx.orgId, ctx.userId, ctx.sessionId);
    await audit(tx, ctx, { action: 'auth.password_changed', entityType: 'user', entityId: ctx.userId, metadata: { otherSessionsRevoked: revoked } });
    return { otherSessionsRevoked: revoked };
  });
}

export { resolvePolicy };
