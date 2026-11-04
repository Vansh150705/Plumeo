/*
 * Seeds a realistic SYNTHETIC demo organisation ("Northwind Labs") through the same service layer the app
 * uses, so every record is created by the real rules (approvals, versions, audit events...).
 *
 *   npm run seed            # refuses to run when NODE_ENV=production
 *
 * Demo password for every account: $SEED_PASSWORD (default "PlumeoDemo!2026"). Development use only.
 */
import { closePool, withSystem, withOrg } from '../server/db/pool';
import { createOrganization } from '../server/services/orgs';
import { loadAccess } from '../server/services/rbac-load';
import { createUser, updateUser } from '../server/services/users';
import { assignRole } from '../server/services/rbac';
import { createDepartment, createTeam, updateDepartment, updateTeam } from '../server/services/structure';
import { createGoal, recordProgress, getGoalDetail, completeGoal } from '../server/services/goals';
import { submitGoal, decideApproval } from '../server/services/approvals';
import { proposeAmendment } from '../server/services/amendments';
import { redeemCredentialToken } from '../server/auth/login';
import { submitCheckin, reviewCheckin } from '../server/services/checkins';
import { createTemplate } from '../server/services/templates';
import { updatePolicy } from '../server/services/orgs';
import type { Ctx } from '../server/core/context';

if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed demo data in production.'); process.exit(1); }
const PASSWORD = process.env.SEED_PASSWORD ?? 'PlumeoDemo!2026';
const SLUG = process.env.SEED_ORG ?? 'northwind';
const Y = new Date().getUTCFullYear();

async function ctxFor(orgId: string, userId: string): Promise<Ctx> {
  return withSystem(async (tx) => {
    const u = await tx.one<{ full_name: string }>('select full_name from users where org_id = $1 and id = $2', [orgId, userId]);
    const a = await loadAccess(tx, orgId, userId);
    return { orgId, userId, userName: u!.full_name, perms: a.perms, roleKeys: a.roleKeys, requestId: 'seed', actorType: 'user' };
  });
}

