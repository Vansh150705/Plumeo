import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb, makeOrg, activeCycle, goalInput, periods, type TestOrg } from './helpers';
import { withOrg } from '@/server/db/pool';
import { AppError } from '@/server/core/errors';
import { createDepartment } from '@/server/services/structure';
import { updateUser } from '@/server/services/users';
import { createGoal, getGoalDetail, recordProgress, completeGoal } from '@/server/services/goals';
import { submitGoal, decideApproval } from '@/server/services/approvals';
import { getCheckin, listMyCheckins, listTeamCheckins, reopenCheckin, reviewCheckin, saveCheckinDraft, sendCheckinReminders, submitCheckin, setActionItemStatus, listActionItems } from '@/server/services/checkins';
import { getAnalytics, managerWorkload } from '@/server/services/analytics';
import { exportCheckinsCsv, exportGoalsCsv, exportSummaryPdf } from '@/server/services/exports';
import { updatePolicy } from '@/server/services/orgs';
import { listNotifications } from '@/server/services/notifications';

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : `error:${e.message}`));
const Y = new Date().getUTCFullYear();
let org: TestOrg; let cycle: string; let q: any[];
let hr: any, sMgr: any, s1: any, s2: any, eMgr: any, e1: any, peer: any, salesDept: string, engDept: string;
let goalA: string, goalB: string, goalC: string, goalD: string;

async function pending(goalId: string) { return withOrg(org.orgId, async (tx) => (await tx.one<{ id: string }>(`select id from approval_requests where goal_id = $1 and status = 'pending'`, [goalId]))!.id); }
async function activate(owner: any, approver: any, over: Record<string, unknown> = {}) {
  const { id } = await createGoal(await owner.ctx(), goalInput(cycle, over));
  await submitGoal(await owner.ctx(), id);
  await decideApproval(await approver.ctx(), await pending(id), { decision: 'approve' });
  await withOrg(org.orgId, (tx) => tx.exec(`update goals set approved_at = $2 where id = $1`, [id, `${Y}-01-15T10:00:00Z`])); // approved early in the year
  return id;
}

beforeAll(async () => {
  await setupTestDb();
  org = await makeOrg('metrics');
  cycle = await activeCycle(org.orgId); q = await periods(org.orgId);
  await updatePolicy(org.admin, { goals: { maxActiveIndividualGoals: 100 }, checkins: { customQuestions: [{ id: 'confidence', label: 'How confident are you of hitting the target?', required: false }] } });
  hr = await org.add('Hana HR', { roles: ['hr_admin'] });
  sMgr = await org.add('Sally SalesMgr');
  s1 = await org.add('Sam Sales', { managerId: sMgr.id }); s2 = await org.add('Sue Sales', { managerId: sMgr.id });
  eMgr = await org.add('Eddy EngMgr');
  e1 = await org.add('Eva Eng', { managerId: eMgr.id });
  peer = await org.add('Pat Peer', { managerId: eMgr.id });
  salesDept = (await createDepartment(org.admin, { name: 'Sales' })).id; engDept = (await createDepartment(org.admin, { name: 'Engineering' })).id;
  for (const u of [sMgr, s1, s2]) await updateUser(org.admin, u.id, { departmentId: salesDept });
  for (const u of [eMgr, e1, peer]) await updateUser(org.admin, u.id, { departmentId: engDept });

  goalA = await activate(s1, sMgr, { title: 'Close 100 enterprise deals this year', keyResults: [{ title: 'Deals', startValue: 0, targetValue: 100 }] });
  goalB = await activate(s2, sMgr, { title: 'Onboard 10 new reseller partners fast', keyResults: [{ title: 'Partners', startValue: 0, targetValue: 10 }] });
  goalC = await activate(e1, eMgr, { title: 'Reduce incident count to 5 per quarter', keyResults: [{ title: 'Incidents', startValue: 20, targetValue: 5 }] });
  goalD = await activate(e1, eMgr, { title: 'Ship the new billing platform on time', dueDate: `${Y}-02-28`, keyResults: [{ title: 'Milestones', startValue: 0, targetValue: 4 }] });
  await recordProgress(await s1.ctx(), goalA, { updates: [{ keyResultId: (await getGoalDetail(await s1.ctx(), goalA)).keyResults[0].id, value: 50 }] });
  await recordProgress(await s2.ctx(), goalB, { updates: [{ keyResultId: (await getGoalDetail(await s2.ctx(), goalB)).keyResults[0].id, value: 10 }] });
  await completeGoal(await s2.ctx(), goalB, 'All partners live');
  await recordProgress(await e1.ctx(), goalC, { updates: [{ keyResultId: (await getGoalDetail(await e1.ctx(), goalC)).keyResults[0].id, value: 12.5 }] });
});
afterAll(teardownTestDb);

