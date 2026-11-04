import { withSystem } from '../db/pool';
import { AppError } from '../core/errors';
import { hashPassword, passwordProblem, randomToken, sha256, verifyPassword } from '../core/crypto';
import { rateLimit } from './ratelimit';

export const PLATFORM_COOKIE = 'plumeo_platform';

/** Super administrators operate the platform (create / suspend organisations). They have no access to tenant data. */
export async function createPlatformAdmin(email: string, fullName: string, password: string) {
  const prob = passwordProblem(password, 14);
  if (prob) throw new AppError('validation_failed', prob);
  const hash = await hashPassword(password);
  return withSystem((tx) => tx.one<{ id: string }>(
    `insert into platform_admins (email, full_name, password_hash) values ($1,$2,$3) on conflict (email) do update set password_hash = excluded.password_hash returning id`,
    [email.toLowerCase(), fullName, hash]));
}

export async function platformLogin(email: string, password: string, ip: string) {
  await rateLimit('platform-login', ip, 10, 600);
  await rateLimit('platform-login-acct', email.toLowerCase(), 8, 600);
  const admin = await withSystem((tx) => tx.one<any>('select id, password_hash, locked_until from platform_admins where email = $1', [email.toLowerCase()]));
  const ok = await verifyPassword(password, admin?.password_hash ?? null);
  if (!admin || !ok || (admin.locked_until && new Date(admin.locked_until) > new Date())) throw new AppError('unauthenticated', 'Incorrect email or password.');
  const token = randomToken(32);
  const row = await withSystem((tx) => tx.one<{ expires_at: Date }>(
    `insert into platform_sessions (admin_id, token_hash, expires_at) values ($1,$2, now() + interval '8 hours') returning expires_at`, [admin.id, sha256(token)]));
  return { token, expiresAt: row!.expires_at, adminId: admin.id as string };
}

export async function resolvePlatformSession(token: string | null) {
  if (!token) return null;
  return withSystem((tx) => tx.one<{ admin_id: string; full_name: string }>(
    `select s.admin_id, a.full_name from platform_sessions s join platform_admins a on a.id = s.admin_id where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(token)]));
}

export async function platformLogout(token: string) {
  await withSystem((tx) => tx.exec('update platform_sessions set revoked_at = now() where token_hash = $1', [sha256(token)]));
}