async function main() {
  const existing = await withSystem((tx) => tx.one('select id from orgs where slug = $1', [SLUG]));
  if (existing) { console.log(`Organisation "${SLUG}" already exists — nothing to do.`); return; }
  const org = await createOrganization({ name: 'Northwind Labs', slug: SLUG, adminName: 'Priya Shah', adminEmail: 'priya.shah@northwind.test', adminPassword: PASSWORD, createFirstCycle: true }, { requestId: 'seed' });
  const O = org.orgId;
  const admin = await ctxFor(O, org.adminId);
  await updatePolicy(admin, { goals: { maxActiveIndividualGoals: 12 }, checkins: { customQuestions: [{ id: 'support', label: 'What support do you need from leadership?', required: false }] } });

  const people: Record<string, { id: string; email: string }> = {};
  async function person(key: string, name: string, title: string, over: { manager?: string; dept?: string; team?: string; roles?: string[] } = {}) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@northwind.test`;
    const r = await createUser(await ctxFor(O, org.adminId), { email, fullName: name, jobTitle: title, managerId: over.manager ? people[over.manager].id : null, departmentId: over.dept ?? null, teamId: over.team ?? null });
    await redeemCredentialToken({ token: r.inviteToken!, password: PASSWORD }, { requestId: 'seed', ip: `seed-${key}` });
    for (const role of over.roles ?? []) await assignRole(await ctxFor(O, org.adminId), r.id, role);
    people[key] = { id: r.id, email };
    return r.id;
  }

  await person('hana', 'Hana Okafor', 'Head of People', { roles: ['hr_admin'] });
  await person('carlos', 'Carlos Mendes', 'Chief Executive');
  const eng = await createDepartment(admin, { name: 'Engineering', kind: 'business_unit' });
  const sales = await createDepartment(admin, { name: 'Sales', kind: 'business_unit' });
  const ops = await createDepartment(admin, { name: 'People Operations' });
  await person('lakshmi', 'Lakshmi Raman', 'VP Engineering', { manager: 'carlos', dept: eng.id });
  await person('arjun', 'Arjun Mehta', 'VP Sales', { manager: 'carlos', dept: sales.id });
  await updateUser(await ctxFor(O, org.adminId), people.hana.id, { departmentId: ops.id, managerId: people.carlos.id });
  const backend = await createTeam(admin, { name: 'Backend', departmentId: eng.id });
  const platform = await createTeam(admin, { name: 'Platform', departmentId: eng.id });
  const enterprise = await createTeam(admin, { name: 'Enterprise Sales', departmentId: sales.id });
  await person('kabir', 'Kabir Malhotra', 'Engineering Manager', { manager: 'lakshmi', dept: eng.id, team: backend.id });
  await person('ananya', 'Ananya Sharma', 'Senior Engineer', { manager: 'kabir', dept: eng.id, team: backend.id });
  await person('tomas', 'Tomas Weber', 'Engineer', { manager: 'kabir', dept: eng.id, team: backend.id });
  await person('mei', 'Mei Lin', 'Platform Engineer', { manager: 'lakshmi', dept: eng.id, team: platform.id });
  await person('rohan', 'Rohan Kapoor', 'Account Executive', { manager: 'arjun', dept: sales.id, team: enterprise.id });
  await person('neha', 'Neha Iyer', 'Account Executive', { manager: 'arjun', dept: sales.id, team: enterprise.id });
  await person('sofia', 'Sofia Rossi', 'Recruiter', { manager: 'hana', dept: ops.id });
  await updateDepartment(admin, eng.id, { headUserId: people.lakshmi.id });   // also grants the department-head role
  await updateDepartment(admin, sales.id, { headUserId: people.arjun.id });
  await updateTeam(admin, backend.id, { leadUserId: people.kabir.id });

  const cycle = (await withOrg(O, (tx) => tx.one<{ id: string }>(`select id from cycles where status = 'active' limit 1`)))!.id;
  const periods = await withOrg(O, (tx) => tx.query<{ id: string; name: string; opens_on: string; due_on: string }>(`select id, name, opens_on, due_on from review_periods where org_id = $1 order by sequence`, [O]));
  const c = (k: string) => ctxFor(O, people[k].id);
  const kr = (title: string, start: number, target: number, extra: object = {}) => ({ title, metricType: 'number', startValue: start, targetValue: target, ...extra });
  const base = (over: object) => ({ cycleId: cycle, level: 'individual', startDate: `${Y}-01-01`, dueDate: `${Y}-12-31`, ...over });
  async function pendingId(goalId: string) { return withOrg(O, async (tx) => (await tx.one<{ id: string }>(`select id from approval_requests where goal_id = $1 and status = 'pending'`, [goalId]))!.id); }
  async function activate(owner: string, input: any, approvers: string[], backdate = `${Y}-01-20T09:00:00Z`) {
    const { id } = await createGoal(await c(owner), base(input));
    await submitGoal(await c(owner), id);
    for (const a of approvers) await decideApproval(a === 'admin' ? admin : await c(a), await pendingId(id), { decision: 'approve', comment: 'Aligned with plan.' });
    await withOrg(O, (tx) => tx.exec('update goals set approved_at = $2 where id = $1', [id, backdate]));
    return id;
  }
  const setKr = async (owner: string, goalId: string, values: number[], note?: string) => {
    const d = await getGoalDetail(await c(owner), goalId);
    await recordProgress(await c(owner), goalId, { updates: d.keyResults.map((k: any, i: number) => ({ keyResultId: k.id, value: values[i], note })) });
  };

  // ---- company goals (authored by HR / CEO, approved by a *different* administrator) ----
  const g1 = await activate('hana', { level: 'company', title: 'Reach 25M ARR with healthy margins', description: 'Grow recurring revenue while holding gross margin above 72 percent.', expectedOutcome: 'Sustainable growth that funds the product roadmap.', progressMode: 'rollup', priority: 'critical', keyResults: [kr('Annual recurring revenue (M)', 16, 25)] }, ['admin']);
  const g2 = await activate('hana', { level: 'company', title: 'Become the most loved product in our category', description: 'Raise customer satisfaction and reliability together.', expectedOutcome: 'Customers recommend us unprompted.', progressMode: 'rollup', priority: 'high', keyResults: [kr('Net promoter score', 31, 50)] }, ['admin']);
  // ---- department goals ----
  const dSales = await activate('arjun', { level: 'department', departmentId: sales.id, parentGoalId: g1, title: 'Land 40 new enterprise customers this year', description: 'Expand the enterprise segment through direct sales and partners.', expectedOutcome: 'A healthy enterprise pipeline and closed-won revenue.', progressMode: 'rollup', priority: 'critical', keyResults: [kr('New enterprise logos', 0, 40)] }, ['carlos']);
  const dEng = await activate('lakshmi', { level: 'department', departmentId: eng.id, parentGoalId: g2, title: 'Reach 99.95 percent platform availability', description: 'Invest in reliability engineering and incident response.', expectedOutcome: 'Fewer, shorter incidents that customers barely notice.', progressMode: 'rollup', priority: 'high', keyResults: [kr('Availability (%)', 99.5, 99.95)] }, ['carlos']);
  // ---- team + individual goals ----
  const tBack = await activate('kabir', { level: 'team', teamId: backend.id, parentGoalId: dEng, title: 'Cut API p99 latency below 250 ms', description: 'Optimise the hottest endpoints and database access paths.', expectedOutcome: 'A noticeably faster product.', progressMode: 'rollup', keyResults: [kr('p99 latency (ms)', 480, 250)] }, ['lakshmi']);
  const iAna = await activate('ananya', { parentGoalId: tBack, title: 'Reduce billing API p99 latency from 480 ms to 300 ms', description: 'Profile and fix the slowest billing queries.', expectedOutcome: 'Billing pages load in under a second.', priority: 'high', keyResults: [kr('Billing API p99 (ms)', 480, 300), kr('Slow queries fixed', 0, 12)] }, ['kabir']);
  const iTom = await activate('tomas', { parentGoalId: tBack, title: 'Introduce read replicas for reporting queries', description: 'Move heavy analytics queries off the primary database.', expectedOutcome: 'Primary CPU stays under 60 percent at peak.', keyResults: [kr('Reporting queries moved (%)', 0, 100)] }, ['kabir']);
  const iMei = await activate('mei', { parentGoalId: dEng, title: 'Automate zero-downtime deploys for all services', description: 'Standardise rollout, health checks and automatic rollback.', expectedOutcome: 'No customer-visible downtime during deploys.', keyResults: [kr('Services migrated', 0, 14), kr('Deploy-related incidents', 6, 0)] }, ['lakshmi']);
  const iRoh = await activate('rohan', { parentGoalId: dSales, title: 'Close 12 enterprise deals worth 3M in new ARR', description: 'Focus on regulated industries where we are strongest.', expectedOutcome: 'Hit the personal quota with a healthy win rate.', priority: 'critical', keyResults: [kr('Closed-won deals', 0, 12), kr('New ARR (M)', 0, 3)] }, ['arjun']);
  const iNeh = await activate('neha', { parentGoalId: dSales, title: 'Build a 5M qualified pipeline through partners', description: 'Recruit and enable three channel partners.', expectedOutcome: 'Partners contribute a third of qualified pipeline.', keyResults: [kr('Qualified pipeline (M)', 0, 5), kr('Active partners', 0, 3)] }, ['arjun']);

  // ---- progress + check-ins (dates backdated through the service's asOf parameter) ----
  await setKr('ananya', iAna, [390, 7], 'Index changes landed'); await setKr('tomas', iTom, [40]); await setKr('mei', iMei, [6, 4]); await setKr('rohan', iRoh, [5, 1.2]); await setKr('neha', iNeh, [1.4, 1]);
  await setKr('kabir', tBack, [400]); await setKr('arjun', dSales, [14]); await setKr('lakshmi', dEng, [99.7]);
  const q1 = periods[0], q2 = periods[1];
  const mid = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  async function checkin(owner: string, goalId: string, period: typeof q1, vals: number[], health: string, text: Record<string, string>, late = false) {
    const ctx = await c(owner); const d = await getGoalDetail(ctx, goalId);
    await submitCheckin(ctx, goalId, period.id, { krValues: d.keyResults.map((k: any, i: number) => ({ keyResultId: k.id, value: vals[i] })), health: health as any, answers: { support: 'Prioritisation help when requests collide.' }, ...text }, late ? mid(period.due_on, 3) : mid(period.opens_on, 2));
  }
  await checkin('ananya', iAna, q1, [450, 2], 'on_track', { achievements: 'Profiled the top ten queries.', nextSteps: 'Roll out index changes.' });
  await checkin('ananya', iAna, q2, [390, 7], 'on_track', { achievements: 'Seven slow queries fixed, p99 down to 390 ms.', challenges: 'Legacy reporting job competes for IO.' });
  await checkin('tomas', iTom, q1, [10], 'at_risk', { challenges: 'Replica lag is higher than expected.', blockers: 'Waiting for a larger instance class.' });
  await checkin('rohan', iRoh, q1, [1, 0.2], 'on_track', { achievements: 'Two pilots converted to contracts.' });
  await checkin('rohan', iRoh, q2, [5, 1.2], 'on_track', { achievements: 'Closed five deals, strong Q2.' }, true);
  await checkin('neha', iNeh, q1, [0.5, 0], 'off_track', { challenges: 'No partner enablement material yet.', blockers: 'Legal terms for the partner programme.' });
  await checkin('mei', iMei, q1, [3, 5], 'on_track', { achievements: 'Migrated the first three services.' });
  const rev = async (owner: string, mgr: string, goalId: string, period: typeof q1, fb: string, actions?: { title: string }[]) => {
    const d = await getGoalDetail(await c(owner), goalId); const ci = d.checkins.find((x: any) => x.period_id === period.id);
    await reviewCheckin(await c(mgr), ci.id, { feedback: fb, actionItems: actions });
  };
  await rev('ananya', 'kabir', iAna, q1, 'Solid start. Please document the profiling approach for the team.', [{ title: 'Write up the query profiling playbook' }]);
  await rev('tomas', 'kabir', iTom, q1, 'Let us escalate the instance request this week — I will raise it with Lakshmi.');
  await rev('neha', 'arjun', iNeh, q1, 'Understood. I will get legal terms unblocked; you draft the enablement deck.', [{ title: 'Draft partner enablement deck' }]);

  // ---- goals in every workflow state ----
  await createGoal(await c('sofia'), base({ title: 'Cut average time-to-hire to 35 days', description: 'Streamline interview scheduling and offers.', keyResults: [kr('Time to hire (days)', 52, 35)] }));      // draft
  const pend = await createGoal(await c('tomas'), base({ title: 'Create an on-call runbook for the backend team', description: 'Document the top twenty alerts and responses.', expectedOutcome: 'New on-call engineers resolve incidents faster.', keyResults: [kr('Alerts documented', 0, 20)] }));
  await submitGoal(await c('tomas'), pend.id);                                                                                                  // pending approval
  const chg = await createGoal(await c('neha'), base({ title: 'Improve customer reference programme', description: 'Make references easy to find and use.', expectedOutcome: 'More deals supported by references.', keyResults: [kr('Active references', 5, 25)] }));
  await submitGoal(await c('neha'), chg.id); await decideApproval(await c('arjun'), await pendingId(chg.id), { decision: 'request_changes', comment: 'Add a measurable link to win rate and name the owner of the reference list.' });
  const done = await activate('mei', { title: 'Set up the new CI pipeline for all services', description: 'Replace the legacy build servers.', expectedOutcome: 'Faster, reproducible builds.', startDate: `${Y}-01-01`, dueDate: `${Y}-06-30`, keyResults: [kr('Services on new CI', 0, 14)] }, ['lakshmi']);
  await setKr('mei', done, [14]); await completeGoal(await c('mei'), done, 'All services migrated two weeks early.');
  const am = await activate('rohan', { title: 'Expand into the financial-services vertical', description: 'Build references and compliance material.', expectedOutcome: 'Three reference customers in financial services.', keyResults: [kr('Reference customers', 0, 3)] }, ['arjun']);
  await proposeAmendment(await c('rohan'), am, { reason: 'Market conditions: raise the target after two early wins.', changes: { keyResults: [{ id: (await getGoalDetail(await c('rohan'), am)).keyResults[0].id, title: 'Reference customers', startValue: 0, targetValue: 5 }] } }); // amendment awaiting approval
  await createTemplate(admin, { name: 'Reduce incident count', level: 'team', content: { title: 'Reduce production incidents by half', description: 'Find and remove recurring causes of incidents.', expectedOutcome: 'Fewer pages and a calmer on-call.', priority: 'high', keyResults: [{ title: 'Incidents per quarter', metricType: 'number', startValue: 20, targetValue: 10, weight: 1 }] } });
  await createTemplate(admin, { name: 'Grow qualified pipeline', level: 'individual', content: { title: 'Build qualified pipeline for the next two quarters', description: 'Source and qualify opportunities in your segment.', expectedOutcome: 'Pipeline coverage of at least 3x quota.', keyResults: [{ title: 'Qualified pipeline (M)', metricType: 'number', startValue: 0, targetValue: 4, weight: 1 }] } });

  console.log(`\nSeeded "Northwind Labs" — sign in at /login with workspace "${SLUG}" and password "${PASSWORD}":\n`);
  console.log('  Org admin      priya.shah@northwind.test');
  console.log('  HR admin       hana.okafor@northwind.test');
  console.log('  Dept head      lakshmi.raman@northwind.test  /  arjun.mehta@northwind.test');
  console.log('  Team manager   kabir.malhotra@northwind.test');
  console.log('  Employees      ananya.sharma@ / tomas.weber@ / rohan.kapoor@ / neha.iyer@ / mei.lin@ / sofia.rossi@northwind.test\n');
  void g2;
}
main().then(() => closePool()).catch(async (e) => { console.error(e); await closePool(); process.exit(1); });
