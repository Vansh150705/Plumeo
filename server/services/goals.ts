import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, can, requirePerm } from '../core/context';
import { AppError, conflict, forbidden, invalid, invalidState, notFound } from '../core/errors';
import { isoDate, pageParams, parse, uuid, type Page } from '../core/validation';
import { resolvePolicy, type OrgPolicy } from '@/lib/policy';
import { lintGoal } from '@/lib/goal-rules';
import { audit, entityHistory } from './audit';
import { notify } from './notifications';
import {
  EDITABLE_STATUSES, GOAL_COLS, assertOwnerOrManager, getVisibleGoal, goalVisibility, isCollaborator, isManagerOf, type GoalRow,
} from './goal-access';
import { loadProgress, riskFor, withKrProgress, type KrRow } from './progress';

export const LEVELS = ['company', 'department', 'team', 'individual'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const STATUSES = ['draft', 'pending_approval', 'changes_requested', 'rejected', 'active', 'completed', 'cancelled'] as const;

export const keyResultInput = z.object({
  id: uuid.optional(),
  title: z.string().trim().min(1).max(300),
  metricType: z.enum(['number', 'percent', 'currency', 'boolean']).default('number'),
  direction: z.enum(['increase', 'decrease']).optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  startValue: z.number().finite().default(0),
  targetValue: z.number().finite(),
  weight: z.number().positive().max(1000).default(1),
}).strict();
export type KeyResultInput = z.infer<typeof keyResultInput>;

export function normalizeKr(k: KeyResultInput) {
  if (k.metricType === 'boolean') return { ...k, startValue: 0, targetValue: 1, direction: 'increase' as const };
  const direction = k.direction ?? (k.targetValue < k.startValue ? 'decrease' : 'increase');
  if (k.startValue === k.targetValue) throw invalid(`Key result "${k.title}": the target must differ from the starting value.`);
  if ((direction === 'increase') !== (k.targetValue > k.startValue)) {
    throw invalid(`Key result "${k.title}": the target must be ${direction === 'increase' ? 'above' : 'below'} the start value.`);
  }
  return { ...k, direction };
}

const shared = {
  description: z.string().trim().max(5000).nullable().optional(),
  expectedOutcome: z.string().trim().max(2000).nullable().optional(),
  context: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  startDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  departmentId: uuid.nullable().optional(),
  teamId: uuid.nullable().optional(),
  parentGoalId: uuid.nullable().optional(),
  weight: z.number().positive().max(1000).optional(),
  progressMode: z.enum(['own', 'rollup']).optional(),
  collaborators: z.array(z.object({ userId: uuid, role: z.enum(['contributor', 'reviewer']).default('contributor') }).strict()).max(20).optional(),
  keyResults: z.array(keyResultInput).max(20).optional(),
};

export const createGoalSchema = z.object({
  cycleId: uuid, level: z.enum(LEVELS), title: z.string().trim().min(1).max(200),
  ownerId: uuid.optional(), templateId: uuid.optional(), ...shared,
}).strict();

export const updateGoalSchema = z.object({
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(), ...shared,
}).strict();

const goalMapError = (e: any): never => {
  if (e?.code === '23514' || e?.code === '23503') throw invalid(e.message.replace(/^.*?: /, ''));
  throw e;
};

async function policyOf(tx: Tx, orgId: string): Promise<OrgPolicy> {
  return resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [orgId]))?.settings);
}

async function headsDepartment(tx: Tx, orgId: string, userId: string, deptId: string | null) {
  if (!deptId) return false;
  return !!(await tx.one(
    `select 1 from departments d where d.org_id = $1 and d.head_user_id = $2 and d.id in (select department_ancestors($1, $3))`, [orgId, userId, deptId]));
}

/** Who may author a goal at a given organisational level. */
async function assertCanAuthor(tx: Tx, ctx: Ctx, level: string, departmentId: string | null, teamId: string | null) {
  if (level === 'individual') return;
  if (level === 'company') { requirePerm(ctx, 'goals.create_company'); return; }
  if (level === 'department') {
    requirePerm(ctx, 'goals.create_department');
    if (can(ctx, 'goals.read_org') || (await headsDepartment(tx, ctx.orgId, ctx.userId, departmentId))) return;
    throw forbidden('Only the department head (or an administrator) can set department goals.');
  }
  requirePerm(ctx, 'goals.create_team');
  if (can(ctx, 'goals.read_org')) return;
  const t = await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2', [ctx.orgId, teamId]);
  if (!t) throw notFound('Team');
  const lead = await tx.one(`select 1 from teams x where x.org_id = $1 and x.lead_user_id = $2 and x.id in (select team_ancestors($1, $3))`, [ctx.orgId, ctx.userId, teamId]);
  const member = await tx.one(`select 1 from users u where u.org_id = $1 and u.id = $2 and u.team_id in (select team_ancestors($1, $3))`, [ctx.orgId, ctx.userId, teamId]);
  if (lead || member || (await headsDepartment(tx, ctx.orgId, ctx.userId, t.department_id))) return;
  throw forbidden('Only the team lead, a team member with team-goal rights, or the department head can set team goals.');
}

