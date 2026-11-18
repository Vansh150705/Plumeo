/*
 * Post-deploy smoke test for a running Plumeo (no browser needed).
 *   BASE_URL=https://your-app.vercel.app node scripts/smoke.mjs
 *   optional login check:  SMOKE_ORG=northwind SMOKE_EMAIL=priya.shah@northwind.test SMOKE_PASSWORD=... node scripts/smoke.mjs
 * Exits non-zero if anything fails, so it can gate a deploy.
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '-', e.message); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const get = (p, init) => fetch(BASE + p, { redirect: 'manual', ...init });

console.log(`Smoke test: ${BASE}`);
await check('liveness  GET /api/v1/health', async () => { const r = await get('/api/v1/health'); must(r.status === 200, `status ${r.status}`); });
await check('readiness GET /api/v1/ready (database + migrations)', async () => { const r = await get('/api/v1/ready'); const j = await r.json().catch(() => ({})); must(r.status === 200, `status ${r.status} ${JSON.stringify(j).slice(0, 120)} — check DATABASE_URL and that migrations ran`); console.log('      migration:', j.data?.migration); });
await check('landing page renders', async () => { const r = await get('/'); must([200, 307].includes(r.status), `status ${r.status}`); });
await check('login page renders', async () => { const r = await get('/login'); must(r.status === 200, `status ${r.status}`); must((await r.text()).includes('Sign in'), 'no sign-in form'); });
await check('security headers present', async () => { const r = await get('/login'); for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security']) must(r.headers.get(h), `missing ${h}`); });
await check('app area requires sign-in (redirects)', async () => { const r = await get('/app'); must([302, 307, 308].includes(r.status) && (r.headers.get('location') ?? '').includes('/login'), `status ${r.status}`); });
await check('API refuses anonymous access (401)', async () => { const r = await get('/api/v1/goals'); must(r.status === 401, `status ${r.status}`); });
await check('API refuses cross-origin writes (403)', async () => { const r = await get('/api/v1/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }); must([401, 403].includes(r.status), `status ${r.status}`); });
await check('scheduler endpoint rejects missing secret (401)', async () => { const r = await get('/api/v1/jobs/run'); must(r.status === 401, `status ${r.status}`); });
if (process.env.SMOKE_EMAIL) {
  await check('login + load /api/v1/auth/me + goals list', async () => {
    const l = await get('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ orgSlug: process.env.SMOKE_ORG, email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }) });
    must(l.status === 200, `login status ${l.status}`);
    const cookie = (l.headers.get('set-cookie') ?? '').split(';')[0]; must(cookie.startsWith('plumeo_session='), 'no session cookie');
    const me = await get('/api/v1/auth/me', { headers: { cookie } }); must(me.status === 200, `me ${me.status}`);
    const g = await get('/api/v1/goals?limit=1', { headers: { cookie } }); must(g.status === 200, `goals ${g.status}`);
    const app = await get('/app', { headers: { cookie } }); must(app.status === 200, `/app ${app.status}`);
  });
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
