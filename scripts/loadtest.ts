/*
 * Synthetic-scale benchmark. Builds a large organisation with set-based SQL, then times the real service layer.
 *   DATABASE_URL=<app role> MIGRATION_DATABASE_URL=<owner> npm run loadtest -- [users=2000] [goalsPerPerson=5]
 * Numbers depend entirely on the machine and database it runs on; treat them as relative, not as a promise.
 */
import { performance } from 'node:perf_hooks';
import { closePool, withOrg, withSystem } from '../server/db/pool';
import { createOrganization } from '../server/services/orgs';
import { loadAccess } from '../server/services/rbac-load';
import { listGoals, getGoalDetail, getAlignment, createGoal } from '../server/services/goals';
import { submitGoal, decideApproval, listApprovalQueue } from '../server/services/approvals';
import { getAnalytics } from '../server/services/analytics';
import { searchAudit, verifyAuditChain } from '../server/services/audit';
import { processDeliveries } from '../server/services/notifications';
import { recordProgress } from '../server/services/goals';
import { setMailTransportForTests } from '../server/services/mailer';
import { exportGoalsCsv } from '../server/services/exports';
import type { Ctx } from '../server/core/context';

if (process.env.NODE_ENV === 'production') { console.error('Refusing to run a load test in production.'); process.exit(1); }
const USERS = Number(process.argv[2] ?? 2000), PER = Number(process.argv[3] ?? 5);
const rows: [string, string, string][] = [];
async function time<T>(name: string, fn: () => Promise<T>, note = (r: T) => ''): Promise<T> {
  const t = performance.now(); const r = await fn(); const ms = performance.now() - t;
  rows.push([name, `${ms.toFixed(0)} ms`, note(r)]); console.log(`  ${name.padEnd(58)} ${ms.toFixed(0).padStart(7)} ms  ${note(r)}`); return r;
}
async function ctxFor(orgId: string, userId: string): Promise<Ctx> {
  return withSystem(async (tx) => { const u = await tx.one<any>('select full_name from users where org_id = $1 and id = $2', [orgId, userId]); const a = await loadAccess(tx, orgId, userId); return { orgId, userId, userName: u.full_name, perms: a.perms, roleKeys: a.roleKeys, requestId: 'perf', actorType: 'user' as const }; });
}

