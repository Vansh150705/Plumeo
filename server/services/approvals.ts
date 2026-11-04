import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, can } from '../core/context';
import { conflict, forbidden, invalid, invalidState, notFound } from '../core/errors';
import { parse, uuid } from '../core/validation';
import { resolvePolicy, type OrgPolicy } from '@/lib/policy';
import { submissionIssues } from '@/lib/goal-rules';
import { audit } from './audit';
import { notify, publishOrgEvent } from './notifications';
import { EDITABLE_STATUSES, GOAL_COLS, assertOwnerOrManager, getVisibleGoal, type GoalRow } from './goal-access';

const policyOf = async (tx: Tx, orgId: string): Promise<OrgPolicy> =>
  resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [orgId]))?.settings);

/** Immutable version record: the full approved/submitted content of a goal at a point in time. */
export async function snapshotGoal(tx: Tx, ctx: Ctx, goalId: string, opts: { summary: string; reason?: string; amendmentId?: string }) {
  const g = await tx.one<any>(
    `select id, cycle_id, level, title, description, expected_outcome, context, owner_id, department_id, team_id, parent_goal_id, priority,
            start_date, due_date, weight, progress_mode, content_version from goals where org_id = $1 and id = $2`, [ctx.orgId, goalId]);
  const krs = await tx.query(
    `select id, title, metric_type, direction, unit, start_value, target_value, weight from key_results where org_id = $1 and goal_id = $2 and removed_at is null order by position`, [ctx.orgId, goalId]);
  await tx.exec(
    `insert into goal_versions (org_id, goal_id, version, snapshot, change_summary, change_reason, changed_by, amendment_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.orgId, goalId, g.content_version, JSON.stringify({ goal: g, keyResults: krs }), opts.summary, opts.reason ?? null, ctx.userId, opts.amendmentId ?? null]);
}

interface PlannedLevel { level: number; approverId: string | null }

async function approverChain(tx: Tx, orgId: string, ownerId: string, exclude: string[] = []): Promise<string[]> {
  const rows = await tx.query<{ id: string; status: string }>(
    `with recursive c as (
       select m.id, m.manager_id, m.status, 1 as depth from users u join users m on m.org_id = u.org_id and m.id = u.manager_id where u.org_id = $1 and u.id = $2
       union all
       select m.id, m.manager_id, m.status, c.depth + 1 from c join users m on m.org_id = $1 and m.id = c.manager_id where c.depth < 20)
     select id, status from c order by depth`, [orgId, ownerId]);
  return rows.filter((r) => r.status === 'active' && r.id !== ownerId && !exclude.includes(r.id)).map((r) => r.id);
}

async function poolMembers(tx: Tx, orgId: string, excludeUserIds: string[]): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `select distinct u.id from users u join user_roles ur on ur.org_id = u.org_id and ur.user_id = u.id join roles r on r.org_id = ur.org_id and r.id = ur.role_id
     where u.org_id = $1 and u.status = 'active' and 'goals.approve_any' = any(r.permissions) and not (u.id = any($2::uuid[])) limit 50`, [orgId, excludeUserIds]);
  return rows.map((r) => r.id);
}

/** Decides who must approve, level by level. The chain is capped by the policy and by how many managers exist. */
export async function planApprovers(tx: Tx, orgId: string, goal: Pick<GoalRow, 'owner_id' | 'level'>, policy: OrgPolicy, exclude: string[] = []): Promise<PlannedLevel[]> {
  const wanted = policy.approval.levels[goal.level as keyof OrgPolicy['approval']['levels']];
  if (goal.level !== 'company') {
    const chain = await approverChain(tx, orgId, goal.owner_id, exclude);
    const n = Math.min(wanted, chain.length);
    if (n > 0) return chain.slice(0, n).map((id, i) => ({ level: i + 1, approverId: id }));
  }
  const pool = await poolMembers(tx, orgId, [goal.owner_id, ...exclude]);
  if (pool.length === 0) {
    throw invalidState('No eligible approver exists for this goal. Assign the owner a manager, or add a second administrator or HR administrator who can approve.');
  }
  return Array.from({ length: goal.level === 'company' ? Math.min(wanted, 3) : 1 }, (_, i) => ({ level: i + 1, approverId: null }));
}

async function notifyApprovers(tx: Tx, ctx: Ctx, args: { approverId: string | null; ownerId: string; ownerName: string; goalId: string; title: string; requestId: string; kind: 'goal' | 'amendment'; dueAt: Date }) {
  const recipients = args.approverId ? [args.approverId] : await poolMembers(tx, ctx.orgId, [args.ownerId]);
  for (const userId of recipients) {
    await notify(tx, ctx, {
      userId, category: 'approvals', type: args.kind === 'goal' ? 'approval.requested' : 'amendment.requested',
      title: args.kind === 'goal' ? `Approval needed: ${args.title}` : `Amendment needs approval: ${args.title}`,
      body: `${args.ownerName} ${args.kind === 'goal' ? 'submitted a goal' : 'proposed a change to an approved goal'} for your review. Please respond by ${args.dueAt.toISOString().slice(0, 10)}.`,
      link: `/app/approvals`, entityType: 'goal', entityId: args.goalId, dedupeKey: `approval-requested:${args.requestId}`,
    });
  }
}

export async function createApprovalChain(tx: Tx, ctx: Ctx, g: Pick<GoalRow, 'id' | 'owner_id' | 'level' | 'title' | 'content_version'>, ownerName: string, opts: { amendmentId?: string; requestedBy: string }) {
  const policy = await policyOf(tx, ctx.orgId);
  const plan = await planApprovers(tx, ctx.orgId, g, policy, opts.amendmentId ? [opts.requestedBy] : []);
  const roundRow = await tx.one<{ r: number }>(
    `select coalesce(max(round), 0) + 1 as r from approval_requests where org_id = $1 and goal_id = $2 and ((amendment_id is null and $3::uuid is null) or amendment_id = $3)`,
    [ctx.orgId, g.id, opts.amendmentId ?? null]);
  const due = new Date(Date.now() + policy.approval.slaDays * 86_400_000);
  const ids: string[] = [];
  for (const p of plan) {
    const first = p.level === 1;
    const row = await tx.one<{ id: string }>(
      `insert into approval_requests (org_id, goal_id, amendment_id, round, level, approver_id, status, goal_version, requested_by, activated_at, due_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [ctx.orgId, g.id, opts.amendmentId ?? null, roundRow!.r, p.level, p.approverId, first ? 'pending' : 'waiting', g.content_version, opts.requestedBy, first ? new Date() : null, first ? due : null]);
    ids.push(row!.id);
    if (first) await notifyApprovers(tx, ctx, { approverId: p.approverId, ownerId: g.owner_id, ownerName, goalId: g.id, title: g.title, requestId: row!.id, kind: opts.amendmentId ? 'amendment' : 'goal', dueAt: due });
  }
  return { round: roundRow!.r, requestIds: ids, levels: plan.length };
}

