import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, can } from '../core/context';
import { AppError, forbidden, invalid, invalidState, notFound, conflict } from '../core/errors';
import { isoDate, parse, uuid } from '../core/validation';
import { resolvePolicy, type OrgPolicy } from '@/lib/policy';
import { submissionIssues } from '@/lib/goal-rules';
import { audit } from './audit';
import { notify } from './notifications';
import { getVisibleGoal, isManagerOf, type GoalRow } from './goal-access';
import { keyResultInput, normalizeKr, writeKeyResults, type KeyResultInput } from './goals';
import { createApprovalChain, snapshotGoal } from './approvals';

export const amendmentSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
  changes: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    expectedOutcome: z.string().trim().max(2000).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    weight: z.number().positive().max(1000).optional(),
    parentGoalId: uuid.nullable().optional(),
    ownerId: uuid.optional(),
    keyResults: z.array(keyResultInput).max(20).optional(),
  }).strict(),
}).strict();

type Kind = 'target' | 'deadline' | 'owner' | 'scope';
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Which kinds of change an amendment contains, and whether that triggers re-approval under the org's policy. */
export function classifyAmendment(
  cur: { title: string; description: string | null; expected_outcome: string | null; start_date: string | null; due_date: string | null; parent_goal_id: string | null; owner_id: string },
  curKrs: { id: string; title: string; metric_type: string; direction: string; start_value: number; target_value: number; weight: number }[],
  c: z.infer<typeof amendmentSchema>['changes'], policy: OrgPolicy,
) {
  const kinds = new Set<Kind>();
  const minor: string[] = [];
  if (c.title !== undefined && c.title !== cur.title) kinds.add('scope');
  if (c.description !== undefined && (c.description ?? null) !== cur.description) kinds.add('scope');
  if (c.expectedOutcome !== undefined && (c.expectedOutcome ?? null) !== cur.expected_outcome) kinds.add('scope');
  if (c.parentGoalId !== undefined && c.parentGoalId !== cur.parent_goal_id) kinds.add('scope');
  if (c.ownerId !== undefined && c.ownerId !== cur.owner_id) kinds.add('owner');
  if (c.startDate !== undefined && (c.startDate ?? null) !== cur.start_date) kinds.add('deadline');
  if (c.dueDate !== undefined && (c.dueDate ?? null) !== cur.due_date) {
    const shift = cur.due_date && c.dueDate ? Math.abs(days(cur.due_date, c.dueDate)) : Infinity;
    if (!(shift <= policy.amendments.deadlineShiftFreeDays)) kinds.add('deadline'); else minor.push('due_date');
  }
  if (c.priority !== undefined) minor.push('priority');
  if (c.weight !== undefined) minor.push('weight');
  if (c.keyResults) {
    const byId = new Map(curKrs.map((k) => [k.id, k]));
    const keep = new Set<string>();
    for (const raw of c.keyResults) {
      const k = normalizeKr(raw);
      const old = k.id ? byId.get(k.id) : undefined;
      if (!old) { kinds.add('target'); continue; }
      keep.add(old.id);
      if (old.metric_type !== k.metricType || old.direction !== k.direction || Number(old.start_value) !== k.startValue || Number(old.target_value) !== k.targetValue || Number(old.weight) !== k.weight) kinds.add('target');
      if (old.title !== k.title) kinds.add('scope');
    }
    if (curKrs.some((k) => !keep.has(k.id))) kinds.add('target');
  }
  const list = [...kinds];
  const significant = list.some((k) => policy.amendments.requireApprovalFor.includes(k));
  return { kinds: list, minor, significant };
}

async function policyOf(tx: Tx, orgId: string): Promise<OrgPolicy> {
  return resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [orgId]))?.settings);
}