export async function writeKeyResults(tx: Tx, ctx: Ctx, goalId: string, items: KeyResultInput[]) {
  const existing = await tx.query<{ id: string }>('select id from key_results where org_id = $1 and goal_id = $2 and removed_at is null', [ctx.orgId, goalId]);
  const keep = new Set<string>();
  let pos = 0;
  for (const raw of items) {
    const k = normalizeKr(raw);
    if (k.id) {
      if (!existing.some((e) => e.id === k.id)) throw notFound('Key result');
      keep.add(k.id);
      await tx.exec(`update key_results set title=$3, metric_type=$4, direction=$5, unit=$6, start_value=$7, target_value=$8, weight=$9, position=$10 where org_id=$1 and id=$2`,
        [ctx.orgId, k.id, k.title, k.metricType, k.direction, k.unit ?? null, k.startValue, k.targetValue, k.weight, pos++]);
    } else {
      await tx.exec(`insert into key_results (org_id, goal_id, title, metric_type, direction, unit, start_value, target_value, weight, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ctx.orgId, goalId, k.title, k.metricType, k.direction, k.unit ?? null, k.startValue, k.targetValue, k.weight, pos++]);
    }
  }
  for (const e of existing) if (!keep.has(e.id)) await tx.exec('update key_results set removed_at = now() where org_id = $1 and id = $2', [ctx.orgId, e.id]);
}

async function writeCollaborators(tx: Tx, ctx: Ctx, goalId: string, ownerId: string, items: { userId: string; role: string }[]) {
  await tx.exec('delete from goal_collaborators where org_id = $1 and goal_id = $2', [ctx.orgId, goalId]);
  for (const c of items) {
    if (c.userId === ownerId) continue;
    const u = await tx.one<{ status: string }>('select status from users where org_id = $1 and id = $2', [ctx.orgId, c.userId]);
    if (!u) throw notFound('Collaborator');
    if (u.status !== 'active') throw invalid('Collaborators must be active users.');
    await tx.exec(`insert into goal_collaborators (org_id, goal_id, user_id, role, added_by) values ($1,$2,$3,$4,$5) on conflict do nothing`, [ctx.orgId, goalId, c.userId, c.role, ctx.userId]);
  }
}

async function checkParent(tx: Tx, ctx: Ctx, parentId: string, cycleId: string) {
  const p = await getVisibleGoal(tx, ctx, parentId).catch((e) => { if (e instanceof AppError && e.code === 'not_found') throw invalid('The goal you are aligning to was not found.'); throw e; });
  if (p.cycle_id !== cycleId) throw invalid('You can only align to a goal in the same cycle.');
  if (p.status !== 'active') throw invalid('You can only align to an approved (active) goal.');
}

export async function createGoal(ctx: Ctx, input: unknown) {
  const d = parse(createGoalSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const policy = await policyOf(tx, ctx.orgId);
    const cycle = await tx.one<{ status: string }>('select status from cycles where org_id = $1 and id = $2', [ctx.orgId, d.cycleId]);
    if (!cycle) throw notFound('Cycle');
    if (cycle.status === 'closed') throw invalidState('This cycle is closed.');

    let tpl: any = null;
    if (d.templateId) {
      tpl = await tx.one<any>('select * from goal_templates where org_id = $1 and id = $2 and archived_at is null', [ctx.orgId, d.templateId]);
      if (!tpl) throw notFound('Template');
      if (tpl.level !== d.level) throw invalid(`That template is for ${tpl.level} goals.`);
    }
    const t = tpl?.content ?? {};

    const ownerId = d.ownerId ?? ctx.userId;
    const owner = await tx.one<{ status: string; department_id: string | null; team_id: string | null }>('select status, department_id, team_id from users where org_id = $1 and id = $2', [ctx.orgId, ownerId]);
    if (!owner) throw notFound('Owner');
    if (owner.status !== 'active') throw invalid('The owner must be an active user.');
    if (ownerId !== ctx.userId && !(await isManagerOf(tx, ctx.orgId, ctx.userId, ownerId)) && !can(ctx, 'goals.reassign')) {
      throw forbidden('You can only create goals for yourself or the people who report to you.');
    }

    let departmentId = d.departmentId === undefined ? (tpl?.department_id ?? null) : d.departmentId;
    let teamId = d.teamId ?? null;
    if (d.level === 'individual' || (d.level === 'department' && !departmentId) || d.level === 'team') {
      if (!departmentId && d.level !== 'team') departmentId = owner.department_id;
      if (d.level === 'team' && !teamId) teamId = owner.team_id;
      if (d.level === 'individual' && !teamId) teamId = owner.team_id;
    }
    if (teamId) {
      const team = await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2', [ctx.orgId, teamId]);
      if (!team) throw notFound('Team');
      if (d.level === 'team' || !departmentId) departmentId = team.department_id;
    }
    if (d.level === 'department' && !departmentId) throw invalid('Choose the department this goal belongs to.');
    if (d.level === 'team' && !teamId) throw invalid('Choose the team this goal belongs to.');
    await assertCanAuthor(tx, ctx, d.level, departmentId, teamId);

    if (d.level === 'individual') {
      const n = await tx.one<{ n: number }>(
        `select count(*)::int as n from goals where org_id = $1 and owner_id = $2 and cycle_id = $3 and level = 'individual' and deleted_at is null and status not in ('completed','cancelled','rejected')`,
        [ctx.orgId, ownerId, d.cycleId]);
      if (n!.n >= policy.goals.maxActiveIndividualGoals) throw invalidState(`An individual can have at most ${policy.goals.maxActiveIndividualGoals} open goals per cycle.`);
    }
    if (d.parentGoalId) await checkParent(tx, ctx, d.parentGoalId, d.cycleId);

    let row: { id: string } | null;
    try {
      row = await tx.one<{ id: string }>(
        `insert into goals (org_id, cycle_id, level, title, description, expected_outcome, context, owner_id, department_id, team_id, parent_goal_id,
           priority, start_date, due_date, weight, progress_mode, template_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
        [ctx.orgId, d.cycleId, d.level, d.title, d.description ?? t.description ?? null, d.expectedOutcome ?? t.expectedOutcome ?? null, d.context ?? null,
         ownerId, departmentId, teamId, d.parentGoalId ?? null, d.priority ?? t.priority ?? 'medium', d.startDate ?? null, d.dueDate ?? null,
         d.weight ?? 1, d.progressMode ?? 'own', d.templateId ?? null, ctx.userId]);
    } catch (e) { return goalMapError(e); }
    const krs = d.keyResults ?? (t.keyResults as KeyResultInput[] | undefined)?.map((k: any) => keyResultInput.parse(k)) ?? [];
    await writeKeyResults(tx, ctx, row!.id, krs);
    if (d.collaborators) await writeCollaborators(tx, ctx, row!.id, ownerId, d.collaborators);
    if (d.templateId) await tx.exec('update goal_templates set usage_count = usage_count + 1 where org_id = $1 and id = $2', [ctx.orgId, d.templateId]);
    await audit(tx, ctx, { action: 'goal.created', entityType: 'goal', entityId: row!.id, after: { title: d.title, level: d.level, ownerId, cycleId: d.cycleId, parentGoalId: d.parentGoalId ?? null, templateId: d.templateId ?? null } });
    if (ownerId !== ctx.userId) {
      await notify(tx, ctx, { userId: ownerId, category: 'goals', type: 'goal.assigned', title: 'A goal was drafted for you', body: `${ctx.userName} drafted "${d.title}" for you to review and submit.`, link: `/app/goals/${row!.id}`, entityType: 'goal', entityId: row!.id, dedupeKey: `assigned:${row!.id}` });
    }
    return { id: row!.id, version: 1 };
  });
}