// ---------------------------------------------------------------------------
// Submit / withdraw
// ---------------------------------------------------------------------------

export async function submitGoal(ctx: Ctx, goalId: string, expectedVersion?: number) {
  parse(uuid, goalId);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    if (g.owner_id !== ctx.userId) throw forbidden('Only the goal owner can submit it for approval.');
    if (!EDITABLE_STATUSES.includes(g.status)) throw invalidState(`A goal that is ${g.status.replace('_', ' ')} cannot be submitted.`);
    if (expectedVersion != null && g.version !== expectedVersion) throw conflict('This goal changed since you opened it. Reload and try again.', { currentVersion: g.version });
    const policy = await policyOf(tx, ctx.orgId);

    const cycle = await tx.one<any>('select * from cycles where org_id = $1 and id = $2', [ctx.orgId, g.cycle_id]);
    if (cycle.status === 'closed') throw invalidState('This cycle is closed.');
    if (policy.goals.enforceGoalSettingWindow && !can(ctx, 'cycles.manage')) {
      const today = new Date().toISOString().slice(0, 10);
      if ((cycle.goal_setting_opens_on && today < cycle.goal_setting_opens_on) || (cycle.goal_setting_closes_on && today > cycle.goal_setting_closes_on)) {
        throw invalidState('Goal submission is closed for this cycle.');
      }
    }
    const krs = await tx.query<any>('select title, metric_type, direction, start_value, target_value, weight from key_results where org_id = $1 and goal_id = $2 and removed_at is null', [ctx.orgId, goalId]);
    const issues = submissionIssues(g, krs, policy);
    if (g.parent_goal_id) {
      const p = await tx.one<{ status: string; title: string }>('select status, title from goals where org_id = $1 and id = $2 and deleted_at is null', [ctx.orgId, g.parent_goal_id]);
      if (!p || p.status !== 'active') issues.push({ field: 'parent_goal_id', message: 'The goal you align to is no longer active. Choose another or remove the alignment.' });
    }
    if (issues.length) throw invalid('This goal is not ready to submit.', issues);

    // Any lingering open request from an earlier round is superseded.
    await tx.exec(`update approval_requests set status = 'superseded' where org_id = $1 and goal_id = $2 and amendment_id is null and status in ('pending','waiting')`, [ctx.orgId, goalId]);
    const owner = await tx.one<{ full_name: string }>('select full_name from users where org_id = $1 and id = $2', [ctx.orgId, g.owner_id]);
    await tx.exec(`update goals set status = 'pending_approval', submitted_at = now(), content_version = content_version + 1, version = version + 1 where org_id = $1 and id = $2`, [ctx.orgId, goalId]);
    const submitted = { ...g, content_version: g.content_version + 1 };
    await snapshotGoal(tx, ctx, goalId, { summary: g.content_version === 0 ? 'Initial submission' : 'Resubmitted after review' });
    const chain = await createApprovalChain(tx, ctx, submitted, owner!.full_name, { requestedBy: ctx.userId });
    await audit(tx, ctx, { action: 'goal.submitted', entityType: 'goal', entityId: goalId, before: { status: g.status }, after: { status: 'pending_approval', round: chain.round, levels: chain.levels, version: submitted.content_version } });
    return { status: 'pending_approval', round: chain.round, levels: chain.levels };
  });
}

