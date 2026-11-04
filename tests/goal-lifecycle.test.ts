import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb, makeOrg, activeCycle, goalInput, ctxFor, type TestOrg } from './helpers';
import { withOrg } from '@/server/db/pool';
import { createDepartment } from '@/server/services/structure';
import { updateUser } from '@/server/services/users';
import { createGoal, updateGoal, getGoalDetail, listGoals, recordProgress, completeGoal, cancelGoal, transferOwnership, getAlignment, deleteDraftGoal } from '@/server/services/goals';
import { submitGoal, decideApproval, withdrawSubmission, listApprovalQueue, createDelegation } from '@/server/services/approvals';
import { proposeAmendment, getVersion } from '@/server/services/amendments';
import { updatePolicy } from '@/server/services/orgs';
import { AppError } from '@/server/core/errors';

let org: TestOrg; let cycle: string;
let hr: any, cto: any, vp: any, mgr: any, emp1: any, emp2: any, emp3: any, stranger: any;
let engDept: string, backendDept: string;

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : `error:${e.message}`));
const pendingRequest = async (goalId: string) => withOrg(org.orgId, async (tx) => (await tx.one<{ id: string }>(`select id from approval_requests where goal_id = $1 and status = 'pending'`, [goalId]))?.id as string);
async function approveAs(who: any, goalId: string, decision: 'approve' | 'reject' | 'request_changes' = 'approve', comment?: string) {
  const c = typeof who.ctx === 'function' ? await who.ctx() : who;
  return decideApproval(c, await pendingRequest(goalId), { decision, comment });
}
async function newSubmittedGoal(owner: any, over: Record<string, unknown> = {}) {
  const { id } = await createGoal(await owner.ctx(), goalInput(cycle, over));
  await submitGoal(await owner.ctx(), id);
  return id;
}

beforeAll(async () => {
  await setupTestDb();
  org = await makeOrg('lifecycle');
  cycle = await activeCycle(org.orgId);
  hr = await org.add('Hana HR', { roles: ['hr_admin'] });
  cto = await org.add('Carl CTO');
  vp = await org.add('Vera VP', { managerId: cto.id });
  mgr = await org.add('Marco Manager', { managerId: vp.id });
  emp1 = await org.add('Emma Employee', { managerId: mgr.id });
  emp2 = await org.add('Eli Employee', { managerId: mgr.id });
  emp3 = await org.add('Eve Elsewhere', { managerId: cto.id });
  stranger = await org.add('Sam Stranger');
  const eng = await createDepartment(org.admin, { name: 'Engineering', headUserId: vp.id });
  const be = await createDepartment(org.admin, { name: 'Backend', parentId: eng.id, headUserId: mgr.id });
  engDept = eng.id; backendDept = be.id;
  await updatePolicy(org.admin, { goals: { maxActiveIndividualGoals: 100 } });
  for (const u of [mgr, emp1, emp2]) await updateUser(org.admin, u.id, { departmentId: backendDept });
});
afterAll(teardownTestDb);

describe('goal creation and submission', () => {
  it('creates a draft quickly but refuses to let an incomplete goal enter approval', async () => {
    const { id } = await createGoal(await emp1.ctx(), { cycleId: cycle, level: 'individual', title: 'Better' });
    const err: any = await submitGoal(await emp1.ctx(), id).catch((e) => e);
    expect(err.code).toBe('validation_failed');
    const fields = err.details.map((i: any) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'description', 'expected_outcome', 'start_date', 'due_date', 'key_results']));
    const d = await getGoalDetail(await emp1.ctx(), id);
    expect(d.goal.status).toBe('draft');
    expect(d.lint.findings.some((f: any) => f.level === 'warn')).toBe(true);
  });

  it('rejects key results whose target contradicts their direction', async () => {
    const c = await code(createGoal(await emp1.ctx(), goalInput(cycle, { keyResults: [{ title: 'x', direction: 'increase', startValue: 10, targetValue: 5 }] })));
    expect(c).toBe('validation_failed');
  });

  it('uses optimistic locking on edits', async () => {
    const { id, version } = await createGoal(await emp1.ctx(), goalInput(cycle));
    await updateGoal(await emp1.ctx(), id, { expectedVersion: version, priority: 'high' });
    expect(await code(updateGoal(await emp1.ctx(), id, { expectedVersion: version, priority: 'low' }))).toBe('conflict');
  });

  it('only the owner can submit; other users cannot even see the draft', async () => {
    const { id } = await createGoal(await emp1.ctx(), goalInput(cycle));
    expect(await code(submitGoal(await emp2.ctx(), id))).toBe('not_found');
    expect(await code(getGoalDetail(await stranger.ctx(), id))).toBe('not_found');
    expect(await code(submitGoal(await mgr.ctx(), id))).toBe('forbidden'); // visible to the manager, but not theirs to submit
  });

  it('enforces the per-person open-goal cap from policy', async () => {
    const o = await org.add('Cap Person');
    await updatePolicy(org.admin, { goals: { maxActiveIndividualGoals: 2 } });
    await createGoal(await o.ctx(), goalInput(cycle));
    await createGoal(await o.ctx(), goalInput(cycle));
    expect(await code(createGoal(await o.ctx(), goalInput(cycle)))).toBe('invalid_state');
    await updatePolicy(org.admin, { goals: { maxActiveIndividualGoals: 100 } });
  });
});

