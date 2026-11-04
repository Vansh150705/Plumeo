import type { Tx } from '../db/pool';
import { classifyRisk, computeEffectiveProgress, keyResultProgress, ownProgress, type KrInput, type ProgressResult, type RiskLevel } from '@/lib/progress';
import type { OrgPolicy } from '@/lib/policy';

export interface KrRow {
  id: string; goal_id: string; title: string; metric_type: string; direction: 'increase' | 'decrease'; unit: string | null;
  start_value: number; target_value: number; current_value: number | null; weight: number; position: number;
}

export const withKrProgress = <T extends KrRow>(k: T) => ({ ...k, progress: keyResultProgress(k as unknown as KrInput) });

export interface GoalProgress extends ProgressResult {
  last_activity_at: string | null;
  latest_health: string | null;
}

/**
 * Loads progress for the given goals (and, transitively, every descendant they roll up from).
 * Own progress is derived from key results; rollup goals derive from approved child goals.
 * Nothing here ever writes to a goal: derived values cannot overwrite anyone's data.
 */
export async function loadProgress(tx: Tx, orgId: string, goalIds: string[]): Promise<Map<string, GoalProgress>> {
  const out = new Map<string, GoalProgress>();
  if (goalIds.length === 0) return out;
  const goals = await tx.query<{ id: string; parent_goal_id: string | null; weight: number; status: string; progress_mode: 'own' | 'rollup' }>(
    `with recursive d as (
       select id from goals where org_id = $1 and id = any($2::uuid[]) and deleted_at is null
       union
       select c.id from goals c join d on c.parent_goal_id = d.id where c.org_id = $1 and c.deleted_at is null)
     select g.id, g.parent_goal_id, g.weight, g.status, g.progress_mode from goals g where g.org_id = $1 and g.id in (select id from d)`, [orgId, goalIds]);
  const ids = goals.map((g) => g.id);
  const krs = await tx.query<KrRow>(
    `select id, goal_id, title, metric_type, direction, unit, start_value, target_value, current_value, weight, position
     from key_results where org_id = $1 and goal_id = any($2::uuid[]) and removed_at is null`, [orgId, ids]);
  const byGoal = new Map<string, KrRow[]>();
  for (const k of krs) { const a = byGoal.get(k.goal_id) ?? []; a.push(k); byGoal.set(k.goal_id, a); }
  const computed = computeEffectiveProgress(goals.map((g) => ({
    ...g, own: ownProgress((byGoal.get(g.id) ?? []) as unknown as KrInput[], g.status),
  })));
  const act = await tx.query<{ goal_id: string; at: string }>(
    `select goal_id, max(at) as at from (
       select goal_id, created_at as at from progress_updates where org_id = $1 and goal_id = any($2::uuid[])
       union all select goal_id, submitted_at from checkins where org_id = $1 and goal_id = any($2::uuid[]) and submitted_at is not null) x group by goal_id`, [orgId, goalIds]);
  const health = await tx.query<{ goal_id: string; health: string }>(
    `select distinct on (c.goal_id) c.goal_id, c.health from checkins c join review_periods p on p.org_id = c.org_id and p.id = c.period_id
     where c.org_id = $1 and c.goal_id = any($2::uuid[]) and c.health is not null order by c.goal_id, p.sequence desc, c.submitted_at desc`, [orgId, goalIds]);
  for (const id of goalIds) {
    const r = computed.get(id);
    out.set(id, {
      own: r?.own ?? null, effective: r?.effective ?? null, contributors: r?.contributors ?? 0,
      last_activity_at: act.find((a) => a.goal_id === id)?.at ?? null,
      latest_health: health.find((h) => h.goal_id === id)?.health ?? null,
    });
  }
  return out;
}

export function riskFor(g: { status: string; start_date: string | null; due_date: string | null }, p: GoalProgress | undefined, policy: OrgPolicy, today = new Date()): RiskLevel {
  return classifyRisk(
    { status: g.status, start_date: g.start_date, due_date: g.due_date, progress: p?.effective ?? null, last_activity_at: p?.last_activity_at ?? null, latest_health: p?.latest_health },
    { tolerance: policy.risk.atRiskTolerancePoints, stalledAfterDays: policy.risk.stalledAfterDays, today });
}