export async function updateGoal(ctx: Ctx, goalId: string, input: unknown) {
  parse(uuid, goalId);
  const d = parse(updateGoalSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    await assertOwnerOrManager(tx, ctx, g);
    if (!EDITABLE_STATUSES.includes(g.status)) {
      throw invalidState(g.status === 'active' ? 'Approved goals can only be changed through an amendment.' : `A goal that is ${g.status.replace('_', ' ')} cannot be edited.`);
    }
    if (g.version !== d.expectedVersion) throw conflict('This goal was changed by someone else. Reload to see the latest version.', { currentVersion: g.version });

    const next = {
      title: d.title ?? g.title,
      description: d.description === undefined ? g.description : d.description,
      expected_outcome: d.expectedOutcome === undefined ? g.expected_outcome : d.expectedOutcome,
      context: d.context === undefined ? g.context : d.context,
      priority: d.priority ?? g.priority,
      start_date: d.startDate === undefined ? g.start_date : d.startDate,
      due_date: d.dueDate === undefined ? g.due_date : d.dueDate,
      department_id: d.departmentId === undefined ? g.department_id : d.departmentId,
      team_id: d.teamId === undefined ? g.team_id : d.teamId,
      parent_goal_id: d.parentGoalId === undefined ? g.parent_goal_id : d.parentGoalId,
      weight: d.weight ?? g.weight,
      progress_mode: d.progressMode ?? g.progress_mode,
    };
    if (g.level === 'team' && d.teamId) {
      const team = await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2', [ctx.orgId, d.teamId]);
      if (!team) throw notFound('Team');
      next.department_id = team.department_id;
    }
    if (d.departmentId || d.teamId) await assertCanAuthor(tx, ctx, g.level, next.department_id, next.team_id);
    if (next.parent_goal_id && next.parent_goal_id !== g.parent_goal_id) await checkParent(tx, ctx, next.parent_goal_id, g.cycle_id);
    try {
      await tx.exec(
        `update goals set title=$3, description=$4, expected_outcome=$5, context=$6, priority=$7, start_date=$8, due_date=$9, department_id=$10, team_id=$11,
           parent_goal_id=$12, weight=$13, progress_mode=$14, version = version + 1 where org_id=$1 and id=$2`,
        [ctx.orgId, goalId, next.title, next.description, next.expected_outcome, next.context, next.priority, next.start_date, next.due_date,
         next.department_id, next.team_id, next.parent_goal_id, next.weight, next.progress_mode]);
    } catch (e) { return goalMapError(e); }
    if (d.keyResults) await writeKeyResults(tx, ctx, goalId, d.keyResults);
    if (d.collaborators) await writeCollaborators(tx, ctx, goalId, g.owner_id, d.collaborators);
    await audit(tx, ctx, {
      action: 'goal.updated', entityType: 'goal', entityId: goalId,
      before: { title: g.title, description: g.description, expected_outcome: g.expected_outcome, priority: g.priority, start_date: g.start_date, due_date: g.due_date, parent_goal_id: g.parent_goal_id },
      after: { ...next, keyResultsChanged: !!d.keyResults },
    });
    return { version: g.version + 1 };
  });
}

