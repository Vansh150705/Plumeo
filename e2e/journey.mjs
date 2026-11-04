/*
 * End-to-end journey against a RUNNING Plumeo (default http://localhost:3000) that was seeded with `npm run seed`.
 * Drives a real Chromium through the UI: create → submit → approve → amend → check in → review → analytics → audit,
 * plus unauthorised attempts. Usage:  node e2e/journey.mjs   (env: BASE_URL, SHOTS=dir for screenshots)
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // devs: npm i -D playwright
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const PASSWORD = process.env.SEED_PASSWORD ?? 'PlumeoDemo!2026';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const step = async (name, fn) => { try { await fn(); results.push([name, true]); console.log('  ✓', name); } catch (e) { results.push([name, false, e.message.split('\n')[0]]); console.log('  ✗', name, '\n     ', e.message.split('\n').slice(0, 3).join('\n      ')); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
async function session(email, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Workspace').fill('northwind'); await page.getByLabel('Work email').fill(email); await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app', { timeout: 15000 });
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const goalTitle = `E2E: Cut invoice dispute resolution time to 3 days ${Date.now() % 10000}`;
let goalUrl = '';

console.log('\nPlumeo end-to-end journey');
console.log('\n[Employee drafts and submits a goal]');
const emp = await session('ananya.sharma@northwind.test');
await step('home shows personalised dashboard', async () => { await emp.page.getByRole('heading', { name: /Hello, Ananya/ }).waitFor(); await shot(emp.page, '01-home-employee'); });
await step('creates a goal with key results through the form, with live measurability check', async () => {
  await emp.page.goto(`${BASE}/app/goals/new`);
  await emp.page.getByLabel('Title', { exact: true }).fill(goalTitle);
  await emp.page.getByLabel('Description', { exact: true }).fill('Reduce the time finance takes to resolve invoice disputes.');
  await emp.page.getByLabel('Expected outcome').fill('Customers get answers within three days, and fewer escalations reach leadership.');
  await emp.page.getByLabel('Start', { exact: true }).fill(`${new Date().getUTCFullYear()}-01-01`); await emp.page.getByLabel('Due', { exact: true }).fill(`${new Date().getUTCFullYear()}-12-31`);
  await emp.page.getByLabel('Key result 1 title').fill('Average days to resolve a dispute');
  await emp.page.getByLabel('Start value').fill('9'); await emp.page.getByLabel('Target value').fill('3');
  await emp.page.getByLabel('Contributes to').selectOption({ index: 1 });
  await emp.page.getByText('Measurability check').waitFor();
  await shot(emp.page, '02-goal-form');
  await emp.page.getByRole('button', { name: 'Save draft' }).click();
  await emp.page.waitForURL(/\/app\/goals\/[0-9a-f-]{36}$/); goalUrl = emp.page.url();
  await emp.page.getByText('Draft', { exact: true }).first().waitFor();
});
await step('submits the draft for approval', async () => {
  await emp.page.getByRole('button', { name: 'Submit for approval' }).click();
  await emp.page.getByText('Awaiting approval').first().waitFor();
  await shot(emp.page, '03-goal-pending');
});
await step('cannot self-approve: no decision panel is offered to the owner', async () => { assert((await emp.page.getByRole('button', { name: 'Approve' }).count()) === 0, 'owner saw an Approve button'); });

console.log('\n[Manager approves]');
const mgr = await session('kabir.malhotra@northwind.test');
await step('manager sees the request in the approval queue and approves with a comment', async () => {
  await mgr.page.goto(`${BASE}/app/approvals`);
  const card = mgr.page.locator('li', { hasText: goalTitle });
  await card.waitFor(); await shot(mgr.page, '04-approvals');
  await card.getByRole('button', { name: 'Approve' }).click();
  await mgr.page.getByLabel('Comment (optional)').fill('Clear and measurable. Go for it.');
  await mgr.page.getByRole('button', { name: 'Confirm' }).click();
  await mgr.page.getByText('You\'re all caught up').or(mgr.page.locator('ul li').filter({ hasNotText: goalTitle }).first()).waitFor();
  await mgr.page.waitForFunction((t) => !document.body.innerText.includes(t), goalTitle);
});

console.log('\n[Employee works the active goal]');
await step('goal is active, shows approval history and contribution chain', async () => {
  await emp.page.goto(goalUrl);
  await emp.page.getByText('Active', { exact: true }).first().waitFor();
  await emp.page.getByText('How this contributes').waitFor();
  await emp.page.getByText('Clear and measurable. Go for it.').first().waitFor();
  await shot(emp.page, '05-goal-active');
});
await step('records measurable progress and sees the percentage update', async () => {
  await emp.page.getByLabel('New value for Average days to resolve a dispute').fill('6');
  await emp.page.getByRole('button', { name: /Record 1 update/ }).click();
  await emp.page.getByText('50%').first().waitFor();
});
await step('proposes an amendment (target change) that needs re-approval', async () => {
  await emp.page.getByRole('button', { name: 'Amend' }).click();
  await emp.page.getByLabel(/Target — Average days/).fill('2');
  await emp.page.getByLabel('Why is this changing?').fill('Finance leadership asked for an even faster SLA.');
  await emp.page.getByRole('button', { name: 'Propose amendment' }).click();
  await emp.page.getByText('Amendments', { exact: true }).waitFor();
  await emp.page.getByText('pending approval').first().waitFor();
});
await step('manager approves the amendment; version history keeps the old target', async () => {
  await mgr.page.goto(goalUrl);
  await mgr.page.getByText('An amendment needs your decision').waitFor();
  await mgr.page.getByRole('button', { name: 'Approve' }).first().click();
  await mgr.page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await mgr.page.getByText('Version 2').waitFor();
  await mgr.page.getByRole('button', { name: /Version 1/ }).click();
  await mgr.page.getByText(/9→3/).waitFor();
  await shot(mgr.page, '06-goal-versions');
});

console.log('\n[Check-in cycle]');
await step('employee submits an overdue quarterly check-in with measurable progress', async () => {
  await emp.page.goto(`${BASE}/app/checkins`);
  await shot(emp.page, '07-checkins');
  // Q3 closed on 14 Oct without a submission for the seeded billing-latency goal: it is overdue, and can still be submitted late
  const link = emp.page.locator('a', { hasText: 'Reduce billing API p99 latency' }).first();
  await link.click();
  await emp.page.getByLabel(/Current value for Billing API p99/).fill('350');
  await emp.page.getByLabel(/Current value for Slow queries fixed/).fill('9');
  await emp.page.getByLabel('What went well?').fill('Introduced a triage rota for disputes.');
  await emp.page.getByLabel('Blockers — what do you need help with?').fill('Need read access to the billing system.');
  await emp.page.getByRole('button', { name: 'Submit check-in' }).click();
  await emp.page.getByText('Submitted check-in').waitFor();
  await shot(emp.page, '08-checkin-submitted');
});
await step('manager reviews with feedback and a follow-up action', async () => {
  await mgr.page.goto(`${BASE}/app/team`); await shot(mgr.page, '09-team');
  await mgr.page.locator('tr', { hasText: 'Q3' }).locator('a', { hasText: 'Reduce billing API p99 latency' }).first().click();
  await mgr.page.getByLabel('Feedback', { exact: true }).fill('Good progress. I will ask IT about the billing access today.');
  await mgr.page.getByRole('button', { name: 'Add' }).click(); await mgr.page.getByPlaceholder('What should happen next?').fill('Request billing system access for Ananya');
  await mgr.page.getByRole('button', { name: 'Send feedback' }).click();
  await mgr.page.getByText('Feedback sent.').waitFor(); // committed server-side
  await mgr.page.getByText('Good progress. I will ask IT').first().waitFor();
});
await step('employee sees the feedback and the follow-up', async () => {
  await emp.page.reload(); await emp.page.getByText('Good progress. I will ask IT').first().waitFor();
  await emp.page.goto(`${BASE}/app/checkins`); await emp.page.getByText('Request billing system access for Ananya').waitFor();
});

console.log('\n[HR and administrators]');
const hr = await session('hana.okafor@northwind.test');
await step('alignment hierarchy renders company → department → team → individual', async () => {
  await hr.page.goto(`${BASE}/app/alignment`); await hr.page.getByText('Reach 25M ARR with healthy margins').waitFor();
  await hr.page.getByText('Reach 99.95 percent platform availability').waitFor(); await shot(hr.page, '10-alignment');
});
await step('analytics dashboard shows measured figures, charts and export links', async () => {
  await hr.page.goto(`${BASE}/app/analytics`); await hr.page.getByText('Average progress', { exact: true }).first().waitFor();
  await hr.page.locator('.recharts-wrapper').first().waitFor();
  assert((await hr.page.getByRole('link', { name: /Goals CSV/ }).count()) === 1, 'missing CSV export');
  await shot(hr.page, '11-analytics');
  const csv = await hr.page.request.get(`${BASE}/api/v1/exports/goals.csv`);
  assert(csv.status() === 200 && (await csv.text()).includes(goalTitle), 'CSV export did not contain the new goal');
});
const admin = await session('priya.shah@northwind.test');
await step('audit trail shows the whole story of the goal and verifies its hash chain', async () => {
  await admin.page.goto(`${BASE}/app/audit?q=${encodeURIComponent('goal.')}`); await admin.page.getByText('goal.approved').first().waitFor();
  await admin.page.getByRole('button', { name: 'Verify integrity' }).click(); await admin.page.getByText(/Hash chain intact/).waitFor(); await shot(admin.page, '12-audit');
  const csv = await admin.page.request.get(`${BASE}/api/v1/exports/audit.csv`); assert(csv.status() === 200, 'audit export failed');
});
await step('admin screens render: people, structure, roles, cycles, policies, library, integrations', async () => {
  for (const [path, text] of [['people', 'People'], ['structure', 'Organisation structure'], ['roles', 'Roles & access'], ['cycles', 'Cycles & review periods'], ['policies', 'Policies'], ['templates', 'Goal library'], ['integrations', 'Integrations']]) {
    await admin.page.goto(`${BASE}/app/admin/${path}`); await admin.page.getByRole('heading', { name: text, exact: true }).first().waitFor(); await shot(admin.page, `13-admin-${path}`);
  }
});
await step('admin creates a department from the UI and it appears in the structure', async () => {
  await admin.page.goto(`${BASE}/app/admin/structure`); await admin.page.getByRole('button', { name: /Add business unit or department/ }).click();
  await admin.page.getByLabel('Name').fill('Customer Success'); await admin.page.getByRole('button', { name: 'Save' }).click(); await admin.page.getByText('Customer Success').first().waitFor();
});

console.log('\n[Unauthorised attempts]');
await step('an employee cannot open admin or audit pages (redirected, with notice)', async () => {
  for (const p of ['/app/audit', '/app/admin/people', '/app/admin/policies']) { await emp.page.goto(`${BASE}${p}`); await emp.page.waitForURL(/\/app\?denied=1/); await emp.page.getByText("You don't have access to that page.").waitFor(); }
});
await step('the API refuses employees the audit trail, exports and user creation', async () => {
  const r = emp.page.request; const h = { 'x-plumeo-client': 'e2e' };
  assert((await r.get(`${BASE}/api/v1/audit`)).status() === 403, 'audit not 403');
  assert((await r.get(`${BASE}/api/v1/exports/goals.csv`)).status() === 403, 'export not 403');
  assert((await r.post(`${BASE}/api/v1/users`, { data: { email: 'x@y.test', fullName: 'X' }, headers: h })).status() === 403, 'create user not 403');
  assert((await r.post(`${BASE}/api/v1/users`, { data: { email: 'x@y.test', fullName: 'X' }, headers: { origin: 'https://evil.example' } })).status() === 403, 'cross-origin write not blocked');
});
await step("an employee cannot open a colleague's private goal (404, not 403)", async () => {
  const other = await (await admin.page.request.get(`${BASE}/api/v1/goals?mine=true&limit=1`)).json();
  const hrGoals = await (await hr.page.request.get(`${BASE}/api/v1/goals?scope=all&level=individual&limit=200`)).json();
  const foreign = hrGoals.data.find((g) => g.owner_name === 'Rohan Kapoor');
  assert(foreign, 'seed goal for Rohan missing'); void other;
  const api = await emp.page.request.get(`${BASE}/api/v1/goals/${foreign.id}`); assert(api.status() === 404, `API expected 404, got ${api.status()}`);
  await emp.page.goto(`${BASE}/app/goals/${foreign.id}`); await emp.page.getByText("We couldn't find that page").waitFor();
  assert(!(await emp.page.content()).includes('Rohan'), 'page leaked the owner name');
});
await step('signing out ends the session', async () => {
  await emp.page.goto(`${BASE}/app`); await emp.page.getByRole('button', { name: 'Account menu' }).click(); await emp.page.getByRole('menuitem', { name: 'Sign out' }).click();
  await emp.page.waitForURL('**/login'); await emp.page.goto(`${BASE}/app/goals`); await emp.page.waitForURL('**/login');
});

console.log('\n[Mobile layout]');
const mob = await session('rohan.kapoor@northwind.test', { width: 390, height: 844 });
await step('phone layout: navigation drawer, no horizontal overflow on key pages', async () => {
  for (const p of ['/app', '/app/goals', '/app/checkins', '/app/alignment']) {
    await mob.page.goto(`${BASE}${p}`); await mob.page.waitForLoadState('networkidle');
    const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `${p} overflows horizontally by ${overflow}px`);
  }
  await mob.page.goto(`${BASE}/app`); await mob.page.getByRole('button', { name: 'Open navigation' }).click(); await mob.page.getByRole('link', { name: 'Goals' }).first().waitFor(); await shot(mob.page, '14-mobile-nav');
});

const jsErrors = [...emp.errors, ...mgr.errors, ...hr.errors, ...admin.errors, ...mob.errors];
await step('no unexpected browser console errors during the journey', async () => { assert(jsErrors.length === 0, jsErrors.slice(0, 3).join(' | ')); });
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
