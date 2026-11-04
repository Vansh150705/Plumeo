import type { Tx } from '../db/pool';
import { type Ctx, can } from '../core/context';
import { forbidden, notFound } from '../core/errors';

/**
 * Builds the SQL predicate describing which goals a caller may SEE. Values that come
 * from the caller are always bound parameters; permission flags are server-derived
 * and inlined. Used by every read path (lists, detail, alignment, analytics, exports),
 * so there is exactly one definition of goal visibility.
 *
 * A goal is visible to: its owner and collaborators; people assigned (or delegated)
 * to approve it; managers up the owner's reporting line; heads of the owner's /
 * goal's department tree; holders of goals.read_org; and — once approved — members
 * of the organisational unit it belongs to (company goals are visible to everyone).
 */
export function goalVisibility(ctx: Ctx, params: unknown[], g = 'g'): string {
  const base = `${g}.deleted_at is null`;
  if (can(ctx, 'goals.read_org')) return base;
  params.push(ctx.orgId); const org = `$${params.length}`;
  params.push(ctx.userId); const me = `$${params.length}`;
  const parts: string[] = [
    `${g}.owner_id = ${me}`,
    `exists (select 1 from goal_collaborators gc where gc.org_id = ${g}.org_id and gc.goal_id = ${g}.id and gc.user_id = ${me})`,
    `exists (select 1 from approval_requests ar where ar.org_id = ${g}.org_id and ar.goal_id = ${g}.id and (ar.approver_id = ${me} or ar.decided_by = ${me}
        or ar.approver_id in (select ad.delegator_id from approval_delegations ad where ad.org_id = ${g}.org_id and ad.delegate_id = ${me} and ad.revoked_at is null and now() between ad.starts_at and ad.ends_at)))`,
    // unit membership: approved goals of my department / team (and the ones above me) are visible
    `(${g}.status in ('active','completed') and (
        ${g}.level = 'company'
        or (${g}.level = 'department' and ${g}.department_id in (select department_ancestors(${org}, (select mu.department_id from users mu where mu.org_id = ${org} and mu.id = ${me}))))
        or (${g}.level = 'team' and ${g}.team_id in (select team_ancestors(${org}, (select mu.team_id from users mu where mu.org_id = ${org} and mu.id = ${me}))))))`,
  ];
  if (can(ctx, 'goals.read_reports') || can(ctx, 'goals.read_department')) {
    parts.push(`${g}.owner_id in (select reporting_subtree(${org}, ${me}))`);
  }
  if (can(ctx, 'goals.read_department')) {
    const headed = `select department_descendants(${org}, hd.id) from departments hd where hd.org_id = ${org} and hd.head_user_id = ${me} and hd.archived_at is null`;
    parts.push(`${g}.department_id in (${headed})`);
    parts.push(`${g}.owner_id in (select hu.id from users hu where hu.org_id = ${org} and hu.department_id in (${headed}))`);
  }
  return `${base} and (${parts.join(' or ')})`;
}

/** Owner ids whose data the caller may see in aggregate (analytics / team views). */
export function scopeOwnerPredicate(ctx: Ctx, params: unknown[], ownerCol: string): string {
  if (can(ctx, 'analytics.read_org') || can(ctx, 'goals.read_org')) return 'true';
  params.push(ctx.userId); const me = `$${params.length}`;
  const parts = [`${ownerCol} = ${me}`];
  const needsOrg = can(ctx, 'analytics.read_scope') || can(ctx, 'goals.read_reports') || can(ctx, 'goals.read_department');
  const org = needsOrg ? (params.push(ctx.orgId), `$${params.length}`) : '';
  if (can(ctx, 'analytics.read_scope') || can(ctx, 'goals.read_reports')) parts.push(`${ownerCol} in (select reporting_subtree(${org}, ${me}))`);
  if (can(ctx, 'goals.read_department')) {
    parts.push(`${ownerCol} in (select hu.id from users hu where hu.org_id = ${org} and hu.department_id in
      (select department_descendants(${org}, hd.id) from departments hd where hd.org_id = ${org} and hd.head_user_id = ${me} and hd.archived_at is null))`);
  }
  return `(${parts.join(' or ')})`;
}

export interface GoalRow {
  id: string; org_id: string; cycle_id: string; level: string; title: string; description: string | null;
  expected_outcome: string | null; context: string | null; owner_id: string; department_id: string | null; team_id: string | null;
  parent_goal_id: string | null; priority: string; status: string; start_date: string | null; due_date: string | null;
  weight: number; progress_mode: 'own' | 'rollup'; version: number; content_version: number; created_by: string;
  submitted_at: string | null; approved_at: string | null; completed_at: string | null; template_id: string | null;
  completion_note: string | null; cancel_reason: string | null; created_at: string; updated_at: string;
}

export const GOAL_COLS = `g.id, g.org_id, g.cycle_id, g.level, g.title, g.description, g.expected_outcome, g.context, g.owner_id, g.department_id, g.team_id,
  g.parent_goal_id, g.priority, g.status, g.start_date, g.due_date, g.weight, g.progress_mode, g.version, g.content_version, g.created_by,
  g.submitted_at, g.approved_at, g.completed_at, g.completion_note, g.cancel_reason, g.template_id, g.created_at, g.updated_at`;

/** Fetch a goal the caller may see, or 404. Never reveals whether an invisible goal exists. */
export async function getVisibleGoal(tx: Tx, ctx: Ctx, goalId: string, lock = false): Promise<GoalRow> {
  const params: unknown[] = [ctx.orgId, goalId];
  const vis = goalVisibility(ctx, params);
  const g = await tx.one<GoalRow>(`select ${GOAL_COLS} from goals g where g.org_id = $1 and g.id = $2 and ${vis} ${lock ? 'for update of g' : ''}`, params);
  if (!g) throw notFound('Goal');
  return g;
}

/** Is `ancestorId` somewhere above `userId` in the reporting line? */
export async function isManagerOf(tx: Tx, orgId: string, ancestorId: string, userId: string): Promise<boolean> {
  if (ancestorId === userId) return false;
  return !!(await tx.one('select 1 from reporting_subtree($1, $2) s where s = $3', [orgId, ancestorId, userId]));
}

export async function isCollaborator(tx: Tx, orgId: string, goalId: string, userId: string) {
  return !!(await tx.one('select 1 from goal_collaborators where org_id = $1 and goal_id = $2 and user_id = $3', [orgId, goalId, userId]));
}

/** Owner, or somebody who manages the owner (any level) — the people who may steer a goal on the owner's behalf. */
export async function assertOwnerOrManager(tx: Tx, ctx: Ctx, g: Pick<GoalRow, 'owner_id'>, extra?: () => boolean) {
  if (g.owner_id === ctx.userId) return;
  if (await isManagerOf(tx, ctx.orgId, ctx.userId, g.owner_id)) return;
  if (extra?.()) return;
  throw forbidden();
}

export const EDITABLE_STATUSES = ['draft', 'changes_requested', 'rejected'];
