import { pool } from '../db/pool';
import { rateLimited } from '../core/errors';
import { sha256 } from '../core/crypto';

/**
 * Fixed-window rate limiter backed by Postgres so limits hold across multiple app
 * instances. Keys are hashed (no raw emails/IPs at rest). Throws a 429 AppError.
 */
export async function rateLimit(scope: string, identity: string, max: number, windowSec: number) {
  const key = `${scope}:${sha256(identity).slice(0, 32)}`;
  const r = await pool().query(
    `insert into rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end,
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.count + 1 end
     returning count, extract(epoch from (window_start + make_interval(secs => $2) - now()))::int as retry`,
    [key, windowSec]);
  const { count, retry } = r.rows[0];
  if (count > max) throw rateLimited(Math.max(1, retry));
}

export async function purgeRateLimits() {
  await pool().query(`delete from rate_limits where window_start < now() - interval '1 day'`);
}