export async function deleteDraftGoal(ctx: Ctx, goalId: string) {
  parse(uuid, goalId);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    await assertOwnerOrManager(tx, ctx, g);
    if (g.status !== 'draft') throw invalidState('Only drafts can be deleted. Submitted or approved goals can be withdrawn or cancelled instead.');
    const kids = await tx.one<{ n: number }>('select count(*)::int as n from goals where org_id = $1 and parent_goal_id = $2 and deleted_at is null', [ctx.orgId, goalId]);
    if (kids!.n) throw conflict('Other goals are aligned to this goal.');
    await tx.exec('update goals set deleted_at = now(), version = version + 1 where org_id = $1 and id = $2', [ctx.orgId, goalId]);
    await audit(tx, ctx, { action: 'goal.deleted', entityType: 'goal', entityId: goalId, before: { title: g.title, status: g.status } });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface GoalFilters {
  cycleId?: string; level?: string[]; status?: string[]; ownerId?: string; departmentId?: string; teamId?: string; parentGoalId?: string | 'none';
  priority?: string[]; q?: string; mine?: boolean; dueBefore?: string; dueAfter?: string; risk?: string[]; sort?: string; order?: 'asc' | 'desc';
  limit?: number; offset?: number;
}

const SORTS: Record<string, string> = {
  updated: 'g.updated_at', due: 'g.due_date', title: 'lower(g.title)', created: 'g.created_at', priority: `array_position(array['critical','high','medium','low'], g.priority)`, status: 'g.status',
};

export async function listGoals(ctx: Ctx, f: GoalFilters): Promise<Page<any>> {
  const { limit, offset } = parse(pageParams, { limit: f.limit, offset: f.offset });
  return withOrg(ctx.orgId, async (tx) => {
    const policy = await policyOf(tx, ctx.orgId);
    const params: unknown[] = [ctx.orgId];
    const w: string[] = ['g.org_id = $1', goalVisibility(ctx, params)];
    const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
    if (f.cycleId) add('g.cycle_id = ?', parse(uuid, f.cycleId));
    if (f.level?.length) add('g.level = any(?::text[])', f.level);
    if (f.status?.length) add('g.status = any(?::text[])', f.status);
    if (f.priority?.length) add('g.priority = any(?::text[])', f.priority);
    if (f.ownerId) add('g.owner_id = ?', parse(uuid, f.ownerId));
    if (f.teamId) add('g.team_id = ?', parse(uuid, f.teamId));
    if (f.departmentId) {
      params.push(parse(uuid, f.departmentId));
      const p = `$${params.length}`;
      w.push(`(g.department_id in (select department_descendants($1, ${p})) or ou.department_id in (select department_descendants($1, ${p})))`);
    }
    if (f.parentGoalId === 'none') w.push('g.parent_goal_id is null'); else if (f.parentGoalId) add('g.parent_goal_id = ?', parse(uuid, f.parentGoalId));
    if (f.mine) {
      params.push(ctx.userId);
      w.push(`(g.owner_id = $${params.length} or exists (select 1 from goal_collaborators gc where gc.org_id = g.org_id and gc.goal_id = g.id and gc.user_id = $${params.length}))`);
    }
    if (f.dueBefore) add('g.due_date <= ?::date', f.dueBefore);
    if (f.dueAfter) add('g.due_date >= ?::date', f.dueAfter);
    if (f.q) {
      params.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
      w.push(`(g.title ilike $${params.length} or g.description ilike $${params.length})`);
    }
    const where = w.join(' and ');
    const from = `from goals g join users ou on ou.org_id = g.org_id and ou.id = g.owner_id
      left join departments dd on dd.org_id = g.org_id and dd.id = coalesce(g.department_id, ou.department_id)
      left join teams tt on tt.org_id = g.org_id and tt.id = coalesce(g.team_id, ou.team_id)
      left join goals pg on pg.org_id = g.org_id and pg.id = g.parent_goal_id`;
    const sort = SORTS[f.sort ?? 'updated'] ?? SORTS.updated;
    const order = f.order === 'asc' ? 'asc' : 'desc';
    const riskFilter = f.risk?.length;
    // risk is derived from progress, so when filtering by it we fetch a wider window then trim.
    const rows = await tx.query<any>(
      `select ${GOAL_COLS}, ou.full_name as owner_name, dd.name as department_name, tt.name as team_name, pg.title as parent_title,
         (select count(*)::int from key_results k where k.org_id = g.org_id and k.goal_id = g.id and k.removed_at is null) as kr_count,
         (select count(*)::int from goals c where c.org_id = g.org_id and c.parent_goal_id = g.id and c.deleted_at is null) as child_count
       ${from} where ${where} order by ${sort} ${order} nulls last, g.id ${riskFilter ? '' : `limit ${limit} offset ${offset}`}`, params);
    const total = riskFilter ? -1 : (await tx.one<{ n: number }>(`select count(*)::int as n ${from} where ${where}`, params))!.n;
    const prog = await loadProgress(tx, ctx.orgId, rows.map((r) => r.id));
    let items = rows.map((r) => {
      const p = prog.get(r.id);
      return { ...r, progress: p?.effective ?? null, own_progress: p?.own ?? null, contributors: p?.contributors ?? 0, risk: riskFor(r, p, policy) };
    });
    if (riskFilter) {
      items = items.filter((i) => f.risk!.includes(i.risk));
      const t = items.length;
      return { data: items.slice(offset, offset + limit), page: { limit, offset, total: t } };
    }
    return { data: items, page: { limit, offset, total } };
  });
}

/** Ancestors up the alignment chain, redacted to what is needed to see "how my work contributes". */
async function ancestorsOf(tx: Tx, orgId: string, goalId: string) {
  return tx.query<any>(
    `with recursive a as (
       select p.id, p.parent_goal_id, 1 as depth from goals g join goals p on p.org_id = g.org_id and p.id = g.parent_goal_id where g.org_id = $1 and g.id = $2 and p.deleted_at is null
       union all
       select p.id, p.parent_goal_id, a.depth + 1 from a join goals p on p.org_id = $1 and p.id = a.parent_goal_id where p.deleted_at is null and a.depth < 12)
     select g.id, g.title, g.level, g.status, g.owner_id, u.full_name as owner_name, a.depth from a join goals g on g.org_id = $1 and g.id = a.id
       join users u on u.org_id = g.org_id and u.id = g.owner_id order by a.depth desc`, [orgId, goalId]);
}

export async function getGoalDetail(ctx: Ctx, goalId: string) {
  parse(uuid, goalId);
  return withOrg(ctx.orgId, async (tx) => {
    const policy = await policyOf(tx, ctx.orgId);
    const g = await getVisibleGoal(tx, ctx, goalId);
    const meta = await tx.one<any>(
      `select ou.full_name as owner_name, ou.job_title as owner_title, ou.manager_id as owner_manager_id, cb.full_name as created_by_name, dd.name as department_name, tt.name as team_name, cy.name as cycle_name
       from goals g join users ou on ou.org_id = g.org_id and ou.id = g.owner_id join users cb on cb.org_id = g.org_id and cb.id = g.created_by
       left join departments dd on dd.org_id = g.org_id and dd.id = coalesce(g.department_id, ou.department_id)
       left join teams tt on tt.org_id = g.org_id and tt.id = coalesce(g.team_id, ou.team_id)
       join cycles cy on cy.org_id = g.org_id and cy.id = g.cycle_id where g.org_id = $1 and g.id = $2`, [ctx.orgId, goalId]);
    const krRows = await tx.query<KrRow>(
      `select id, goal_id, title, metric_type, direction, unit, start_value, target_value, current_value, weight, position from key_results
       where org_id = $1 and goal_id = $2 and removed_at is null order by position, created_at`, [ctx.orgId, goalId]);
    const prog = (await loadProgress(tx, ctx.orgId, [goalId])).get(goalId);
    const collaborators = await tx.query(`select c.user_id, c.role, u.full_name from goal_collaborators c join users u on u.org_id = c.org_id and u.id = c.user_id where c.org_id = $1 and c.goal_id = $2 order by u.full_name`, [ctx.orgId, goalId]);

    const childParams: unknown[] = [ctx.orgId, goalId];
    const childVis = goalVisibility(ctx, childParams, 'c');
    const children = await tx.query<any>(
      `select c.id, c.title, c.level, c.status, c.owner_id, ou.full_name as owner_name, c.weight, c.due_date from goals c join users ou on ou.org_id = c.org_id and ou.id = c.owner_id
       where c.org_id = $1 and c.parent_goal_id = $2 and ${childVis} order by c.created_at`, childParams);
    const childProg = await loadProgress(tx, ctx.orgId, children.map((c) => c.id));
    const totalChildren = (await tx.one<{ n: number }>('select count(*)::int as n from goals where org_id = $1 and parent_goal_id = $2 and deleted_at is null', [ctx.orgId, goalId]))!.n;

    const approvals = await tx.query(
      `select ar.id, ar.round, ar.level, ar.status, ar.approver_id, ap.full_name as approver_name, ar.amendment_id, ar.goal_version, ar.requested_at, ar.activated_at, ar.due_at,
              ar.decided_by, dc.full_name as decided_by_name, ar.on_behalf_of, ob.full_name as on_behalf_of_name, ar.decided_at, ar.decision_comment
       from approval_requests ar left join users ap on ap.org_id = ar.org_id and ap.id = ar.approver_id
       left join users dc on dc.org_id = ar.org_id and dc.id = ar.decided_by left join users ob on ob.org_id = ar.org_id and ob.id = ar.on_behalf_of
       where ar.org_id = $1 and ar.goal_id = $2 order by ar.round desc, ar.level`, [ctx.orgId, goalId]);
    const versions = await tx.query(
      `select v.version, v.change_summary, v.change_reason, v.changed_by, u.full_name as changed_by_name, v.created_at, v.amendment_id
       from goal_versions v left join users u on u.org_id = v.org_id and u.id = v.changed_by where v.org_id = $1 and v.goal_id = $2 order by v.version desc`, [ctx.orgId, goalId]);
    const amendments = await tx.query(
      `select a.id, a.status, a.reason, a.change_kinds, a.significant, a.changes, a.base_version, a.requested_by, u.full_name as requested_by_name, a.requested_at, a.decided_at, a.applied_version
       from goal_amendments a join users u on u.org_id = a.org_id and u.id = a.requested_by where a.org_id = $1 and a.goal_id = $2 order by a.requested_at desc`, [ctx.orgId, goalId]);
    const progressHistory = await tx.query(
      `select p.id, p.key_result_id, k.title as key_result_title, p.value, p.previous_value, p.progress_pct, p.note, p.source, p.created_by, u.full_name as created_by_name, p.created_at
       from progress_updates p join key_results k on k.org_id = p.org_id and k.id = p.key_result_id join users u on u.org_id = p.org_id and u.id = p.created_by
       where p.org_id = $1 and p.goal_id = $2 order by p.created_at desc limit 50`, [ctx.orgId, goalId]);
    const checkins = await tx.query(
      `select c.id, c.period_id, p.name as period_name, p.sequence, c.status, c.current_revision, c.health, c.progress_snapshot, c.submitted_at, c.is_late, c.reviewed_at
       from checkins c join review_periods p on p.org_id = c.org_id and p.id = c.period_id where c.org_id = $1 and c.goal_id = $2 order by p.sequence desc`, [ctx.orgId, goalId]);
    const ancestors = await ancestorsOf(tx, ctx.orgId, goalId);
    const ancProg = await loadProgress(tx, ctx.orgId, ancestors.map((a) => a.id));
    const history = await entityHistory(tx, ctx.orgId, 'goal', goalId, 100);

    const isOwner = g.owner_id === ctx.userId;
    const mgr = !isOwner && (await isManagerOf(tx, ctx.orgId, ctx.userId, g.owner_id));
    const collab = !isOwner && (await isCollaborator(tx, ctx.orgId, goalId, ctx.userId));
    const pending = approvals.find((a: any) => a.status === 'pending');
    const open = ['active'].includes(g.status);
    const lint = lintGoal({ title: g.title, description: g.description, expected_outcome: g.expected_outcome }, krRows);

    return {
      goal: { ...g, ...meta, progress: prog?.effective ?? null, own_progress: prog?.own ?? null, contributors: prog?.contributors ?? 0, risk: riskFor(g, prog, policy) },
      keyResults: krRows.map(withKrProgress),
      collaborators, children: children.map((c) => ({ ...c, progress: childProg.get(c.id)?.effective ?? null })), hiddenChildren: Math.max(0, totalChildren - children.length),
      ancestors: ancestors.map((a) => ({ ...a, progress: ancProg.get(a.id)?.effective ?? null })),
      approvals, versions, amendments, progressHistory, checkins, history, lint,
      permissions: {
        edit: (isOwner || mgr) && EDITABLE_STATUSES.includes(g.status),
        submit: isOwner && EDITABLE_STATUSES.includes(g.status),
        withdraw: (isOwner || mgr) && g.status === 'pending_approval',
        delete: (isOwner || mgr) && g.status === 'draft',
        recordProgress: (isOwner || collab) && open,
        complete: (isOwner || mgr) && open,
        cancel: (mgr || isOwner || can(ctx, 'goals.reassign')) && !['completed', 'cancelled'].includes(g.status),
        amend: (isOwner || mgr || can(ctx, 'goals.reassign')) && open && !amendments.some((a: any) => a.status === 'pending_approval'),
        transfer: can(ctx, 'goals.reassign') && ['active', 'draft', 'changes_requested'].includes(g.status),
        decide: pending ? pending.id : null,
      },
    };
  });
}

/** Visible goals of a cycle as a flat node list; the client assembles the hierarchy. */
export async function getAlignment(ctx: Ctx, cycleId: string, opts: { includeInactive?: boolean } = {}) {
  parse(uuid, cycleId);
  return withOrg(ctx.orgId, async (tx) => {
    const policy = await policyOf(tx, ctx.orgId);
    const params: unknown[] = [ctx.orgId, cycleId];
    const vis = goalVisibility(ctx, params);
    const statuses = opts.includeInactive ? STATUSES : ['active', 'completed', 'pending_approval'];
    params.push(statuses);
    const rows = await tx.query<any>(
      `select g.id, g.title, g.level, g.status, g.owner_id, ou.full_name as owner_name, g.parent_goal_id, g.weight, g.progress_mode, g.start_date, g.due_date, g.priority
       from goals g join users ou on ou.org_id = g.org_id and ou.id = g.owner_id
       where g.org_id = $1 and g.cycle_id = $2 and ${vis} and g.status = any($${params.length}::text[])
       order by case g.level when 'company' then 0 when 'department' then 1 when 'team' then 2 else 3 end, g.title limit 3000`, params);
    const prog = await loadProgress(tx, ctx.orgId, rows.map((r) => r.id));
    const ids = new Set(rows.map((r) => r.id));
    // Parents the viewer cannot otherwise see are surfaced as redacted context nodes.
    const missing = [...new Set(rows.map((r) => r.parent_goal_id).filter((p): p is string => !!p && !ids.has(p)))];
    const context = missing.length ? await tx.query<any>(
      `select g.id, g.title, g.level, g.status, g.owner_id, ou.full_name as owner_name, g.parent_goal_id, g.weight, g.progress_mode, g.start_date, g.due_date, g.priority, true as redacted
       from goals g join users ou on ou.org_id = g.org_id and ou.id = g.owner_id where g.org_id = $1 and g.id = any($2::uuid[]) and g.deleted_at is null and g.status in ('active','completed')`, [ctx.orgId, missing]) : [];
    const ctxProg = await loadProgress(tx, ctx.orgId, context.map((c) => c.id));
    const nodes = [...context.map((n) => ({ ...n, progress: ctxProg.get(n.id)?.effective ?? null, risk: riskFor(n, ctxProg.get(n.id), policy) })),
      ...rows.map((n) => ({ ...n, redacted: false, progress: prog.get(n.id)?.effective ?? null, risk: riskFor(n, prog.get(n.id), policy) }))];
    return { nodes };
  });
}

// ---------------------------------------------------------------------------
// Progress, completion, cancellation, transfer
// ---------------------------------------------------------------------------

const progressSchema = z.object({
  updates: z.array(z.object({ keyResultId: uuid, value: z.number().finite(), note: z.string().trim().max(1000).optional() }).strict()).min(1).max(20),
}).strict();

export async function recordProgress(ctx: Ctx, goalId: string, input: unknown) {
  parse(uuid, goalId);
  const d = parse(progressSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    if (g.owner_id !== ctx.userId && !(await isCollaborator(tx, ctx.orgId, goalId, ctx.userId))) throw forbidden('Only the owner or a collaborator can record progress.');
    if (g.status !== 'active') throw invalidState('Progress can only be recorded on approved, active goals.');
    const { keyResultProgress } = await import('@/lib/progress');
    const changes: unknown[] = [];
    for (const u of d.updates) {
      const kr = await tx.one<any>('select * from key_results where org_id = $1 and id = $2 and goal_id = $3 and removed_at is null for update', [ctx.orgId, u.keyResultId, goalId]);
      if (!kr) throw notFound('Key result');
      if (kr.metric_type === 'boolean' && ![0, 1].includes(u.value)) throw invalid('Yes/no key results take 0 or 1.');
      const pct = keyResultProgress({ ...kr, current_value: u.value });
      await tx.exec('update key_results set current_value = $3 where org_id = $1 and id = $2', [ctx.orgId, kr.id, u.value]);
      await tx.exec(`insert into progress_updates (org_id, goal_id, key_result_id, value, previous_value, progress_pct, note, source, created_by) values ($1,$2,$3,$4,$5,$6,$7,'manual',$8)`,
        [ctx.orgId, goalId, kr.id, u.value, kr.current_value, pct, u.note ?? null, ctx.userId]);
      changes.push({ keyResultId: kr.id, from: kr.current_value, to: u.value, progress: pct });
    }
    await audit(tx, ctx, { action: 'goal.progress_updated', entityType: 'goal', entityId: goalId, after: { changes } });
    return { changes };
  });
}