describe('approval workflow', () => {
  it('routes to the manager, blocks self-approval and non-approvers, then activates on approval', async () => {
    const id = await newSubmittedGoal(emp1);
    expect((await getGoalDetail(await emp1.ctx(), id)).goal.status).toBe('pending_approval');
    const req = await pendingRequest(id);
    expect(await code(decideApproval(await emp1.ctx(), req, { decision: 'approve' }))).toBe('forbidden');
    expect(await code(decideApproval(await emp2.ctx(), req, { decision: 'approve' }))).toBe('not_found'); // peer cannot even see it
    expect(await code(decideApproval(await vp.ctx(), req, { decision: 'approve' }))).toBe('forbidden'); // skip-level manager can see it but is not the assigned approver
    expect((await listApprovalQueue(await mgr.ctx())).some((r: any) => r.goal_id === id)).toBe(true);
    const r = await decideApproval(await mgr.ctx(), req, { decision: 'approve', comment: 'Looks good' });
    expect(r.result).toBe('approved');
    const d = await getGoalDetail(await emp1.ctx(), id);
    expect(d.goal.status).toBe('active');
    expect(d.approvals[0]).toMatchObject({ status: 'approved', decided_by: mgr.id, decision_comment: 'Looks good' });
    expect(d.versions).toHaveLength(1);
    const actions = d.history.map((h: any) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['goal.created', 'goal.submitted', 'goal.approved']));
  });

  it('requires an explanation to reject or request changes, then allows revision and resubmission', async () => {
    const id = await newSubmittedGoal(emp1);
    expect(await code(approveAs(mgr, id, 'reject'))).toBe('validation_failed');
    await approveAs(mgr, id, 'request_changes', 'Please add a stretch target to the KR.');
    let d = await getGoalDetail(await emp1.ctx(), id);
    expect(d.goal.status).toBe('changes_requested');
    expect(d.permissions.edit).toBe(true);
    await updateGoal(await emp1.ctx(), id, { expectedVersion: d.goal.version, keyResults: [{ id: d.keyResults[0].id, title: 'Qualified accounts', startValue: 0, targetValue: 60 }] });
    await submitGoal(await emp1.ctx(), id);
    d = await getGoalDetail(await emp1.ctx(), id);
    expect(d.approvals.filter((a: any) => a.round === 2)).toHaveLength(1);
    expect(d.approvals.find((a: any) => a.round === 1).status).toBe('changes_requested');
    await approveAs(mgr, id, 'reject', 'Out of scope for this cycle.');
    d = await getGoalDetail(await emp1.ctx(), id);
    expect(d.goal.status).toBe('rejected');
    expect(d.versions.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it('cannot edit a pending goal, but the owner can withdraw it', async () => {
    const id = await newSubmittedGoal(emp1);
    const d = await getGoalDetail(await emp1.ctx(), id);
    expect(await code(updateGoal(await emp1.ctx(), id, { expectedVersion: d.goal.version, title: 'Sneaky edit while pending' }))).toBe('invalid_state');
    await withdrawSubmission(await emp1.ctx(), id);
    expect((await getGoalDetail(await emp1.ctx(), id)).goal.status).toBe('draft');
    expect(await pendingRequest(id)).toBeFalsy();
  });

  it('two-level approval for department goals: second level only becomes actionable after the first', async () => {
    const { id } = await createGoal(await mgr.ctx(), goalInput(cycle, { level: 'department', departmentId: backendDept, title: 'Backend reliability programme for FY' }));
    await submitGoal(await mgr.ctx(), id);
    const reqs = (await getGoalDetail(await mgr.ctx(), id)).approvals;
    expect(reqs.map((r: any) => [r.level, r.status, r.approver_id])).toEqual([[1, 'pending', vp.id], [2, 'waiting', cto.id]]);
    expect(await code(decideApproval(await cto.ctx(), reqs[1].id, { decision: 'approve' }))).toBe('conflict'); // level 2 not active yet
    expect((await approveAs(vp, id)).result).toBe('next_level');
    expect((await getGoalDetail(await mgr.ctx(), id)).goal.status).toBe('pending_approval');
    expect((await approveAs(cto, id)).result).toBe('approved');
    expect((await getGoalDetail(await mgr.ctx(), id)).goal.status).toBe('active');
  });

  it('company goals go to the approver pool and the owner can never approve their own', async () => {
    const { id } = await createGoal(await hr.ctx(), goalInput(cycle, { level: 'company', title: 'Reach 10M ARR across the whole company' }));
    await submitGoal(await hr.ctx(), id);
    const req = await pendingRequest(id);
    expect(await code(decideApproval(await hr.ctx(), req, { decision: 'approve' }))).toBe('forbidden'); // owner holds approve_any but may not self-approve
    expect((await decideApproval(org.admin, req, { decision: 'approve' })).result).toBe('approved'); // a different administrator can
  });

  it('prevents a different-person rule bypass: the same user cannot clear two levels', async () => {
    // make a manager chain where one person would be eligible twice via oversight
    const { id } = await createGoal(await mgr.ctx(), goalInput(cycle, { level: 'department', departmentId: backendDept, title: 'Backend cost efficiency initiative' }));
    await submitGoal(await mgr.ctx(), id);
    await approveAs(vp, id); // level 1
    // vp is not the level-2 approver and has no approve_any; admin (approve_any) can oversee level 2
    expect(await code(approveAs(vp, id))).toBe('forbidden');
    expect((await approveAs(org.admin, id)).result).toBe('approved');
  });

  it('delegated approval works inside the window, records on-behalf-of, and is revoked correctly', async () => {
    const id = await newSubmittedGoal(emp2);
    const req = await pendingRequest(id);
    expect(await code(decideApproval(await emp1.ctx(), req, { decision: 'approve' }))).toBe('not_found');
    const now = Date.now();
    const del = await createDelegation(await mgr.ctx(), { delegateId: emp1.id, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 3600_000).toISOString() });
    expect((await decideApproval(await emp1.ctx(), req, { decision: 'approve' })).result).toBe('approved');
    const d = await getGoalDetail(await emp2.ctx(), id);
    expect(d.approvals[0]).toMatchObject({ decided_by: emp1.id, on_behalf_of: mgr.id });
    expect(del.id).toBeTruthy();
  });

  it('a delegate cannot approve their own goal through a delegation', async () => {
    const id = await newSubmittedGoal(emp1);
    const req = await pendingRequest(id);
    const now = Date.now();
    await createDelegation(await mgr.ctx(), { delegateId: emp1.id, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 3600_000).toISOString() });
    expect(await code(decideApproval(await emp1.ctx(), req, { decision: 'approve' }))).toBe('forbidden');
  });

  it('concurrent approvals produce exactly one decision and a consistent state', async () => {
    const id = await newSubmittedGoal(emp1);
    const req = await pendingRequest(id);
    const mctx = await mgr.ctx();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      decideApproval(mctx, req, i % 3 === 0 ? { decision: 'reject', comment: 'No thanks, not this time' } : { decision: 'approve' }).then(() => 'ok', (e) => e.code)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'conflict' || r === 'invalid_state')).toHaveLength(11);
    const d = await getGoalDetail(await emp1.ctx(), id);
    const decided = d.approvals.filter((a: any) => a.decided_at);
    expect(decided).toHaveLength(1);
    expect(d.goal.status).toBe(decided[0].status === 'approved' ? 'active' : 'rejected');
    const events = d.history.filter((h: any) => ['goal.approved', 'goal.rejected'].includes(h.action));
    expect(events).toHaveLength(1);
  });

  it('concurrent submissions of one goal create one approval chain', async () => {
    const { id } = await createGoal(await emp2.ctx(), goalInput(cycle));
    const results = await Promise.all(Array.from({ length: 8 }, async () => submitGoal(await emp2.ctx(), id).then(() => 'ok', (e) => e.code)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    const n = await withOrg(org.orgId, async (tx) => (await tx.one<{ n: number }>(`select count(*)::int as n from approval_requests where goal_id = $1`, [id]))!.n);
    expect(n).toBe(1);
  });

  it('rolls back the whole decision if any step fails (atomicity)', async () => {
    const id = await newSubmittedGoal(emp1);
    const req = await pendingRequest(id);
    // break notification insertion for the owner by making the notification category constraint fail → whole tx must roll back
    await withOrg(org.orgId, (tx) => tx.exec(`create or replace function pg_temp.noop() returns void language sql as 'select 1'`)).catch(() => {});
    const before = await getGoalDetail(await emp1.ctx(), id);
    const bad = await decideApproval(await mgr.ctx(), req, { decision: 'approve', comment: 'x'.repeat(2001) }).then(() => 'ok', (e) => e.code);
    expect(bad).toBe('validation_failed');
    const after = await getGoalDetail(await emp1.ctx(), id);
    expect(after.goal.status).toBe(before.goal.status);
    expect(after.approvals[0].status).toBe('pending');
  });
});