export async function proposeAmendment(ctx: Ctx, goalId: string, input: unknown) {
  parse(uuid, goalId);
  const d = parse(amendmentSchema, input);
  if (Object.keys(d.changes).length === 0) throw invalid('Nothing to change.');
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    const mgr = g.owner_id !== ctx.userId && (await isManagerOf(tx, ctx.orgId, ctx.userId, g.owner_id));
    if (g.owner_id !== ctx.userId && !mgr && !can(ctx, 'goals.reassign')) throw forbidden('Only the owner, their manager or an authorised administrator can amend this goal.');
    if (g.status !== 'active') throw invalidState('Only approved (active) goals are amended. Edit drafts directly.');
    if (await tx.one(`select 1 from goal_amendments where org_id = $1 and goal_id = $2 and status = 'pending_approval'`, [ctx.orgId, goalId])) {
      throw conflict('There is already an amendment waiting for approval on this goal.');
    }
    const policy = await policyOf(tx, ctx.orgId);
    const krs = await tx.query<any>('select id, title, metric_type, direction, start_value, target_value, weight from key_results where org_id = $1 and goal_id = $2 and removed_at is null', [ctx.orgId, goalId]);
    const c = d.changes;
    if (c.ownerId) {
      const u = await tx.one<{ status: string }>('select status from users where org_id = $1 and id = $2', [ctx.orgId, c.ownerId]);
      if (!u) throw notFound('New owner');
      if (u.status !== 'active') throw invalid('The new owner must be an active user.');
    }
    if (c.parentGoalId) {
      const p = await getVisibleGoal(tx, ctx, c.parentGoalId).catch((e) => { if (e instanceof AppError && e.code === 'not_found') throw invalid('The goal you are aligning to was not found.'); throw e; });
      if (p.status !== 'active' || p.cycle_id !== g.cycle_id) throw invalid('You can only align to an active goal in the same cycle.');
    }
    // The goal must still be valid after the change.
    const merged = {
      ...g,
      title: c.title ?? g.title, description: c.description === undefined ? g.description : c.description,
      expected_outcome: c.expectedOutcome === undefined ? g.expected_outcome : c.expectedOutcome,
      start_date: c.startDate === undefined ? g.start_date : c.startDate, due_date: c.dueDate === undefined ? g.due_date : c.dueDate,
    };
    const mergedKrs = c.keyResults ? c.keyResults.map((k) => { const n = normalizeKr(k); return { title: n.title, metric_type: n.metricType, direction: n.direction, start_value: n.startValue, target_value: n.targetValue }; }) : krs;
    const issues = submissionIssues(merged, mergedKrs as any, policy);
    if (issues.length) throw invalid('The amended goal would not be valid.', issues);

    const cls = classifyAmendment(g, krs, c, policy);
    if (cls.kinds.length === 0 && cls.minor.length === 0) throw invalid('Those values are identical to the current goal.');
    const row = await tx.one<{ id: string }>(
      `insert into goal_amendments (org_id, goal_id, base_version, changes, change_kinds, reason, significant, status, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [ctx.orgId, goalId, g.content_version, JSON.stringify(c), cls.kinds, d.reason, cls.significant, cls.significant ? 'pending_approval' : 'applied', ctx.userId]);
    const owner = await tx.one<{ full_name: string }>('select full_name from users where org_id = $1 and id = $2', [ctx.orgId, g.owner_id]);
    if (cls.significant) {
      const chain = await createApprovalChain(tx, ctx, g, owner!.full_name, { amendmentId: row!.id, requestedBy: ctx.userId });
      await audit(tx, ctx, { action: 'goal.amendment_requested', entityType: 'goal', entityId: goalId, after: { amendmentId: row!.id, kinds: cls.kinds, changes: c }, metadata: { reason: d.reason, levels: chain.levels } });
      return { amendmentId: row!.id, requiresApproval: true, status: 'pending_approval' };
    }
    const amendment = await tx.one<any>('select * from goal_amendments where org_id = $1 and id = $2', [ctx.orgId, row!.id]);
    await applyAmendment(tx, ctx, amendment, {});
    return { amendmentId: row!.id, requiresApproval: false, status: 'applied' };
  });
}

/** Applies a validated amendment inside the caller's transaction. Records old values via versioning + audit. */
export async function applyAmendment(tx: Tx, ctx: Ctx, amendment: any, _opts: { approvedViaRequest?: string }) {
  const g = await tx.one<GoalRow>(`select g.* from goals g where g.org_id = $1 and g.id = $2 for update`, [ctx.orgId, amendment.goal_id]);
  if (!g) throw notFound('Goal');
  if (g.status !== 'active') throw invalidState('The goal is no longer active, so the amendment cannot be applied.');
  if (g.content_version !== amendment.base_version) throw conflict('The goal changed after this amendment was proposed. Propose it again against the latest version.');
  const c = amendment.changes as z.infer<typeof amendmentSchema>['changes'];
  const before = { title: g.title, description: g.description, expected_outcome: g.expected_outcome, priority: g.priority, start_date: g.start_date, due_date: g.due_date, weight: g.weight, parent_goal_id: g.parent_goal_id, owner_id: g.owner_id };
  const prevKrs = await tx.query<any>('select id, title, start_value, target_value, weight from key_results where org_id = $1 and goal_id = $2 and removed_at is null order by position', [ctx.orgId, g.id]);
  let dept = g.department_id, team = g.team_id;
  if (c.ownerId && c.ownerId !== g.owner_id && g.level === 'individual') {
    const u = await tx.one<{ department_id: string | null; team_id: string | null }>('select department_id, team_id from users where org_id = $1 and id = $2', [ctx.orgId, c.ownerId]);
    dept = u?.department_id ?? null; team = u?.team_id ?? null;
  }
  const after = {
    title: c.title ?? g.title, description: c.description === undefined ? g.description : c.description,
    expected_outcome: c.expectedOutcome === undefined ? g.expected_outcome : c.expectedOutcome, priority: c.priority ?? g.priority,
    start_date: c.startDate === undefined ? g.start_date : c.startDate, due_date: c.dueDate === undefined ? g.due_date : c.dueDate,
    weight: c.weight ?? g.weight, parent_goal_id: c.parentGoalId === undefined ? g.parent_goal_id : c.parentGoalId, owner_id: c.ownerId ?? g.owner_id,
  };
  if (after.parent_goal_id && after.parent_goal_id !== g.parent_goal_id) {
    const p = await tx.one<{ status: string }>('select status from goals where org_id = $1 and id = $2 and deleted_at is null', [ctx.orgId, after.parent_goal_id]);
    if (!p || p.status !== 'active') throw invalidState('The goal you align to is no longer active.');
  }
  try {
    await tx.exec(
      `update goals set title=$3, description=$4, expected_outcome=$5, priority=$6, start_date=$7, due_date=$8, weight=$9, parent_goal_id=$10, owner_id=$11,
         department_id=$12, team_id=$13, content_version = content_version + 1, version = version + 1 where org_id=$1 and id=$2`,
      [ctx.orgId, g.id, after.title, after.description, after.expected_outcome, after.priority, after.start_date, after.due_date, after.weight, after.parent_goal_id, after.owner_id, dept, team]);
  } catch (e: any) {
    if (e.code === '23514' || e.code === '23503') throw invalid(String(e.message).replace(/^.*?: /, ''));
    throw e;
  }
  if (c.keyResults) await writeKeyResults(tx, ctx, g.id, c.keyResults as KeyResultInput[]);
  if (c.ownerId && c.ownerId !== g.owner_id) await tx.exec('delete from goal_collaborators where org_id = $1 and goal_id = $2 and user_id = $3', [ctx.orgId, g.id, c.ownerId]);
  const kinds = (amendment.change_kinds as string[]) ?? [];
  await snapshotGoal(tx, ctx, g.id, { summary: `Amendment: ${kinds.length ? kinds.join(', ') : 'minor update'}`, reason: amendment.reason, amendmentId: amendment.id });
  const newVersion = g.content_version + 1;
  await tx.exec(`update goal_amendments set status = 'applied', decided_at = now(), applied_version = $3 where org_id = $1 and id = $2`, [ctx.orgId, amendment.id, newVersion]);
  await audit(tx, ctx, {
    action: 'goal.amended', entityType: 'goal', entityId: g.id,
    before: { ...before, keyResults: prevKrs }, after: { ...after, keyResultsChanged: !!c.keyResults, contentVersion: newVersion },
    metadata: { amendmentId: amendment.id, kinds, reason: amendment.reason, requestedBy: amendment.requested_by },
  });
  const recipients = new Set<string>([g.owner_id, after.owner_id]);
  recipients.delete(ctx.userId);
  for (const userId of recipients) {
    await notify(tx, ctx, { userId, category: 'goals', type: 'goal.amended', title: `Goal amended: ${after.title}`, body: `The approved goal was updated (${kinds.join(', ') || 'minor changes'}). Reason: ${amendment.reason}`, link: `/app/goals/${g.id}`, entityType: 'goal', entityId: g.id, dedupeKey: `amended:${amendment.id}:${userId}` });
  }
  return { version: newVersion };
}

export async function withdrawAmendment(ctx: Ctx, amendmentId: string) {
  parse(uuid, amendmentId);
  return withOrg(ctx.orgId, async (tx) => {
    const a = await tx.one<any>('select * from goal_amendments where org_id = $1 and id = $2', [ctx.orgId, amendmentId]);
    if (!a) throw notFound('Amendment');
    await tx.one('select id from goals where org_id = $1 and id = $2 for update', [ctx.orgId, a.goal_id]);
    const cur = await tx.one<any>('select * from goal_amendments where org_id = $1 and id = $2 for update', [ctx.orgId, amendmentId]);
    if (cur.requested_by !== ctx.userId) throw forbidden('Only the person who proposed the amendment can withdraw it.');
    if (cur.status !== 'pending_approval') throw invalidState('That amendment is no longer pending.');
    await tx.exec(`update approval_requests set status = 'cancelled' where org_id = $1 and amendment_id = $2 and status in ('pending','waiting')`, [ctx.orgId, amendmentId]);
    await tx.exec(`update goal_amendments set status = 'withdrawn', decided_at = now() where org_id = $1 and id = $2`, [ctx.orgId, amendmentId]);
    await audit(tx, ctx, { action: 'goal.amendment_withdrawn', entityType: 'goal', entityId: cur.goal_id, metadata: { amendmentId } });
    return { ok: true };
  });
}

export async function getVersion(ctx: Ctx, goalId: string, version: number) {
  parse(uuid, goalId);
  return withOrg(ctx.orgId, async (tx) => {
    await getVisibleGoal(tx, ctx, goalId);
    const v = await tx.one<any>('select version, snapshot, change_summary, change_reason, changed_by, created_at from goal_versions where org_id = $1 and goal_id = $2 and version = $3', [ctx.orgId, goalId, version]);
    if (!v) throw notFound('Version');
    return v;
  });
}
