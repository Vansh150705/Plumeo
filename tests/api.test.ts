import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb, makeOrg, activeCycle, goalInput, PASSWORD, ctxFor, type TestOrg } from './helpers';
import { dispatch } from '@/server/http/framework';
import '@/server/http/routes';
import { handleScim } from '@/server/http/scim-routes';
import { createScimToken } from '@/server/services/integrations';
import { createPlatformAdmin } from '@/server/auth/platform';
import { withOrg } from '@/server/db/pool';
import { resetConfigForTests } from '@/server/core/config';

const BASE = 'http://localhost:3000';
let org: TestOrg; let cycle: string;
let adminCookie = '', empCookie = '', mgrCookie = '', outsiderCookie = '';
let ipN = 0;

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string>; origin?: string | null; raw?: boolean } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `203.0.113.${(++ipN % 250) + 1}`, ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') { if (opts.origin !== null) headers.origin = opts.origin ?? BASE; }
  const res = await dispatch(new Request(`${BASE}/api/v1${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }));
  if (opts.raw) return res;
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}
async function login(slug: string, email: string, password = PASSWORD) {
  const res = (await call('POST', '/auth/login', { body: { orgSlug: slug, email, password }, raw: true })) as Response;
  const cookie = res.headers.get('set-cookie');
  return { status: res.status, cookie: cookie ? cookie.split(';')[0] : '', header: cookie ?? '' };
}

beforeAll(async () => {
  process.env.APP_URL = BASE; process.env.CRON_SECRET = 'cron-secret-for-tests-123'; resetConfigForTests();
  await setupTestDb();
  org = await makeOrg('apico'); cycle = await activeCycle(org.orgId);
  const mgr = await org.add('Mia Manager'); await org.add('Eddie Employee', { managerId: mgr.id });
  const other = await makeOrg('outsider');
  adminCookie = (await login('apico', 'admin@apico.test')).cookie;
  mgrCookie = (await login('apico', mgr.email)).cookie;
  const emp = (await withOrg(org.orgId, (tx) => tx.one<any>(`select email from users where full_name = 'Eddie Employee'`)));
  empCookie = (await login('apico', emp.email)).cookie;
  outsiderCookie = (await login('outsider', 'admin@outsider.test')).cookie;
  void other;
});
afterAll(teardownTestDb);

describe('sessions and cookies', () => {
  it('issues an HttpOnly, SameSite=Lax session cookie and never returns the token in the body', async () => {
    const r = await login('apico', 'admin@apico.test');
    expect(r.status).toBe(200);
    expect(r.header).toMatch(/HttpOnly/); expect(r.header).toMatch(/SameSite=Lax/); expect(r.header).toMatch(/Path=\//);
    const me = await call('GET', '/auth/me', { cookie: r.cookie });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.json)).not.toContain(r.cookie.split('=')[1]);
    expect(me.json.data.user).not.toHaveProperty('password_hash');
    expect(me.json.data.permissions).toContain('org.manage');
  });

  it('answers 401 without a session and with a forged or revoked one', async () => {
    expect((await call('GET', '/goals')).status).toBe(401);
    expect((await call('GET', '/goals', { cookie: 'plumeo_session=' + 'a'.repeat(43) })).status).toBe(401);
    const r = await login('apico', 'admin@apico.test');
    expect((await call('POST', '/auth/logout', { cookie: r.cookie })).status).toBe(200);
    expect((await call('GET', '/auth/me', { cookie: r.cookie })).status).toBe(401);
  });

  it('uses one generic message for failed sign-ins', async () => {
    const a = await call('POST', '/auth/login', { body: { orgSlug: 'apico', email: 'admin@apico.test', password: 'wrong-wrong-wrong' } });
    const b = await call('POST', '/auth/login', { body: { orgSlug: 'nope', email: 'admin@apico.test', password: 'wrong-wrong-wrong' } });
    expect(a.status).toBe(401); expect(a.json.error.message).toBe(b.json.error.message);
  });
});

describe('CSRF and request hygiene', () => {
  it('blocks cross-origin and origin-less state changes, accepts same-origin and explicit API clients', async () => {
    const body = goalInput(cycle);
    expect((await call('POST', '/goals', { cookie: empCookie, body, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/goals', { cookie: empCookie, body, origin: null })).status).toBe(403);
    expect((await call('POST', '/goals', { cookie: empCookie, body, origin: null, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call('POST', '/goals', { cookie: empCookie, body, origin: null, headers: { 'x-plumeo-client': 'script' } })).status).toBe(200);
    expect((await call('POST', '/goals', { cookie: empCookie, body })).status).toBe(200);
  });

  it('rejects non-JSON bodies, malformed JSON and unknown routes with a consistent error envelope', async () => {
    const form = await dispatch(new Request(`${BASE}/api/v1/goals`, { method: 'POST', headers: { cookie: empCookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=b' }));
    expect(form.status).toBe(400);
    const bad = await dispatch(new Request(`${BASE}/api/v1/goals`, { method: 'POST', headers: { cookie: empCookie, origin: BASE, 'content-type': 'application/json' }, body: '{nope' }));
    expect(bad.status).toBe(400);
    const nf = await call('GET', '/nonsense', { cookie: empCookie });
    expect(nf.status).toBe(404);
    expect(nf.json.error).toMatchObject({ code: 'not_found' });
    expect(nf.json.error.requestId).toBeTruthy();
    expect(nf.headers.get('x-request-id')).toBe(nf.json.error.requestId);
  });

  it('never leaks internals on server errors', async () => {
    const r = await call('GET', '/goals?cycleId=not-a-uuid', { cookie: empCookie });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).not.toMatch(/select |pg_|stack|node_modules/i);
  });
});

describe('API behaviour', () => {
  it('maps validation, permission and not-found errors to the right status codes', async () => {
    expect((await call('POST', '/goals', { cookie: empCookie, body: { cycleId: cycle, level: 'individual', title: 'x', status: 'active' } })).status).toBe(422);
    expect((await call('POST', '/users', { cookie: empCookie, body: { email: 'a@b.test', fullName: 'A' } })).status).toBe(403);
    expect((await call('GET', '/goals/00000000-0000-4000-8000-000000000000', { cookie: empCookie })).status).toBe(404);
    expect((await call('PUT', '/policy', { cookie: empCookie, body: { policy: {} } })).status).toBe(403);
    expect((await call('GET', '/audit', { cookie: empCookie })).status).toBe(403);
    expect((await call('GET', '/audit', { cookie: adminCookie })).status).toBe(200);
  });

  it('supports the full goal journey over HTTP, with pagination and filters', async () => {
    const created = await call('POST', '/goals', { cookie: empCookie, body: goalInput(cycle, { title: 'HTTP journey: halve onboarding time' }) });
    const id = created.json.data.id;
    const sub = await call('POST', `/goals/${id}/submit`, { cookie: empCookie, body: {} });
    expect(sub.json.data.status).toBe('pending_approval');
    const queue = await call('GET', '/approvals', { cookie: mgrCookie });
    const req = queue.json.data.find((r: any) => r.goal_id === id);
    expect(req).toBeTruthy();
    expect((await call('POST', `/approvals/${req.id}/decision`, { cookie: empCookie, body: { decision: 'approve' } })).status).toBe(403);
    const dec = await call('POST', `/approvals/${req.id}/decision`, { cookie: mgrCookie, body: { decision: 'approve', comment: 'Go for it' } });
    expect(dec.json.data.result).toBe('approved');
    expect((await call('POST', `/approvals/${req.id}/decision`, { cookie: mgrCookie, body: { decision: 'approve' } })).status).toBe(409);
    const list = await call('GET', '/goals?status=active&limit=1&mine=true', { cookie: empCookie });
    expect(list.json.page).toMatchObject({ limit: 1, offset: 0 });
    expect(list.json.data[0].id).toBe(id);
    const detail = await call('GET', `/goals/${id}`, { cookie: empCookie });
    expect(detail.json.data.goal.status).toBe('active');
    expect(detail.json.data.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['goal.submitted', 'goal.approved']));
    expect((await call('GET', `/goals/${id}`, { cookie: outsiderCookie })).status).toBe(404);
  });

  it('is idempotent for retried creations and rejects key reuse with a different payload', async () => {
    const key = 'idem-key-0001';
    const body = goalInput(cycle, { title: 'Idempotent creation of a goal' });
    const a = await call('POST', '/goals', { cookie: empCookie, body, headers: { 'idempotency-key': key } });
    const b = await call('POST', '/goals', { cookie: empCookie, body, headers: { 'idempotency-key': key } });
    expect(b.json.data.id).toBe(a.json.data.id);
    expect(b.headers.get('idempotent-replay')).toBe('true');
    const dup = await withOrg(org.orgId, (tx) => tx.query(`select 1 from goals where title = 'Idempotent creation of a goal'`));
    expect(dup).toHaveLength(1);
    const c = await call('POST', '/goals', { cookie: empCookie, body: { ...body, title: 'A different goal title entirely' }, headers: { 'idempotency-key': key } });
    expect(c.status).toBe(422);
    // concurrent duplicates: exactly one is executed
    const k2 = 'idem-key-0002';
    const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/goals', { cookie: empCookie, body: goalInput(cycle, { title: 'Concurrent idempotent creation' }), headers: { 'idempotency-key': k2 } })));
    const ids = new Set(rs.filter((r) => r.status === 200).map((r) => r.json.data.id));
    expect(ids.size).toBe(1);
    expect(await withOrg(org.orgId, (tx) => tx.query(`select 1 from goals where title = 'Concurrent idempotent creation'`))).toHaveLength(1);
  });

  it('serves CSV and PDF exports with safe headers, only to permitted users', async () => {
    const denied = await call('GET', '/exports/goals.csv', { cookie: empCookie });
    expect(denied.status).toBe(403);
    const ok = (await call('GET', '/exports/goals.csv', { cookie: adminCookie, raw: true })) as Response;
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/text\/csv/);
    expect(ok.headers.get('content-disposition')).toMatch(/attachment/);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await ok.text()).toContain('HTTP journey');
    const pdf = (await call('GET', '/exports/summary.pdf', { cookie: adminCookie, raw: true })) as Response;
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('exposes analytics, notifications and alignment endpoints', async () => {
    const an = await call('GET', '/analytics', { cookie: adminCookie });
    expect(an.status).toBe(200); expect(an.json.data.summary.totalGoals).toBeGreaterThan(0);
    expect((await call('GET', `/goals/alignment?cycleId=${cycle}`, { cookie: adminCookie })).json.data.nodes.length).toBeGreaterThan(0);
    const n = await call('GET', '/notifications', { cookie: empCookie });
    expect(n.json.data.length).toBeGreaterThan(0); expect(n.json).toHaveProperty('unread');
    expect((await call('POST', '/notifications/read', { cookie: empCookie, body: {} })).json.data.updated).toBeGreaterThan(0);
    const lint = await call('POST', '/goals/lint', { cookie: empCookie, body: { title: 'Improve things', keyResults: [] } });
    expect(lint.json.data.score).toBeLessThan(100);
  });

  it('rate-limits expensive exports', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push(((await call('GET', '/exports/checkins.csv', { cookie: adminCookie, raw: true })) as Response).status);
    expect(codes).toContain(429);
  });
});

describe('operations endpoints', () => {
  it('reports health and readiness without authentication', async () => {
    expect((await call('GET', '/health')).json.data.status).toBe('ok');
    const ready = await call('GET', '/ready');
    expect(ready.status).toBe(200); expect(ready.json.data.migration).toMatch(/^000\d_/);
  });

  it('protects the scheduler endpoint with a shared secret', async () => {
    expect((await call('GET', '/jobs/run')).status).toBe(401);
    expect((await call('GET', '/jobs/run', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await call('GET', '/jobs/run', { headers: { authorization: 'Bearer cron-secret-for-tests-123' } });
    expect(ok.status).toBe(200); expect(ok.json.data.skipped).toBe(false);
  });

  it('platform administrators manage organisations but have no tenant-data access', async () => {
    await createPlatformAdmin('root@plumeo.test', 'Root Admin', 'a-very-long-platform-pass-1');
    expect((await call('GET', '/platform/orgs')).status).toBe(401);
    expect((await call('GET', '/platform/orgs', { cookie: adminCookie })).status).toBe(401);       // tenant admins are not platform admins
    const login = (await call('POST', '/platform/login', { body: { email: 'root@plumeo.test', password: 'a-very-long-platform-pass-1' }, raw: true })) as Response;
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const orgs = await call('GET', '/platform/orgs', { cookie });
    expect(orgs.json.data.map((o: any) => o.slug)).toEqual(expect.arrayContaining(['apico', 'outsider']));
    expect((await call('GET', '/goals', { cookie })).status).toBe(401);                            // platform session is not a tenant session
    const sus = await call('POST', `/platform/orgs/${org.orgId}/status`, { cookie, body: { status: 'suspended' } });
    expect(sus.status).toBe(200);
    expect((await call('GET', '/auth/me', { cookie: adminCookie })).status).toBe(401);             // suspension kills live sessions
    await call('POST', `/platform/orgs/${org.orgId}/status`, { cookie, body: { status: 'active' } });
  });

  it('self-service sign-up creates an organisation and signs the founder in (when enabled)', async () => {
    const r = (await call('POST', '/auth/signup', { raw: true, body: { name: 'Fresh Co', slug: 'fresh-co', adminName: 'Fay Founder', adminEmail: 'fay@fresh.test', adminPassword: PASSWORD, createFirstCycle: true } })) as Response;
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    const me = await call('GET', '/auth/me', { cookie });
    expect(me.json.data.org.slug).toBe('fresh-co');
    expect(me.json.data.roles).toEqual(expect.arrayContaining(['org_admin']));
    const taken = await call('POST', '/auth/signup', { body: { name: 'Dup', slug: 'fresh-co', adminName: 'X Y', adminEmail: 'x@y.test', adminPassword: PASSWORD } });
    expect(taken.status).toBe(409);
  });
});

describe('SCIM over HTTP', () => {
  it('speaks application/scim+json and enforces the bearer token', async () => {
    const t = (await createScimToken(await ctxFor(org.orgId, org.admin.userId), 'http')).token;
    const h = { authorization: `Bearer ${t}`, 'content-type': 'application/scim+json' };
    const unauth = await handleScim(new Request(`${BASE}/api/scim/v2/Users`), 'r');
    expect(unauth.status).toBe(401);
    const created = await handleScim(new Request(`${BASE}/api/scim/v2/Users`, { method: 'POST', headers: h, body: JSON.stringify({ userName: 'scim.user@apico.test', displayName: 'Scim User' }) }), 'r');
    expect(created.status).toBe(201); expect(created.headers.get('content-type')).toBe('application/scim+json');
    const user = await created.json();
    const got = await handleScim(new Request(`${BASE}/api/scim/v2/Users?filter=${encodeURIComponent('userName eq "scim.user@apico.test"')}`, { headers: h }), 'r');
    expect((await got.json()).totalResults).toBe(1);
    const del = await handleScim(new Request(`${BASE}/api/scim/v2/Users/${user.id}`, { method: 'DELETE', headers: h }), 'r');
    expect(del.status).toBe(204);
    const spc = await handleScim(new Request(`${BASE}/api/scim/v2/ServiceProviderConfig`, { headers: h }), 'r');
    expect((await spc.json()).patch.supported).toBe(true);
  });
});