describe('alignment and progress', () => {
  let company: string, dept: string;
  it('aligns individual → department → company and shows the contribution chain', async () => {
    company = (await createGoal(await hr.ctx(), goalInput(cycle, { level: 'company', title: 'Be the most trusted platform in our market', progressMode: 'rollup' }))).id;
    await submitGoal(await hr.ctx(), company); await decideApproval(org.admin, await pendingRequest(company), { decision: 'approve' });
    dept = (await createGoal(await mgr.ctx(), goalInput(cycle, { level: 'department', departmentId: backendDept, parentGoalId: company, title: 'Backend availability above 99.9 percent', progressMode: 'rollup' }))).id;
    await submitGoal(await mgr.ctx(), dept); await approveAs(vp, dept); await approveAs(cto, dept);
    const ind = (await createGoal(await emp1.ctx(), goalInput(cycle, { parentGoalId: dept, title: 'Cut p99 latency of the billing API by 30 percent', keyResults: [{ title: 'p99 ms', startValue: 500, targetValue: 350 }] }))).id;
    await submitGoal(await emp1.ctx(), ind); await approveAs(mgr, ind);
    const d = await getGoalDetail(await emp1.ctx(), ind);
    expect(d.ancestors.map((a: any) => a.id)).toEqual([company, dept]);
    expect(d.ancestors[0].owner_name).toBe('Hana HR');
  });

  it('refuses invalid alignment (inactive parent, wrong level direction, cycles, other cycle)', async () => {
    const draft = (await createGoal(await emp2.ctx(), goalInput(cycle))).id; // draft, not active
    expect(await code(createGoal(await emp1.ctx(), goalInput(cycle, { parentGoalId: draft })))).toBe('validation_failed');
    const ind = await withOrg(org.orgId, async (tx) => (await tx.one<{ id: string }>(`select id from goals where level='individual' and status='active' limit 1`))!.id);
    // company goal cannot align to an individual goal (DB trigger as last line of defence)
    await expect(withOrg(org.orgId, (tx) => tx.exec(`update goals set parent_goal_id = $1 where id = $2`, [ind, company]))).rejects.toThrow(/cannot align/);
    // department goal cannot be its own ancestor
    await expect(withOrg(org.orgId, (tx) => tx.exec(`update goals set parent_goal_id = $1 where id = $2`, [dept, dept]))).rejects.toThrow();
  });

  it('computes rollup progress upward without overwriting children', async () => {
    const ctx = await emp1.ctx();
    const ind = (await listGoals(ctx, { level: ['individual'], status: ['active'], mine: true })).data.find((g: any) => g.parent_goal_id === dept)!;
    const detail = await getGoalDetail(ctx, ind.id);
    await recordProgress(ctx, ind.id, { updates: [{ keyResultId: detail.keyResults[0].id, value: 425, note: 'halfway' }] });
    const after = await getGoalDetail(ctx, ind.id);
    expect(after.goal.progress).toBe(50);
    const deptDetail = await getGoalDetail(await mgr.ctx(), dept);
    expect(deptDetail.goal.progress).toBe(50);               // derived from its only approved child
    expect(deptDetail.goal.contributors).toBe(1);
    const companyDetail = await getGoalDetail(org.admin, company);
    expect(companyDetail.goal.progress).toBe(50);
    // a parent's own data is untouched and the child still reports its own number
    expect((await getGoalDetail(ctx, ind.id)).goal.progress).toBe(50);
    expect(after.progressHistory[0]).toMatchObject({ value: 425, previous_value: null, progress_pct: 50 });
  });

  it('only the owner or a collaborator can record progress; cancelled parents notify children', async () => {
    const ind = (await listGoals(await emp1.ctx(), { status: ['active'], mine: true })).data[0];
    const kr = (await getGoalDetail(await emp1.ctx(), ind.id)).keyResults[0];
    expect(await code(recordProgress(await emp2.ctx(), ind.id, { updates: [{ keyResultId: kr.id, value: 1 }] }))).toMatch(/not_found|forbidden/);
    expect(await code(recordProgress(await mgr.ctx(), ind.id, { updates: [{ keyResultId: kr.id, value: 1 }] }))).toBe('forbidden');
  });

  it('exposes the alignment graph, redacting parents the viewer cannot otherwise see', async () => {
    const { nodes } = await getAlignment(await emp3.ctx(), cycle);
    const c = nodes.find((n: any) => n.id === company);
    expect(c).toBeTruthy();                                      // company goals are visible to everyone once active
    expect(nodes.every((n: any) => n.level !== 'individual' || n.owner_id === emp3.id)).toBe(true); // other people's individual goals are not
  });
});

