import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../core/errors';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { sha256 } from '../core/crypto';
import { withOrg } from '../db/pool';
import { rateLimit } from '../auth/ratelimit';
import { resolveSession, SESSION_COOKIE, tokenFromCookieHeader } from '../auth/sessions';
import type { Ctx } from '../core/context';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface HandlerArgs {
  req: Request; ctx: Ctx; params: Record<string, string>; query: Record<string, string>; body: any;
  ip: string; requestId: string; url: URL;
}
export type Handler = (a: HandlerArgs) => Promise<unknown | Response>;
export interface RouteOpts {
  public?: boolean;                  // no session required
  idempotent?: boolean;              // honour Idempotency-Key
  limit?: { max: number; windowSec: number; scope?: string };
  noBody?: boolean;
}
interface Route { method: Method; parts: string[]; handler: Handler; opts: RouteOpts }

const routes: Route[] = [];
export function route(method: Method, path: string, handler: Handler, opts: RouteOpts = {}) {
  routes.push({ method, parts: path.split('/').filter(Boolean), handler, opts });
}

function match(r: Route, method: string, parts: string[]) {
  if (r.method !== method || r.parts.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = r.parts[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}

export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export function errorResponse(e: unknown, requestId: string): Response {
  if (e instanceof AppError) {
    const headers: Record<string, string> = { 'x-request-id': requestId };
    if (e.code === 'rate_limited') headers['retry-after'] = String((e.details as any)?.retryAfterSec ?? 30);
    return json(e.status, { error: { code: e.code, message: e.message, details: e.details, requestId } }, headers);
  }
  if (e instanceof ZodError) return json(422, { error: { code: 'validation_failed', message: e.issues[0]?.message ?? 'Invalid input', details: e.issues, requestId } }, { 'x-request-id': requestId });
  const pg = e as { code?: string };
  if (pg?.code === '23505') return json(409, { error: { code: 'conflict', message: 'That record already exists.', requestId } }, { 'x-request-id': requestId });
  if (pg?.code === '23503') return json(422, { error: { code: 'validation_failed', message: 'A referenced record does not exist.', requestId } }, { 'x-request-id': requestId });
  if (pg?.code === '23514' || pg?.code === '22P02' || pg?.code === '22007') return json(422, { error: { code: 'validation_failed', message: 'The request violates a data rule.', requestId } }, { 'x-request-id': requestId });
  if (pg?.code === '40001' || pg?.code === '40P01') return json(503, { error: { code: 'busy', message: 'The system is busy. Please retry.', requestId } }, { 'x-request-id': requestId, 'retry-after': '1' });
  logger.error('http.unhandled', { requestId, err: e });
  return json(500, { error: { code: 'internal', message: 'Something went wrong on our side.', requestId } }, { 'x-request-id': requestId });
}

export function sessionCookie(token: string | null, expires?: Date) {
  const secure = config().secureCookies ? '; Secure' : '';
  if (!token) return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires!.toUTCString()}${secure}`;
}

/** Defence in depth next to SameSite=Lax cookies: state-changing requests must be same-origin JSON. */
function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin) {
    const allowed = new URL(config().APP_URL).host;
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
    if (new URL(origin).host !== allowed && new URL(origin).host !== host) throw new AppError('forbidden', 'Cross-origin request blocked.');
  } else if (req.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AppError('forbidden', 'Cross-site request blocked.');
  } else if (!req.headers.get('x-plumeo-client') && req.headers.get('sec-fetch-site') !== 'same-origin') {
    throw new AppError('forbidden', 'Missing origin. Non-browser clients must send the X-Plumeo-Client header.');
  }
}

const readQuery = (url: URL) => Object.fromEntries(url.searchParams.entries());

async function readBody(req: Request) {
  const text = await req.text();
  if (text.length > 1_000_000) throw new AppError('bad_request', 'Request body too large.');
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { throw new AppError('bad_request', 'Request body must be valid JSON.'); }
}

const readLimiter = new Map<string, { n: number; t: number }>();
function softReadLimit(key: string) {
  const now = Date.now(); const e = readLimiter.get(key);
  if (!e || now - e.t > 60_000) { readLimiter.set(key, { n: 1, t: now }); if (readLimiter.size > 5000) readLimiter.clear(); return; }
  if (++e.n > 600) throw new AppError('rate_limited', 'Too many requests. Please slow down.', { retryAfterSec: 30 });
}

export async function dispatch(req: Request, prefix = '/api/v1'): Promise<Response> {
  const started = Date.now();
  const requestId = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
  const url = new URL(req.url);
  const parts = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  const method = req.method as Method;
  let ctx: Ctx | undefined; let status = 500; let matched = '';
  try {
    let found: { r: Route; params: Record<string, string> } | null = null;
    let pathExists = false;
    for (const r of routes) {
      const p = match(r, method, parts);
      if (p) { found = { r, params: p }; break; }
      if (r.parts.length === parts.length && r.parts.every((x, i) => x.startsWith(':') || x === parts[i])) pathExists = true;
    }
    if (!found) throw new AppError(pathExists ? 'bad_request' : 'not_found', pathExists ? 'Method not allowed.' : 'Unknown endpoint.');
    matched = `${method} /${found.r.parts.join('/')}`;
    const mutating = method !== 'GET';
    if (mutating) {
      assertSameOrigin(req);
      const ct = req.headers.get('content-type') ?? '';
      if (!found.r.opts.noBody && ct && !ct.includes('application/json')) throw new AppError('bad_request', 'Content-Type must be application/json.');
    }
    const ip = clientIp(req);
    if (!found.r.opts.public) {
      ctx = (await resolveSession(tokenFromCookieHeader(req.headers.get('cookie')), { requestId, ip, userAgent: req.headers.get('user-agent') ?? undefined })) ?? undefined;
      if (!ctx) throw new AppError('unauthenticated', 'Sign in to continue.');
      if (mutating) await rateLimit('api-write', ctx.userId, 240, 60); else softReadLimit(ctx.userId);
    } else if (mutating) {
      await rateLimit('public-write', ip, 120, 60);
    }
    if (found.r.opts.limit) await rateLimit(found.r.opts.limit.scope ?? matched, ctx?.userId ?? ip, found.r.opts.limit.max, found.r.opts.limit.windowSec);
    const body = mutating && !found.r.opts.noBody ? await readBody(req) : undefined;
    const args: HandlerArgs = { req, ctx: ctx as Ctx, params: found.params, query: readQuery(url), body, ip, requestId, url };

    // ---- idempotency ----
    const idemKey = mutating && ctx && found.r.opts.idempotent !== false ? req.headers.get('idempotency-key') : null;
    if (idemKey) {
      if (idemKey.length > 100) throw new AppError('bad_request', 'Idempotency-Key is too long.');
      const hash = sha256(`${matched}|${JSON.stringify(found.params)}|${JSON.stringify(body ?? null)}`);
      const claim = await withOrg(ctx!.orgId, async (tx) => {
        const ins = await tx.exec(`insert into idempotency_keys (org_id, user_id, key, request_hash) values ($1,$2,$3,$4) on conflict do nothing`, [ctx!.orgId, ctx!.userId, idemKey, hash]);
        if (ins) return { fresh: true as const };
        return { fresh: false as const, row: await tx.one<any>('select request_hash, status_code, response from idempotency_keys where org_id = $1 and user_id = $2 and key = $3', [ctx!.orgId, ctx!.userId, idemKey]) };
      });
      if (!claim.fresh) {
        if (claim.row.request_hash !== hash) throw new AppError('validation_failed', 'This Idempotency-Key was already used with a different request.');
        if (claim.row.status_code == null) throw new AppError('conflict', 'A request with this Idempotency-Key is still being processed.');
        status = claim.row.status_code;
        return json(claim.row.status_code, claim.row.response, { 'x-request-id': requestId, 'idempotent-replay': 'true' });
      }
    }

    let result: unknown;
    try {
      result = await found.r.handler(args);
    } catch (e) {
      if (idemKey) await withOrg(ctx!.orgId, (tx) => tx.exec('delete from idempotency_keys where org_id = $1 and user_id = $2 and key = $3', [ctx!.orgId, ctx!.userId, idemKey])).catch(() => {});
      throw e;
    }
    if (result instanceof Response) { status = result.status; result.headers.set('x-request-id', requestId); return result; }
    const envelope = result && typeof result === 'object' && 'data' in (result as object) && 'page' in (result as object) ? result : { data: result ?? { ok: true } };
    status = 200;
    if (idemKey) await withOrg(ctx!.orgId, (tx) => tx.exec('update idempotency_keys set status_code = 200, response = $4 where org_id = $1 and user_id = $2 and key = $3', [ctx!.orgId, ctx!.userId, idemKey, JSON.stringify(envelope)]));
    return json(200, envelope, { 'x-request-id': requestId });
  } catch (e) {
    const res = errorResponse(e, requestId);
    status = res.status;
    return res;
  } finally {
    logger.info('http.request', { requestId, route: matched || url.pathname, method, status, ms: Date.now() - started, orgId: ctx?.orgId, userId: ctx?.userId });
  }
}

export { json };

/** For documentation generation and tests: every registered endpoint. */
export function listRoutes() {
  return routes.map((r) => ({ method: r.method, path: '/' + r.parts.join('/'), public: !!r.opts.public, idempotent: r.opts.idempotent === true }));
}