export async function completeGoal(ctx: Ctx, goalId: string, note?: string) {
  parse(uuid, goalId);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    await assertOwnerOrManager(tx, ctx, g);
    if (g.status !== 'active') throw invalidState('Only active goals can be completed.');
    await tx.exec(`update goals set status = 'completed', completed_at = now(), completion_note = $3, version = version + 1 where org_id = $1 and id = $2`, [ctx.orgId, goalId, note?.slice(0, 2000) ?? null]);
    const prog = (await loadProgress(tx, ctx.orgId, [goalId])).get(goalId);
    await audit(tx, ctx, { action: 'goal.completed', entityType: 'goal', entityId: goalId, before: { status: 'active' }, after: { status: 'completed', progress: prog?.effective ?? null, note: note ?? null } });
    const ownerRow = await tx.one<{ manager_id: string | null }>('select manager_id from users where org_id = $1 and id = $2', [ctx.orgId, g.owner_id]);
    const targets = new Set<string>();
    if (ownerRow?.manager_id) targets.add(ownerRow.manager_id);
    if (g.owner_id !== ctx.userId) targets.add(g.owner_id);
    targets.delete(ctx.userId);
    for (const userId of targets) {
      await notify(tx, ctx, { userId, category: 'goals', type: 'goal.completed', title: `Goal completed: ${g.title}`, body: `${ctx.userName} marked "${g.title}" complete.`, link: `/app/goals/${goalId}`, entityType: 'goal', entityId: goalId, dedupeKey: `completed:${goalId}` });
    }
    if (g.level === 'company' || g.level === 'department') {
      const { publishOrgEvent } = await import('./notifications');
      await publishOrgEvent(tx, ctx, { event: 'goal.completed', text: `🎯 ${g.level === 'company' ? 'Company' : 'Department'} goal completed: ${g.title}`, link: `/app/goals/${goalId}`, dedupeKey: `completed:${goalId}` });
    }
    return { ok: true };
  });
}