describe('amendments and ownership', () => {
  let goal: string;
  it('priority/weight changes apply immediately; target changes require re-approval from someone other than the requester', async () => {
    goal = await newSubmittedGoal(emp2); await approveAs(mgr, goal);
    const minor = await proposeAmendment(await emp2.ctx(), goal, { reason: 'Reprioritised after planning', changes: { priority: 'critical' } });
    expect(minor).toMatchObject({ requiresApproval: false, status: 'applied' });
    const major = await proposeAmendment(await emp2.ctx(), goal, { reason: 'Customer demand doubled', changes: { keyResults: [{ id: (await getGoalDetail(await emp2.ctx(), goal)).keyResults[0].id, title: 'Qualified accounts', startValue: 0, targetValue: 80 }] } });
    expect(major).toMatchObject({ requiresApproval: true, status: 'pending_approval' });
    expect(await code(proposeAmendment(await emp2.ctx(), goal, { reason: 'Another change', changes: { dueDate: '2099-01-01' } }))).toBe('conflict'); // one pending at a time
    let d = await getGoalDetail(await emp2.ctx(), goal);
    expect(d.keyResults[0].target_value).toBe(40);               // unchanged until approved
    expect(await code(decideApproval(await emp2.ctx(), await pendingRequest(goal), { decision: 'approve' }))).toBe('forbidden');
    const res = await approveAs(mgr, goal);
    expect(res.result).toBe('amended');
    d = await getGoalDetail(await emp2.ctx(), goal);
    expect(d.keyResults[0].target_value).toBe(80);
    expect(d.versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
    const v2 = await getVersion(await emp2.ctx(), goal, 2);
    expect(v2.snapshot.keyResults[0].target_value).toBe(40);      // previous value preserved
    expect(v2.snapshot.goal.priority).toBe('critical');
    const v3 = await getVersion(await emp2.ctx(), goal, 3);
    expect(v3.snapshot.keyResults[0].target_value).toBe(80);
    const am = d.history.find((h: any) => h.action === 'goal.amended' && h.after_data.contentVersion === 3);
    expect(am.before_data.keyResults[0].target_value).toBe(40);
    expect(am.after_data.contentVersion).toBe(3);
    expect(am.metadata.requestedBy).toBe(emp2.id);
  });

  it('honours organisation policy: when no change kinds need approval, amendments apply immediately but stay audited', async () => {
    await updatePolicy(org.admin, { amendments: { requireApprovalFor: ['owner'] } });
    const r = await proposeAmendment(await emp2.ctx(), goal, { reason: 'Extend by a month, agreed offline', changes: { dueDate: `${new Date().getUTCFullYear()}-12-30` } });
    expect(r.requiresApproval).toBe(false);
    await updatePolicy(org.admin, { goals: { maxActiveIndividualGoals: 100 } });
    const d = await getGoalDetail(await emp2.ctx(), goal);
    expect(d.versions).toHaveLength(4);
  });

  it('a manager amending a report\'s goal is routed to a different approver', async () => {
    const id = await newSubmittedGoal(emp1); await approveAs(mgr, id);
    await proposeAmendment(await mgr.ctx(), id, { reason: 'Manager adjusts the scope', changes: { title: 'Cut p99 latency of the billing API by 25 percent' } });
    const reqs = (await getGoalDetail(await emp1.ctx(), id)).approvals.filter((a: any) => a.amendment_id);
    expect(reqs[0].approver_id).toBe(vp.id);                       // not mgr, who requested it
    expect(await code(approveAs(mgr, id))).toBe('forbidden');
    expect((await approveAs(vp, id)).result).toBe('amended');
  });

  it('ownership transfer requires goals.reassign, keeps history and notifies both people', async () => {
    expect(await code(transferOwnership(await mgr.ctx(), goal, emp1.id, 'Reorganisation of the team'))).toBe('forbidden');
    await transferOwnership(await hr.ctx(), goal, emp1.id, 'Eli moved to another project');
    const d = await getGoalDetail(await emp1.ctx(), goal);
    expect(d.goal.owner_id).toBe(emp1.id);
    const ev = d.history.find((h: any) => h.action === 'goal.owner_transferred');
    expect(ev).toMatchObject({ before_data: { ownerId: emp2.id }, after_data: { ownerId: emp1.id } });
    const n = await withOrg(org.orgId, async (tx) => tx.query(`select user_id from notifications where type = 'goal.owner_transferred' and entity_id = $1`, [goal]));
    expect(n.map((r: any) => r.user_id).sort()).toEqual([emp1.id, emp2.id].sort());
  });

  it('completes and cancels goals with the right permissions and audit trail', async () => {
    const id = await newSubmittedGoal(emp1); await approveAs(mgr, id);
    expect(await code(completeGoal(await emp2.ctx(), id))).toMatch(/not_found|forbidden/);
    await completeGoal(await emp1.ctx(), id, 'Delivered ahead of schedule');
    expect((await getGoalDetail(await emp1.ctx(), id)).goal.status).toBe('completed');
    expect(await code(cancelGoal(await emp1.ctx(), id, 'no longer needed'))).toBe('invalid_state');
    const other = await newSubmittedGoal(emp1); await approveAs(mgr, other);
    await cancelGoal(await mgr.ctx(), other, 'Priorities changed in Q3 planning');
    expect((await getGoalDetail(await emp1.ctx(), other)).goal.status).toBe('cancelled');
  });

  it('only drafts can be deleted', async () => {
    const { id } = await createGoal(await emp1.ctx(), goalInput(cycle));
    await deleteDraftGoal(await emp1.ctx(), id);
    expect(await code(getGoalDetail(await emp1.ctx(), id))).toBe('not_found');
    const sub = await newSubmittedGoal(emp1);
    expect(await code(deleteDraftGoal(await emp1.ctx(), sub))).toBe('invalid_state');
  });
});

describe('visibility', () => {
  it('managers, department heads and HR see exactly the goals their role entitles them to', async () => {
    const fresh = await org.add('Fran Fresh', { managerId: mgr.id });
    const id = await newSubmittedGoal(fresh, { title: 'Private-ish individual goal for visibility test' });
    const sees = async (u: any) => (await code(getGoalDetail(await u.ctx(), id))) === 'ok';
    expect(await sees(fresh)).toBe(true);
    expect(await sees(mgr)).toBe(true);        // direct manager
    expect(await sees(vp)).toBe(true);         // indirect manager + department head of Backend's parent
    expect(await sees(cto)).toBe(true);        // top of the reporting line
    expect(await sees(hr)).toBe(true);         // goals.read_org
    expect(await sees(emp2)).toBe(false);      // peer
    expect(await sees(emp3)).toBe(false);
    expect(await sees(stranger)).toBe(false);
    const list = await listGoals(await emp2.ctx(), { limit: 200 });
    expect(list.data.some((g: any) => g.id === id)).toBe(false);
    void engDept;
  });
});