export async function withdrawSubmission(ctx: Ctx, goalId: string) {
  parse(uuid, goalId);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    await assertOwnerOrManager(tx, ctx, g);
    if (g.status !== 'pending_approval') throw invalidState('Only goals awaiting approval can be withdrawn.');
    await tx.exec(`update approval_requests set status = 'cancelled' where org_id = $1 and goal_id = $2 and amendment_id is null and status in ('pending','waiting')`, [ctx.orgId, goalId]);
    await tx.exec(`update goals set status = 'draft', version = version + 1 where org_id = $1 and id = $2`, [ctx.orgId, goalId]);
    await audit(tx, ctx, { action: 'goal.withdrawn', entityType: 'goal', entityId: goalId, before: { status: 'pending_approval' }, after: { status: 'draft' } });
    return { status: 'draft' };
  });
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'request_changes']),
  comment: z.string().trim().max(2000).optional(),
}).strict();

export async function decideApproval(ctx: Ctx, requestId: string, input: unknown) {
  parse(uuid, requestId);
  const d = parse(decisionSchema, input);
  if (d.decision !== 'approve' && (d.comment ?? '').length < 5) throw invalid('Please explain your decision (at least 5 characters) so the owner knows what to do next.');
  return withOrg(ctx.orgId, async (tx) => {
    const head = await tx.one<{ goal_id: string }>('select goal_id from approval_requests where org_id = $1 and id = $2', [ctx.orgId, requestId]);
    if (!head) throw notFound('Approval request');
    // Lock order is always goal -> request, so concurrent decisions serialise instead of deadlocking.
    const goal = await tx.one<GoalRow>(`select ${GOAL_COLS} from goals g where g.org_id = $1 and g.id = $2 for update of g`, [ctx.orgId, head.goal_id]);
    if (!goal) throw notFound('Goal');
    const req = await tx.one<any>('select * from approval_requests where org_id = $1 and id = $2 for update', [ctx.orgId, requestId]);
    const amendment = req.amendment_id ? await tx.one<any>('select * from goal_amendments where org_id = $1 and id = $2 for update', [ctx.orgId, req.amendment_id]) : null;

    // --- authorisation (before revealing state) ---
    let onBehalfOf: string | null = null;
    let oversight = false;
    const own = goal.owner_id === ctx.userId;
    const mayApprove = can(ctx, 'goals.approve') || can(ctx, 'goals.approve_any');
    const delegated = req.approver_id && req.approver_id !== ctx.userId && await tx.one(
      `select 1 from approval_delegations where org_id = $1 and delegator_id = $2 and delegate_id = $3 and revoked_at is null and now() between starts_at and ends_at`, [ctx.orgId, req.approver_id, ctx.userId]);
    if (req.approver_id === ctx.userId && mayApprove) { /* assigned approver */ }
    else if (delegated) onBehalfOf = req.approver_id;
    else if (can(ctx, 'goals.approve_any')) oversight = true;
    else {
      // can this person even see the goal? If not, pretend it does not exist.
      await getVisibleGoal(tx, ctx, head.goal_id).catch(() => { throw notFound('Approval request'); });
      throw forbidden('You are not an approver for this request.');
    }
    if (own) throw forbidden('You cannot decide on your own goal.');
    if (amendment && (amendment.requested_by === ctx.userId || amendment.changes?.ownerId === ctx.userId)) throw forbidden('You cannot decide on an amendment you requested or that names you as the new owner.');
    if (req.status !== 'pending') throw conflict('This request has already been decided or is no longer pending.', { status: req.status });
    if (!amendment && goal.status !== 'pending_approval') throw invalidState(`The goal is ${goal.status.replace('_', ' ')}, so this request is no longer actionable.`);
    if (amendment && amendment.status !== 'pending_approval') throw invalidState('This amendment is no longer pending.');
    if (req.level > 1) {
      const prev = await tx.one<{ decided_by: string }>(
        `select decided_by from approval_requests where org_id = $1 and goal_id = $2 and round = $3 and level < $4 and (amendment_id is not distinct from $5) and decided_by = $6`,
        [ctx.orgId, req.goal_id, req.round, req.level, req.amendment_id, ctx.userId]);
      if (prev) throw forbidden('A different person must handle each approval level.');
    }

    const status = d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : 'changes_requested';
    await tx.exec(
      `update approval_requests set status = $3, decided_by = $4, on_behalf_of = $5, decided_at = now(), decision_comment = $6 where org_id = $1 and id = $2`,
      [ctx.orgId, requestId, status, ctx.userId, onBehalfOf, d.comment ?? null]);
    const policy = await policyOf(tx, ctx.orgId);
    const meta = { requestId, level: req.level, round: req.round, ...(onBehalfOf ? { onBehalfOf } : {}), ...(oversight ? { oversight: true } : {}) };
    let result: 'next_level' | 'approved' | 'rejected' | 'changes_requested' | 'amended' | 'amendment_rejected';

    if (d.decision === 'approve') {
      const next = await tx.one<any>(
        `select * from approval_requests where org_id = $1 and goal_id = $2 and round = $3 and level = $4 and status = 'waiting' and (amendment_id is not distinct from $5) for update`,
        [ctx.orgId, req.goal_id, req.round, req.level + 1, req.amendment_id]);
      if (next) {
        const due = new Date(Date.now() + policy.approval.slaDays * 86_400_000);
        await tx.exec(`update approval_requests set status = 'pending', activated_at = now(), due_at = $3 where org_id = $1 and id = $2`, [ctx.orgId, next.id, due]);
        const owner = await tx.one<{ full_name: string }>('select full_name from users where org_id = $1 and id = $2', [ctx.orgId, goal.owner_id]);
        await notifyApprovers(tx, ctx, { approverId: next.approver_id, ownerId: goal.owner_id, ownerName: owner!.full_name, goalId: goal.id, title: goal.title, requestId: next.id, kind: amendment ? 'amendment' : 'goal', dueAt: due });
        await audit(tx, ctx, { action: 'approval.level_approved', entityType: 'goal', entityId: goal.id, metadata: { ...meta, comment: d.comment ?? null, next: next.level } });
        result = 'next_level';
      } else if (amendment) {
        const { applyAmendment } = await import('./amendments');
        await applyAmendment(tx, ctx, amendment, { approvedViaRequest: requestId });
        await audit(tx, ctx, { action: 'approval.amendment_approved', entityType: 'goal', entityId: goal.id, metadata: { ...meta, amendmentId: amendment.id, comment: d.comment ?? null } });
        result = 'amended';
      } else {
        await tx.exec(`update goals set status = 'active', approved_at = now(), version = version + 1 where org_id = $1 and id = $2`, [ctx.orgId, goal.id]);
        await audit(tx, ctx, { action: 'goal.approved', entityType: 'goal', entityId: goal.id, before: { status: 'pending_approval' }, after: { status: 'active', contentVersion: goal.content_version }, metadata: { ...meta, comment: d.comment ?? null } });
        await notify(tx, ctx, { userId: goal.owner_id, category: 'goals', type: 'goal.approved', title: `Goal approved: ${goal.title}`, body: `${ctx.userName} approved your goal${d.comment ? `: "${d.comment}"` : '.'} It is now active.`, link: `/app/goals/${goal.id}`, entityType: 'goal', entityId: goal.id, dedupeKey: `approved:${goal.id}:${goal.content_version}` });
        if (goal.level === 'company' || goal.level === 'department') {
          await publishOrgEvent(tx, ctx, { event: 'goal.activated', text: `New ${goal.level} goal approved: ${goal.title}`, link: `/app/goals/${goal.id}`, dedupeKey: `activated:${goal.id}:${goal.content_version}` });
        }
        result = 'approved';
      }
    } else {
      await tx.exec(`update approval_requests set status = 'cancelled' where org_id = $1 and goal_id = $2 and round = $3 and status = 'waiting' and (amendment_id is not distinct from $4)`, [ctx.orgId, req.goal_id, req.round, req.amendment_id]);
      if (amendment) {
        await tx.exec(`update goal_amendments set status = 'rejected', decided_at = now() where org_id = $1 and id = $2`, [ctx.orgId, amendment.id]);
        await audit(tx, ctx, { action: 'approval.amendment_rejected', entityType: 'goal', entityId: goal.id, metadata: { ...meta, amendmentId: amendment.id, comment: d.comment, decision: d.decision } });
        await notify(tx, ctx, { userId: amendment.requested_by, category: 'approvals', type: 'amendment.rejected', title: `Amendment declined: ${goal.title}`, body: `${ctx.userName}: "${d.comment}"`, link: `/app/goals/${goal.id}`, entityType: 'goal', entityId: goal.id, dedupeKey: `amendment-declined:${amendment.id}` });
        result = 'amendment_rejected';
      } else {
        const next = d.decision === 'reject' ? 'rejected' : 'changes_requested';
        await tx.exec('update goals set status = $3, version = version + 1 where org_id = $1 and id = $2', [ctx.orgId, goal.id, next]);
        await audit(tx, ctx, { action: d.decision === 'reject' ? 'goal.rejected' : 'goal.changes_requested', entityType: 'goal', entityId: goal.id, before: { status: 'pending_approval' }, after: { status: next }, metadata: { ...meta, comment: d.comment } });
        await notify(tx, ctx, { userId: goal.owner_id, category: 'goals', type: `goal.${next}`, title: d.decision === 'reject' ? `Goal rejected: ${goal.title}` : `Changes requested: ${goal.title}`,
          body: `${ctx.userName}: "${d.comment}"`, link: `/app/goals/${goal.id}`, entityType: 'goal', entityId: goal.id, dedupeKey: `${next}:${goal.id}:${goal.content_version}` });
        result = next;
      }
    }
    return { result, goalId: goal.id };
  });
}