export async function cancelGoal(ctx: Ctx, goalId: string, reason: string) {
  parse(uuid, goalId);
  const why = parse(z.string().trim().min(5).max(1000), reason);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    await assertOwnerOrManager(tx, ctx, g, () => can(ctx, 'goals.reassign'));
    if (['completed', 'cancelled'].includes(g.status)) throw invalidState(`This goal is already ${g.status}.`);
    await tx.exec(`update approval_requests set status = 'cancelled' where org_id = $1 and goal_id = $2 and status in ('pending','waiting')`, [ctx.orgId, goalId]);
    await tx.exec(`update goal_amendments set status = 'withdrawn', decided_at = now() where org_id = $1 and goal_id = $2 and status = 'pending_approval'`, [ctx.orgId, goalId]);
    await tx.exec(`update goals set status = 'cancelled', cancelled_at = now(), cancel_reason = $3, version = version + 1 where org_id = $1 and id = $2`, [ctx.orgId, goalId, why]);
    await audit(tx, ctx, { action: 'goal.cancelled', entityType: 'goal', entityId: goalId, before: { status: g.status }, after: { status: 'cancelled', reason: why } });
    const children = await tx.query<{ owner_id: string; id: string; title: string }>(
      `select id, owner_id, title from goals where org_id = $1 and parent_goal_id = $2 and deleted_at is null and status not in ('cancelled','completed')`, [ctx.orgId, goalId]);
    for (const c of children) {
      await notify(tx, ctx, { userId: c.owner_id, category: 'goals', type: 'goal.parent_cancelled', title: 'A goal you align to was cancelled', body: `"${g.title}" was cancelled. Consider re-aligning "${c.title}".`, link: `/app/goals/${c.id}`, entityType: 'goal', entityId: c.id, dedupeKey: `parent-cancelled:${goalId}:${c.id}` });
    }
    if (g.owner_id !== ctx.userId) {
      await notify(tx, ctx, { userId: g.owner_id, category: 'goals', type: 'goal.cancelled', title: `Goal cancelled: ${g.title}`, body: `${ctx.userName} cancelled this goal: ${why}`, link: `/app/goals/${goalId}`, entityType: 'goal', entityId: goalId, dedupeKey: `cancelled:${goalId}` });
    }
    return { ok: true };
  });
}