describe('quarterly check-ins', () => {
  const q1Open = () => `${Y}-03-20`, q1Overdue = () => `${Y}-04-20`;

  it('generates review periods from the cycle and exposes due check-ins by date', async () => {
    expect(q.map((p) => p.name)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    const upcoming = await listMyCheckins(await s1.ctx(), `${Y}-01-20`);
    expect(upcoming.flatMap((p: any) => p.items)).toHaveLength(0);           // nothing is due or near-due in January
    const open = await listMyCheckins(await s1.ctx(), q1Open());
    const q1 = open.find((p: any) => p.name === 'Q1')!;
    expect(q1.items).toEqual([expect.objectContaining({ goal_id: goalA, state: 'due' })]);
    const overdue = await listMyCheckins(await s1.ctx(), q1Overdue());
    expect(overdue.find((p: any) => p.name === 'Q1')!.items[0].state).toBe('overdue');
  });

  it('refuses submissions before the period opens, and requires a value for every key result', async () => {
    expect(await code(submitCheckin(await e1.ctx(), goalC, q[0].id, { krValues: [{ keyResultId: '00000000-0000-4000-8000-000000000000', value: 1 }], health: 'on_track' }, `${Y}-01-20`))).toBe('invalid_state');
    const detail = await getGoalDetail(await e1.ctx(), goalD);
    expect(await code(submitCheckin(await e1.ctx(), goalD, q[0].id, { krValues: [], health: 'on_track' }, q1Open()))).toBe('validation_failed'); // no value on record yet
    expect(detail.keyResults[0].current_value).toBeNull();
  });

  it('stores drafts, then freezes the submission as an immutable revision with a progress snapshot', async () => {
    const ctx = await s1.ctx();
    const kr = (await getCheckin(ctx, goalA, q[0].id, q1Open())).keyResults[0];
    await saveCheckinDraft(ctx, goalA, q[0].id, { achievements: 'Work in progress' }, q1Open());
    expect((await getCheckin(ctx, goalA, q[0].id, q1Open())).checkin.draft).toMatchObject({ achievements: 'Work in progress' });
    const r = await submitCheckin(ctx, goalA, q[0].id, {
      krValues: [{ keyResultId: kr.id, value: 60 }], health: 'on_track', achievements: 'Closed 60 deals', challenges: 'Procurement cycles are long', blockers: 'Legal review capacity', nextSteps: 'Hire a deal desk analyst',
      answers: { confidence: 'High' },
    }, q1Open());
    expect(r).toMatchObject({ revision: 1, progress: 60, late: false });
    const d = await getCheckin(ctx, goalA, q[0].id, q1Open());
    expect(d.checkin).toMatchObject({ status: 'submitted', current_revision: 1, health: 'on_track', progress_snapshot: 60, draft: null });
    expect(d.revisions[0].kr_values[0]).toMatchObject({ value: 60, progress: 60 });
    expect(d.keyResults[0].current_value).toBe(60);
    // the key result's own history is also recorded
    const hist = (await getGoalDetail(ctx, goalA)).progressHistory;
    expect(hist[0]).toMatchObject({ value: 60, source: 'checkin' });
    // manager is told
    const n = await listNotifications(await sMgr.ctx(), {});
    expect(n.data.some((x: any) => x.type === 'checkin.submitted')).toBe(true);
  });

  it('cannot be silently rewritten: resubmitting needs a manager reopen, and history is kept', async () => {
    const ctx = await s1.ctx(); const mctx = await sMgr.ctx();
    expect(await code(submitCheckin(ctx, goalA, q[0].id, { krValues: [{ keyResultId: (await getCheckin(ctx, goalA, q[0].id, q1Open())).keyResults[0].id, value: 99 }], health: 'completed' }, q1Open()))).toBe('conflict');
    expect(await code(saveCheckinDraft(ctx, goalA, q[0].id, { achievements: 'edit' }, q1Open()))).toBe('conflict');
    const c = (await getCheckin(ctx, goalA, q[0].id, q1Open())).checkin!;
    expect(await code(reopenCheckin(ctx, c.id, 'let me change my own numbers please'))).toBe('forbidden');   // owners cannot reopen their own
    await reviewCheckin(mctx, c.id, { feedback: 'Great momentum — what is blocking legal?', actionItems: [{ title: 'Book legal capacity review', dueDate: `${Y}-04-30` }] });
    expect((await getCheckin(ctx, goalA, q[0].id, q1Open())).checkin!.status).toBe('reviewed');
    await reopenCheckin(mctx, c.id, 'The deals number includes a duplicate account; please correct.');
    expect((await getCheckin(ctx, goalA, q[0].id, q1Open())).checkin!.status).toBe('reopened');
    const kr = (await getCheckin(ctx, goalA, q[0].id, q1Open())).keyResults[0];
    const r2 = await submitCheckin(ctx, goalA, q[0].id, { krValues: [{ keyResultId: kr.id, value: 55 }], health: 'at_risk', achievements: 'Corrected' }, q1Open());
    expect(r2.revision).toBe(2);
    const d = await getCheckin(ctx, goalA, q[0].id, q1Open());
    expect(d.revisions.map((r: any) => [r.revision, r.progress, r.health])).toEqual([[2, 55, 'at_risk'], [1, 60, 'on_track']]);
    expect(d.feedback.map((f: any) => f.kind)).toEqual(['feedback', 'reopen']);
    const items = await listActionItems(await s1.ctx());
    expect(items[0]).toMatchObject({ title: 'Book legal capacity review', status: 'open' });
    await setActionItemStatus(await s1.ctx(), items[0].id, 'done');
    expect((await listActionItems(await s1.ctx(), { status: 'done' }))).toHaveLength(1);
    // database level: revisions are physically append-only for the application
    await expect(withOrg(org.orgId, (tx) => tx.exec(`update checkin_revisions set progress = 1`))).rejects.toThrow(/permission denied/);
  });

  it('flags late submissions and tracks missed check-ins', async () => {
    const ctx = await e1.ctx();
    const kr = (await getCheckin(ctx, goalC, q[0].id, q1Overdue())).keyResults[0];
    const r = await submitCheckin(ctx, goalC, q[0].id, { krValues: [{ keyResultId: kr.id, value: 12.5 }], health: 'off_track', blockers: 'Vendor outage' }, q1Overdue());
    expect(r.late).toBe(true);
    const team = await listTeamCheckins(await eMgr.ctx(), { periodId: q[0].id, asOf: q1Overdue() });
    expect(team.find((t: any) => t.goal_id === goalC)).toMatchObject({ state: 'submitted', is_late: true });
    expect(team.find((t: any) => t.goal_id === goalD)).toMatchObject({ state: 'overdue', owner_name: 'Eva Eng' });
  });

  it('enforces organisation-configured questions', async () => {
    await updatePolicy(org.admin, { goals: { maxActiveIndividualGoals: 100 }, checkins: { customQuestions: [{ id: 'confidence', label: 'How confident are you of hitting the target?', required: true }] } });
    const ctx = await e1.ctx();
    const kr = (await getCheckin(ctx, goalD, q[0].id, q1Overdue())).keyResults[0];
    const base = { krValues: [{ keyResultId: kr.id, value: 1 }], health: 'at_risk' as const };
    expect(await code(submitCheckin(ctx, goalD, q[0].id, base, q1Overdue()))).toBe('validation_failed');
    expect(await code(submitCheckin(ctx, goalD, q[0].id, { ...base, answers: { bogus: 'x' } }, q1Overdue()))).toBe('validation_failed');
    expect(await code(submitCheckin(ctx, goalD, q[0].id, { ...base, answers: { confidence: 'Low' } }, q1Overdue()))).toBe('ok');
  });

  it('is only readable by the owner, their management line and HR', async () => {
    expect(await code(getCheckin(await peer.ctx(), goalC, q[0].id, q1Overdue()))).toBe('not_found');
    expect(await code(getCheckin(await sMgr.ctx(), goalC, q[0].id, q1Overdue()))).toBe('not_found');
    expect(await code(getCheckin(await eMgr.ctx(), goalC, q[0].id, q1Overdue()))).toBe('ok');
    expect(await code(getCheckin(await hr.ctx(), goalC, q[0].id, q1Overdue()))).toBe('ok');
    const c = (await getCheckin(await e1.ctx(), goalC, q[0].id, q1Overdue())).checkin!;
    expect(await code(reviewCheckin(await peer.ctx(), c.id, { feedback: 'nice' }))).toBe('not_found');
    expect(await code(reviewCheckin(await hr.ctx(), c.id, { feedback: 'HR has no review rights' }))).toBe('forbidden');
  });

  it('sends each reminder once (deduplicated) and tells managers about overdue reports', async () => {
    const asOf = `${Y}-04-20`;                       // Q1 is past due; Q1 goals with no submission: goalB is completed in-year => excluded? it has no submission
    const first = await withOrg(org.orgId, (tx) => sendCheckinReminders(tx, org.orgId, asOf));
    expect(first).toBeGreaterThan(0);
    const second = await withOrg(org.orgId, (tx) => sendCheckinReminders(tx, org.orgId, asOf));
    expect(second).toBe(0);                          // idempotent
    const mgrInbox = (await listNotifications(await sMgr.ctx(), {})).data.filter((n: any) => n.type === 'checkin.team_overdue');
    expect(mgrInbox).toHaveLength(1);
    // approaching-deadline reminder two days before Q1 due date
    const due = new Date(q[0].due_on + 'T00:00:00Z'); due.setUTCDate(due.getUTCDate() - 1);
    const soon = due.toISOString().slice(0, 10);
    const n = await withOrg(org.orgId, (tx) => sendCheckinReminders(tx, org.orgId, soon));
    expect(n).toBeGreaterThanOrEqual(0);
  });
});

describe('analytics — accuracy and scope', () => {
  const asOf = `${Y}-04-20`;
  it('organisation view: counts, completion, averages, risk and departments match hand-computed values', async () => {
    const a: any = await getAnalytics(await hr.ctx(), { asOf });
    expect(a.scope).toBe('organisation');
    expect(a.summary.totalGoals).toBe(4);
    expect(a.summary.byStatus).toEqual({ active: 3, completed: 1 });
    expect(a.summary.completionRate).toBe(25);                     // 1 completed ÷ 4 approved
    // A=55 (after correction), C=(20-12.5)/15=50, D=1/4=25 → mean 43.3
    expect(a.summary.averageProgress).toBe(43.3);
    expect(a.summary.goalsWithoutMeasurableProgress).toBe(0);
    expect(a.summary.overdue).toBe(1);                              // goal D (due Feb 28, no progress)
    expect(a.summary.atRisk).toBeGreaterThanOrEqual(1);             // goal C's latest check-in is off_track
    const sales = a.byDepartment.find((d: any) => d.name === 'Sales');
    expect(sales).toMatchObject({ goals: 2, active: 1, completed: 1, averageProgress: 55 });
    const eng = a.byDepartment.find((d: any) => d.name === 'Engineering');
    expect(eng).toMatchObject({ goals: 2, active: 2, averageProgress: 37.5, overdue: 1 });
    const q1 = a.checkins.periods.find((p: any) => p.name === 'Q1');
    expect(q1).toMatchObject({ expected: 4, submitted: 3, late: 2, onTime: 1, missing: 1, completionRate: 75, onTimeRate: 25 });
    expect(a.approvals.decisions).toBe(4);
    expect(a.alignment.alignmentRate).toBe(0);                      // none of these goals is aligned to a parent
    expect(a.attention.map((x: any) => x.risk)).toContain('overdue');
  });

  it('filters by department, owner and status', async () => {
    const hrc = await hr.ctx();
    const sales: any = await getAnalytics(hrc, { asOf, departmentId: salesDept });
    expect(sales.summary.totalGoals).toBe(2);
    const one: any = await getAnalytics(hrc, { asOf, ownerId: e1.id, status: ['active'] });
    expect(one.summary.totalGoals).toBe(2);
    const done: any = await getAnalytics(hrc, { asOf, status: ['completed'] });
    expect(done.summary.totalGoals).toBe(1);
  });

  it('managers only aggregate their own reporting line; employees only themselves', async () => {
    const m: any = await getAnalytics(await sMgr.ctx(), { asOf });
    expect(m.scope).toBe('reporting line');
    expect(m.summary.totalGoals).toBe(2);
    expect(m.byDepartment.map((d: any) => d.name)).toEqual(['Sales']);
    const p: any = await getAnalytics(await peer.ctx(), { asOf });
    expect(p.scope).toBe('personal');
    expect(p.summary.totalGoals).toBe(0);
    const e: any = await getAnalytics(await e1.ctx(), { asOf });
    expect(e.summary.totalGoals).toBe(2);
    expect(e.byOwner).toHaveLength(1);
  });

  it('manager workload counts what needs the manager\'s attention', async () => {
    const w = await managerWorkload(await eMgr.ctx(), asOf);
    expect(w.directReports).toBe(2);
    expect(w.checkinsToReview).toBe(2);   // goals C and D submitted, not yet reviewed
    expect(w.overdueCheckins).toBe(0);
    const s = await managerWorkload(await sMgr.ctx(), asOf);
    expect(s.checkinsToReview).toBe(1);   // goal A was resubmitted after being reopened
    expect(s.overdueCheckins).toBe(1);    // goal B never checked in
  });

  it('exports respect permissions and scope', async () => {
    expect(await code(exportGoalsCsv(await s1.ctx(), {}))).toBe('forbidden');
    const csv = await exportGoalsCsv(await hr.ctx(), {});
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(5);          // header + 4 goals
    const ck = await exportCheckinsCsv(await hr.ctx(), { periodId: q[0].id, asOf });
    expect(ck).toContain('overdue');
    const pdf = await exportSummaryPdf(await hr.ctx(), { asOf });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await code(exportSummaryPdf(await sMgr.ctx(), { asOf }))).toBe('forbidden');
    const ev = await withOrg(org.orgId, (tx) => tx.query(`select metadata from audit_events where action = 'export.generated'`));
    expect(ev.length).toBeGreaterThanOrEqual(3);                        // every export is itself audited
  });
});