// ---------------------------------------------------------------------------
// Queues, delegations, reminders
// ---------------------------------------------------------------------------

export async function listApprovalQueue(ctx: Ctx, scope: 'mine' | 'all' = 'mine') {
  if (scope === 'all' && !can(ctx, 'goals.approve_any')) throw forbidden();
  return withOrg(ctx.orgId, async (tx) => {
    const rows = await tx.query<any>(
      `select ar.id, ar.goal_id, ar.amendment_id, ar.level, ar.round, ar.approver_id, ap.full_name as approver_name, ar.requested_at, ar.activated_at, ar.due_at,
              (ar.due_at < now()) as overdue, g.title, g.level as goal_level, g.priority, g.due_date, g.owner_id, ou.full_name as owner_name, ou.job_title as owner_title,
              (select max(x.level) from approval_requests x where x.org_id = ar.org_id and x.goal_id = ar.goal_id and x.round = ar.round and (x.amendment_id is not distinct from ar.amendment_id)) as total_levels,
              case when ar.approver_id = $2 then 'assigned'
                   when ar.approver_id in (select ad.delegator_id from approval_delegations ad where ad.org_id = ar.org_id and ad.delegate_id = $2 and ad.revoked_at is null and now() between ad.starts_at and ad.ends_at) then 'delegated'
                   else 'oversight' end as reason,
              am.reason as amendment_reason, am.change_kinds
       from approval_requests ar join goals g on g.org_id = ar.org_id and g.id = ar.goal_id join users ou on ou.org_id = g.org_id and ou.id = g.owner_id
       left join users ap on ap.org_id = ar.org_id and ap.id = ar.approver_id
       left join goal_amendments am on am.org_id = ar.org_id and am.id = ar.amendment_id
       where ar.org_id = $1 and ar.status = 'pending' and g.owner_id <> $2 and g.deleted_at is null
         and ($3::boolean or ar.approver_id = $2 or ar.approver_id in (select ad.delegator_id from approval_delegations ad where ad.org_id = ar.org_id and ad.delegate_id = $2 and ad.revoked_at is null and now() between ad.starts_at and ad.ends_at))
       order by ar.due_at asc limit 500`, [ctx.orgId, ctx.userId, scope === 'all']);
    return rows;
  });
}