/** Immediate ownership transfer by an authorised HR / admin user (managers use an amendment, which needs approval). */
export async function transferOwnership(ctx: Ctx, goalId: string, newOwnerId: string, reason: string) {
  requirePerm(ctx, 'goals.reassign');
  parse(uuid, goalId); parse(uuid, newOwnerId);
  const why = parse(z.string().trim().min(5).max(1000), reason);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId, true);
    if (!['active', 'draft', 'changes_requested'].includes(g.status)) throw invalidState('Ownership can only be transferred on active or draft goals.');
    if (g.owner_id === newOwnerId) throw invalid('That person already owns the goal.');
    const u = await tx.one<{ status: string; department_id: string | null; team_id: string | null; full_name: string }>('select status, department_id, team_id, full_name from users where org_id = $1 and id = $2', [ctx.orgId, newOwnerId]);
    if (!u) throw notFound('New owner');
    if (u.status !== 'active') throw invalid('The new owner must be an active user.');
    const dept = g.level === 'individual' ? u.department_id : g.department_id;
    const team = g.level === 'individual' ? u.team_id : g.team_id;
    await tx.exec('update goals set owner_id = $3, department_id = $4, team_id = $5, version = version + 1 where org_id = $1 and id = $2', [ctx.orgId, goalId, newOwnerId, dept, team]);
    await tx.exec('delete from goal_collaborators where org_id = $1 and goal_id = $2 and user_id = $3', [ctx.orgId, goalId, newOwnerId]);
    // keep history: snapshot the new state as a version
    const { snapshotGoal } = await import('./approvals');
    if (g.status === 'active') {
      await tx.exec('update goals set content_version = content_version + 1 where org_id = $1 and id = $2', [ctx.orgId, goalId]);
      await snapshotGoal(tx, ctx, goalId, { summary: `Ownership transferred to ${u.full_name}`, reason: why });
    }
    await audit(tx, ctx, { action: 'goal.owner_transferred', entityType: 'goal', entityId: goalId, before: { ownerId: g.owner_id }, after: { ownerId: newOwnerId }, metadata: { reason: why } });
    for (const uid of new Set([newOwnerId, g.owner_id])) {
      await notify(tx, ctx, { userId: uid, category: 'goals', type: 'goal.owner_transferred', title: `Goal ownership changed: ${g.title}`,
        body: uid === newOwnerId ? `${ctx.userName} made you the owner of "${g.title}".` : `${ctx.userName} transferred "${g.title}" to ${u.full_name}.`,
        link: `/app/goals/${goalId}`, entityType: 'goal', entityId: goalId, dedupeKey: `transfer:${goalId}:${uid}:${g.version}` });
    }
    return { ok: true };
  });
}
