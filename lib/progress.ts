/*
 * Goal progress maths. PURE — shared by the API, the analytics layer and the tests.
 *
 *   key result progress   = how far current has moved from start towards target, 0..100
 *                           (works for both "increase" and "decrease" key results;
 *                            boolean KRs are 0 or 100; no recorded value = 0)
 *   goal "own" progress   = weight-averaged progress of its key results
 *                           (no key results => unknown (null), except a completed goal => 100)
 *   goal "rollup" progress= weight-averaged *effective* progress of its approved,
 *                           non-cancelled child goals (no contributors => null)
 *
 * A parent's progress is always DERIVED; it is never written onto children and a
 * child's own progress never includes anything from its parent.
 */

export interface KrInput {
  start_value: number;
  target_value: number;
  current_value: number | null;
  direction: 'increase' | 'decrease';
  metric_type?: string;
  weight: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
export const round1 = (n: number) => Math.round(n * 10) / 10;

export function keyResultProgress(kr: KrInput): number {
  if (kr.current_value == null) return 0;
  const { start_value: s, target_value: t, current_value: c } = kr;
  if (kr.metric_type === 'boolean') return c >= 1 ? 100 : 0;
  if (t === s) return c >= t ? 100 : 0;
  const pct = kr.direction === 'decrease' ? ((s - c) / (s - t)) * 100 : ((c - s) / (t - s)) * 100;
  return round1(clamp(pct));
}

export function ownProgress(krs: KrInput[], status?: string): number | null {
  if (krs.length === 0) return status === 'completed' ? 100 : null;
  let w = 0, sum = 0;
  for (const kr of krs) { w += kr.weight; sum += kr.weight * keyResultProgress(kr); }
  return w === 0 ? null : round1(sum / w);
}

export interface TreeGoal {
  id: string;
  parent_goal_id: string | null;
  weight: number;
  status: string;
  progress_mode: 'own' | 'rollup';
  own: number | null;
}

export const CONTRIBUTING_STATUSES = new Set(['active', 'completed']);

export interface ProgressResult { own: number | null; effective: number | null; contributors: number }

/** Computes effective progress for every goal in the supplied forest (children outside it are ignored). */
export function computeEffectiveProgress(goals: TreeGoal[]): Map<string, ProgressResult> {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const kids = new Map<string, TreeGoal[]>();
  for (const g of goals) {
    if (g.parent_goal_id && byId.has(g.parent_goal_id)) {
      const arr = kids.get(g.parent_goal_id) ?? [];
      arr.push(g);
      kids.set(g.parent_goal_id, arr);
    }
  }
  const memo = new Map<string, ProgressResult>();
  const visiting = new Set<string>();
  const calc = (g: TreeGoal): ProgressResult => {
    const hit = memo.get(g.id);
    if (hit) return hit;
    if (visiting.has(g.id)) return { own: g.own, effective: g.own, contributors: 0 }; // defensive: never loop
    visiting.add(g.id);
    let res: ProgressResult;
    if (g.progress_mode === 'rollup') {
      let w = 0, sum = 0, n = 0;
      for (const c of kids.get(g.id) ?? []) {
        if (!CONTRIBUTING_STATUSES.has(c.status)) continue;
        const cp = calc(c).effective;
        if (cp == null) continue;
        w += c.weight; sum += c.weight * cp; n++;
      }
      res = { own: g.own, effective: w > 0 ? round1(sum / w) : null, contributors: n };
    } else {
      res = { own: g.own, effective: g.own, contributors: 0 };
    }
    visiting.delete(g.id);
    memo.set(g.id, res);
    return res;
  };
  for (const g of goals) calc(g);
  return memo;
}

/** Linear expectation: where should a goal be today given its dates? null when undated. */
export function expectedProgress(start: string | null, due: string | null, today = new Date()): number | null {
  if (!start || !due) return null;
  const s = Date.parse(start), d = Date.parse(due), t = today.getTime();
  if (d <= s) return null;
  return round1(clamp(((t - s) / (d - s)) * 100));
}

export type RiskLevel = 'on_track' | 'at_risk' | 'overdue' | 'stalled' | 'unknown' | 'done';
export interface RiskInput {
  status: string; start_date: string | null; due_date: string | null;
  progress: number | null; last_activity_at: string | null; latest_health?: string | null;
}
/**
 * Risk classification used by dashboards (documented in the README):
 *   overdue  – active and past its due date
 *   at_risk  – latest check-in says at_risk/off_track, OR progress trails the linear expectation by more than tolerance
 *   stalled  – active, no progress or check-in activity for `stalledAfterDays`
 *   unknown  – active with nothing measurable yet
 */
export function classifyRisk(g: RiskInput, opts: { tolerance: number; stalledAfterDays: number; today?: Date }): RiskLevel {
  const today = opts.today ?? new Date();
  if (g.status === 'completed' || g.status === 'cancelled') return 'done';
  if (g.status !== 'active') return 'unknown';
  if (g.due_date && Date.parse(g.due_date) + 86_400_000 <= today.getTime()) return 'overdue';
  if (g.latest_health === 'at_risk' || g.latest_health === 'off_track') return 'at_risk';
  const exp = expectedProgress(g.start_date, g.due_date, today);
  if (exp != null && g.progress != null && g.progress < exp - opts.tolerance) return 'at_risk';
  if (g.last_activity_at && today.getTime() - Date.parse(g.last_activity_at) > opts.stalledAfterDays * 86_400_000) return 'stalled';
  if (g.progress == null) return 'unknown';
  return 'on_track';
}