const delegationSchema = z.object({
  delegateId: uuid, startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().trim().max(300).optional(),
}).strict();

export async function createDelegation(ctx: Ctx, input: unknown) {
  if (!can(ctx, 'goals.approve') && !can(ctx, 'goals.approve_any')) throw forbidden('Only approvers can delegate approvals.');
  const d = parse(delegationSchema, input);
  if (new Date(d.endsAt) <= new Date(d.startsAt)) throw invalid('The delegation must end after it starts.');
  if (new Date(d.endsAt).getTime() - new Date(d.startsAt).getTime() > 90 * 86_400_000) throw invalid('A delegation can last at most 90 days.');
  if (d.delegateId === ctx.userId) throw invalid('You cannot delegate to yourself.');
  return withOrg(ctx.orgId, async (tx) => {
    const u = await tx.one<{ status: string; full_name: string }>('select status, full_name from users where org_id = $1 and id = $2', [ctx.orgId, d.delegateId]);
    if (!u) throw notFound('Delegate');
    if (u.status !== 'active') throw invalid('The delegate must be an active user.');
    const row = await tx.one<{ id: string }>(
      `insert into approval_delegations (org_id, delegator_id, delegate_id, starts_at, ends_at, reason) values ($1,$2,$3,$4,$5,$6) returning id`,
      [ctx.orgId, ctx.userId, d.delegateId, d.startsAt, d.endsAt, d.reason ?? null]);
    await audit(tx, ctx, { action: 'delegation.created', entityType: 'delegation', entityId: row!.id, after: { delegateId: d.delegateId, startsAt: d.startsAt, endsAt: d.endsAt } });
    await notify(tx, ctx, { userId: d.delegateId, category: 'approvals', type: 'delegation.created', title: `${ctx.userName} delegated approvals to you`, body: `You can approve on their behalf from ${d.startsAt.slice(0, 10)} to ${d.endsAt.slice(0, 10)}.`, link: '/app/approvals', dedupeKey: `delegation:${row!.id}` });
    return { id: row!.id };
  });
}