async function main() {
  console.log(`\nBuilding synthetic organisation: ${USERS} people, ~${USERS * PER} goals…`);
  const slug = `perf-${Date.now().toString(36)}`;
  const org = await createOrganization({ name: 'Perf Org', slug, adminName: 'Perf Admin', adminEmail: `admin@${slug}.test`, adminPassword: 'Perf-Test-Password-123', createFirstCycle: true }, { requestId: 'perf' });
  const O = org.orgId;
  const t0 = performance.now();
  await withOrg(O, async (tx) => {
    // users: 1 CEO, ~1% VPs, ~10% managers, the rest individual contributors. ids are deterministic so reporting lines can be set in SQL.
    await tx.exec(`insert into departments (org_id, name) select $1, 'Dept ' || g from generate_series(1, 20) g`, [O]);
    await tx.exec(`insert into users (org_id, email, full_name, status, department_id)
      select $1, 'u' || g || '@perf.test', 'Person ' || g, 'active', (select id from departments where org_id = $1 and name = 'Dept ' || (1 + g % 20)) from generate_series(1, $2::int) g`, [O, USERS]);
    await tx.exec(`create temp table n on commit drop as select id, row_number() over (order by email) as rn from users where org_id = $1 and email like 'u%@perf.test'`, [O]);
    // rn=1 CEO; rn 2..21 VPs -> CEO; rn 22..221 managers -> VP; others -> manager
    await tx.exec(`update users u set manager_id = case when nn.rn between 2 and 21 then (select id from n where rn = 1)
        when nn.rn between 22 and 221 then (select id from n where rn = 2 + (nn.rn % 20))
        when nn.rn > 221 then (select id from n where rn = 22 + (nn.rn % 200)) end from n nn where u.id = nn.id and nn.rn > 1`);
    await tx.exec(`insert into user_roles (org_id, user_id, role_id) select $1, u.id, r.id from users u join roles r on r.org_id = u.org_id and r.key = 'employee' where u.org_id = $1 and u.email like 'u%@perf.test'`, [O]);
    await tx.exec(`insert into user_roles (org_id, user_id, role_id) select $1, u.id, r.id from users u join roles r on r.org_id = u.org_id and r.key = 'team_manager'
      where u.org_id = $1 and u.id in (select distinct manager_id from users where org_id = $1 and manager_id is not null)`, [O]);
    const cycle = (await tx.one<{ id: string }>(`select id from cycles where org_id = $1 limit 1`, [O]))!.id;
    await tx.exec(`insert into goals (org_id, cycle_id, level, title, description, expected_outcome, owner_id, department_id, priority, status, start_date, due_date, approved_at, created_by)
      select $1, $2, 'individual', 'Goal ' || g || ' for ' || u.full_name, 'Synthetic description', 'Synthetic outcome', u.id, u.department_id, (array['low','medium','high','critical'])[1 + g % 4],
        (array['active','active','active','active','completed','draft','pending_approval'])[1 + (g + u.rn::int) % 7], date_trunc('year', now())::date, (date_trunc('year', now()) + interval '1 year' - interval '1 day')::date, now() - interval '200 days', u.id
      from (select users.id, users.full_name, users.department_id, row_number() over (order by email) rn from users where org_id = $1 and email like 'u%@perf.test') u cross join generate_series(1, $3::int) g`, [O, cycle, PER]);
    await tx.exec(`insert into key_results (org_id, goal_id, title, metric_type, direction, start_value, target_value, current_value, weight, position)
      select $1, g.id, 'KR ' || k, 'number', 'increase', 0, 100, (random() * 100)::numeric(6,1), 1, k from goals g cross join generate_series(1, 2) k where g.org_id = $1`, [O]);
  });
  const goalCount = (await withOrg(O, (tx) => tx.one<{ n: number }>('select count(*)::int as n from goals where org_id = $1', [O])))!.n;
  console.log(`  built in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${USERS} users, ${goalCount} goals, ${goalCount * 2} key results\n`);

  const admin = await ctxFor(O, org.adminId);
  const pick = async (sql: string) => ctxFor(O, (await withOrg(O, (tx) => tx.one<any>(sql, [O])))!.id);
  // VP: reports to the CEO and has managers beneath; manager: has reports and sits under a VP; employee: no reports
  const vp = await pick(`select v.id from users v join users c on c.id = v.manager_id where v.org_id = $1 and c.manager_id is null and exists (select 1 from users m where m.manager_id = v.id) limit 1`);
  const mgr = await pick(`select m.id from users m join users v on v.id = m.manager_id where m.org_id = $1 and v.manager_id is not null and exists (select 1 from users r where r.manager_id = m.id) limit 1 offset 20`);
  const emp = await pick(`select id from users where org_id = $1 and not exists (select 1 from users r where r.manager_id = users.id) limit 1 offset 500`);
  if (process.env.MIGRATION_DATABASE_URL) { const { Client } = await import('pg'); const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await c.connect(); await c.query('analyze'); await c.end(); } // like autovacuum would

  const cycle = (await withOrg(O, (tx) => tx.one<{ id: string }>(`select id from cycles where org_id = $1 limit 1`, [O])))!.id;
  console.log('Read paths (single request, warm connection):');
  await time('list goals — org admin, page of 50', () => listGoals(admin, { limit: 50 }), (r) => `total=${r.page.total}`);
  await time('list goals — org admin, filtered (status+level+risk)', () => listGoals(admin, { status: ['active'], level: ['individual'], risk: ['at_risk'], limit: 50 }), (r) => `matches=${r.page.total}`);
  await time('list goals — VP (visibility by reporting line)', () => listGoals(vp, { limit: 50 }), (r) => `total=${r.page.total}`);
  await time('list goals — manager', () => listGoals(mgr, { limit: 50 }), (r) => `total=${r.page.total}`);
  await time('list goals — employee', () => listGoals(emp, { limit: 50 }), (r) => `total=${r.page.total}`);
  await time('goal detail — admin', async () => getGoalDetail(admin, (await listGoals(admin, { limit: 1 })).data[0].id));
  await time('alignment graph — org admin (cap 3000 nodes)', () => getAlignment(admin, cycle), (r) => `nodes=${r.nodes.length}`);
  await time('analytics — whole organisation', () => getAnalytics(admin, {}), (r: any) => `goals=${r.summary.totalGoals}`);
  await time('analytics — VP scope', () => getAnalytics(vp, {}), (r: any) => `goals=${r.summary.totalGoals}`);
  await time('analytics — employee scope', () => getAnalytics(emp, {}), (r: any) => `goals=${r.summary.totalGoals}`);
  await time('CSV export — all goals (10k cap)', () => exportGoalsCsv({ ...admin, perms: new Set([...admin.perms, 'exports.run']) }, {}), (r) => `${(r.length / 1024).toFixed(0)} KB`);

  console.log('\nWrite paths and concurrency:');
  const someMgr = mgr; const reports = await withOrg(O, (tx) => tx.query<{ id: string }>(`select id from users where org_id = $1 and manager_id = $2 limit 40`, [O, mgr.userId]));
  const ids: string[] = [];
  await time(`create + submit ${reports.length} goals concurrently (one per report)`, async () => {
    await Promise.all(reports.map(async (r) => { const c = await ctxFor(O, r.id); const g = await createGoal(c, { cycleId: cycle, level: 'individual', title: 'Perf goal: increase conversion rate', description: 'd', expectedOutcome: 'o', startDate: '2026-01-01', dueDate: '2026-12-31', keyResults: [{ title: 'k', startValue: 0, targetValue: 10 }] }).catch(() => null); if (g) { await submitGoal(c, g.id).catch(() => {}); ids.push(g.id); } }));
  }, () => `${ids.length} submitted`);
  const q = await listApprovalQueue(someMgr);
  const pending = q.filter((x: any) => ids.includes(x.goal_id));
  await time(`approve ${pending.length} different goals concurrently`, () => Promise.all(pending.map((p: any) => decideApproval(someMgr, p.id, { decision: 'approve' }))), () => 'all decided');
  const target = await (async () => { const c = await ctxFor(O, reports[0].id); const g = await createGoal(c, { cycleId: cycle, level: 'individual', title: 'Perf goal: race on one approval', description: 'd', expectedOutcome: 'o', startDate: '2026-01-01', dueDate: '2026-12-31', keyResults: [{ title: 'k', startValue: 0, targetValue: 10 }] }); await submitGoal(c, g.id); return (await listApprovalQueue(someMgr)).find((x: any) => x.goal_id === g.id).id as string; })();
  const out = await time('100 simultaneous approvals of ONE request', () => Promise.all(Array.from({ length: 100 }, () => decideApproval(someMgr, target, { decision: 'approve' }).then(() => 'ok', (e) => e.code))), (r) => `winners=${r.filter((x) => x === 'ok').length}, rejected=${r.filter((x) => x !== 'ok').length}`);
  if (out.filter((x) => x === 'ok').length !== 1) throw new Error('CONCURRENCY VIOLATION: more than one decision succeeded');
  const mine = (await listGoals(emp, { mine: true, status: ['active'], limit: 1 })).data[0];
  const kr = (await getGoalDetail(emp, mine.id)).keyResults[0];
  await time('200 concurrent progress updates on one goal', () => Promise.all(Array.from({ length: 200 }, (_, i) => recordProgress(emp, mine.id, { updates: [{ keyResultId: kr.id, value: i % 100 }] }))), () => 'all recorded');

  console.log('\nAudit and notifications:');
  const ev = (await withOrg(O, (tx) => tx.one<{ n: number }>('select count(*)::int as n from audit_events where org_id = $1', [O])))!.n;
  await time(`append 20,000 audit events in 400 batches (chain trigger, 1 org)`, async () => { for (let b = 0; b < 400; b++) await withOrg(O, (tx) => tx.exec(`insert into audit_events (org_id, actor_type, action, entity_type, metadata) select $1, 'system', 'perf.event', 'perf', '{}' from generate_series(1, 50)`, [O])); });
  await time('audit search — newest 50 (keyset)', () => searchAudit(admin, { limit: 50 }), (r) => `rows=${r.data.length}`);
  await time('audit search — filtered by action prefix', () => searchAudit(admin, { action: 'goal.*', limit: 50 }), (r) => `rows=${r.data.length}`);
  await time('audit entity history (one goal)', () => searchAudit(admin, { entityId: mine.id, limit: 100 }), (r) => `rows=${r.data.length}`);
  await time(`verify hash chain over ${ev + 20000} events`, () => verifyAuditChain(admin), (r) => `intact=${r.intact}`);
  let sent = 0; setMailTransportForTests({ sendMail: async () => { sent++; } });
  await withOrg(O, (tx) => tx.exec(`insert into notification_deliveries (org_id, channel, user_id, payload) select $1, 'email', u.id, '{"subject":"s","text":"t"}' from users u where u.org_id = $1 limit 5000`, [O]));
  const queued = (await withOrg(O, (tx) => tx.one<{ n: number }>(`select count(*)::int as n from notification_deliveries where org_id = $1 and status = 'pending'`, [O])))!.n;
  await time(`deliver ${queued} queued emails (fake SMTP, batch 200, 4 workers)`, async () => { for (let i = 0; i < 7; i++) await Promise.all([1, 2, 3, 4].map(() => processDeliveries(200))); }, () => `sent=${sent}`);
  console.log('\nSummary (milliseconds, this machine):\n');
  console.log(['| Operation | Time | Note |', '|---|---|---|', ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`)].join('\n'));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closePool());