export async function revokeDelegation(ctx: Ctx, id: string) {
  parse(uuid, id);
  return withOrg(ctx.orgId, async (tx) => {
    const d = await tx.one<any>('select * from approval_delegations where org_id = $1 and id = $2 for update', [ctx.orgId, id]);
    if (!d) throw notFound('Delegation');
    if (d.delegator_id !== ctx.userId && !can(ctx, 'users.manage')) throw forbidden();
    await tx.exec('update approval_delegations set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null', [ctx.orgId, id]);
    await audit(tx, ctx, { action: 'delegation.revoked', entityType: 'delegation', entityId: id });
    return { ok: true };
  });
}

export async function listDelegations(ctx: Ctx) {
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select d.id, d.delegator_id, a.full_name as delegator_name, d.delegate_id, b.full_name as delegate_name, d.starts_at, d.ends_at, d.reason, d.revoked_at,
            (d.revoked_at is null and now() between d.starts_at and d.ends_at) as active
     from approval_delegations d join users a on a.org_id = d.org_id and a.id = d.delegator_id join users b on b.org_id = d.org_id and b.id = d.delegate_id
     where d.org_id = $1 and (d.delegator_id = $2 or d.delegate_id = $2) and d.ends_at > now() - interval '30 days' order by d.starts_at desc`, [ctx.orgId, ctx.userId]));
}

/** Reminds approvers of requests past their SLA. Idempotent per reminder window (dedupe key). */
export async function sendApprovalReminders(tx: Tx, orgId: string) {
  const policy = await policyOf(tx, orgId);
  const due = await tx.query<any>(
    `select ar.id, ar.approver_id, ar.goal_id, ar.reminder_count, g.title, g.owner_id from approval_requests ar join goals g on g.org_id = ar.org_id and g.id = ar.goal_id
     where ar.org_id = $1 and ar.status = 'pending' and ar.due_at < now()
       and (ar.last_reminded_at is null or ar.last_reminded_at < now() - make_interval(days => $2)) limit 500`, [orgId, policy.approval.reminderEveryDays]);
  let sent = 0;
  for (const r of due) {
    const recipients = r.approver_id ? [r.approver_id] : await poolMembers(tx, orgId, [r.owner_id]);
    for (const userId of recipients) {
      await notify(tx, { orgId }, { userId, category: 'approvals', type: 'approval.overdue', title: `Overdue approval: ${r.title}`, body: 'This goal has been waiting longer than your organisation\'s approval target.', link: '/app/approvals', entityType: 'goal', entityId: r.goal_id, dedupeKey: `approval-overdue:${r.id}:${r.reminder_count + 1}` });
      sent++;
    }
    await tx.exec('update approval_requests set reminder_count = reminder_count + 1, last_reminded_at = now() where org_id = $1 and id = $2', [orgId, r.id]);
  }
  return sent;
}
