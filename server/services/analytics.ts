import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, can, requirePerm } from '../core/context';
import { forbidden } from '../core/errors';
import { parse, uuid } from '../core/validation';
import { resolvePolicy } from '@/lib/policy';
import { round1 } from '@/lib/progress';
import { scopeOwnerPredicate } from './goal-access';
import { loadProgress, riskFor } from './progress';
import { EXPECTED_CHECKINS_SQL, todayUtc } from './checkins';

export const analyticsFilters = z.object({
  cycleId: uuid.optional(), departmentId: uuid.optional(), teamId: uuid.optional(), ownerId: uuid.optional(), periodId: uuid.optional(),
  status: z.array(z.string()).optional(), level: z.array(z.string()).optional(), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export type AnalyticsFilters = z.infer<typeof analyticsFilters>;

const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const pct = (n: number, d: number) => (d === 0 ? null : round1((n / d) * 100));
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const percentile = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

async function resolveCycle(tx: Tx, ctx: Ctx, cycleId?: string) {
  if (cycleId) return tx.one<any>('select id, name from cycles where org_id = $1 and id = $2', [ctx.orgId, cycleId]);
  return tx.one<any>(`select id, name from cycles where org_id = $1 order by (status = 'active') desc, starts_on desc limit 1`, [ctx.orgId]);
}

export function assertAnalyticsAccess(ctx: Ctx) {
  // Everyone may see their own progress; org-wide / scoped views need the matching permission (enforced via scopeOwnerPredicate).
  if (!ctx.userId) throw forbidden();
}

/**
 * Organisation / department / team / individual analytics. Every query is restricted by
 * `scopeOwnerPredicate`, so a manager only ever aggregates their own reporting line,
 * a department head their departments, and HR/auditors the whole organisation.
 * Definitions of each metric are documented in README.md ("Metric definitions").
 */
export async function getAnalytics(ctx: Ctx, rawFilters: unknown) {
  assertAnalyticsAccess(ctx);
  const f = parse(analyticsFilters, rawFilters ?? {});
  const asOf = f.asOf ?? todayUtc();
  return withOrg(ctx.orgId, async (tx) => {
    const policy = resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [ctx.orgId]))?.settings);
    const cycle = await resolveCycle(tx, ctx, f.cycleId);
    if (!cycle) return { cycle: null, empty: true };
    const params: unknown[] = [ctx.orgId, cycle.id];
    const scope = scopeOwnerPredicate(ctx, params, 'g.owner_id');
    const w = ['g.org_id = $1', 'g.cycle_id = $2', 'g.deleted_at is null', scope];
    if (f.departmentId) { params.push(f.departmentId); w.push(`ou.department_id in (select department_descendants($1, $${params.length}))`); }
    if (f.teamId) { params.push(f.teamId); w.push(`ou.team_id in (select tt.id from teams tt where tt.org_id = $1 and $${params.length} in (select team_ancestors($1, tt.id)))`); }
    if (f.ownerId) { params.push(f.ownerId); w.push(`g.owner_id = $${params.length}`); }
    if (f.status?.length) { params.push(f.status); w.push(`g.status = any($${params.length}::text[])`); }
    if (f.level?.length) { params.push(f.level); w.push(`g.level = any($${params.length}::text[])`); }
    const goals = await tx.query<any>(
      `select g.id, g.title, g.level, g.status, g.priority, g.owner_id, g.parent_goal_id, g.start_date, g.due_date, g.approved_at, ou.full_name as owner_name,
              ou.department_id as owner_department_id, d.name as department_name, ou.team_id as owner_team_id, t.name as team_name
       from goals g join users ou on ou.org_id = g.org_id and ou.id = g.owner_id
       left join departments d on d.org_id = ou.org_id and d.id = ou.department_id left join teams t on t.org_id = ou.org_id and t.id = ou.team_id
       where ${w.join(' and ')} limit 20000`, params);
    const prog = await loadProgress(tx, ctx.orgId, goals.map((g) => g.id));
    const today = new Date(asOf + 'T12:00:00Z');
    const rows = goals.map((g) => {
      const p = prog.get(g.id);
      return { ...g, progress: p?.effective ?? null, risk: riskFor(g, p, policy, today) };
    });

    const count = (key: string, list = rows) => Object.fromEntries(Object.entries(list.reduce<Record<string, number>>((m, r) => { m[r[key]] = (m[r[key]] ?? 0) + 1; return m; }, {})));
    const active = rows.filter((r) => r.status === 'active');
    const approved = rows.filter((r) => ['active', 'completed'].includes(r.status));
    const measured = active.filter((r) => r.progress != null).map((r) => r.progress as number);
    const summary = {
      totalGoals: rows.length,
      byStatus: count('status'), byPriority: count('priority'), byLevel: count('level'),
      completionRate: pct(rows.filter((r) => r.status === 'completed').length, approved.length),
      averageProgress: avg(measured), goalsWithoutMeasurableProgress: active.length - measured.length,
      risk: count('risk', active),
      overdue: active.filter((r) => r.risk === 'overdue').length,
      atRisk: active.filter((r) => r.risk === 'at_risk').length,
      stalled: active.filter((r) => r.risk === 'stalled').length,
    };

    const group = (keyOf: (r: any) => [string, string] | null) => {
      const m = new Map<string, { id: string; name: string; rows: any[] }>();
      for (const r of rows) { const k = keyOf(r); if (!k) continue; const e = m.get(k[0]) ?? { id: k[0], name: k[1], rows: [] }; e.rows.push(r); m.set(k[0], e); }
      return [...m.values()].map((e) => {
        const act = e.rows.filter((r) => r.status === 'active');
        const done = e.rows.filter((r) => r.status === 'completed');
        const ms = act.filter((r) => r.progress != null).map((r) => r.progress as number);
        return { id: e.id, name: e.name, goals: e.rows.length, active: act.length, completed: done.length, averageProgress: avg(ms),
          atRisk: act.filter((r) => r.risk === 'at_risk').length, overdue: act.filter((r) => r.risk === 'overdue').length, stalled: act.filter((r) => r.risk === 'stalled').length };
      }).sort((a, b) => a.name.localeCompare(b.name));
    };
    const byDepartment = group((r) => (r.owner_department_id ? [r.owner_department_id, r.department_name] : null));
    const byTeam = group((r) => (r.owner_team_id ? [r.owner_team_id, r.team_name] : null));
    const byOwner = group((r) => [r.owner_id, r.owner_name]).sort((a, b) => (a.averageProgress ?? 101) - (b.averageProgress ?? 101)).slice(0, 200);

    // ---- approvals ----
    const apParams: unknown[] = [ctx.orgId, cycle.id];
    const apScope = scopeOwnerPredicate(ctx, apParams, 'g.owner_id');
    const approvals = await tx.query<any>(
      `select ar.status, ar.approver_id, ap.full_name as approver_name, extract(epoch from (ar.decided_at - coalesce(ar.activated_at, ar.requested_at))) / 3600.0 as hours, (ar.due_at < ${'$' + (apParams.length + 1)}::date + 1 and ar.status = 'pending') as overdue
       from approval_requests ar join goals g on g.org_id = ar.org_id and g.id = ar.goal_id left join users ap on ap.org_id = ar.org_id and ap.id = ar.approver_id
       where ar.org_id = $1 and g.cycle_id = $2 and ${apScope} and ar.status in ('approved','rejected','changes_requested','pending')`, [...apParams, asOf]);
    const decided = approvals.filter((a) => a.status !== 'pending' && a.hours != null).map((a) => Number(a.hours));
    const pendingByApprover = new Map<string, { name: string; pending: number; overdue: number }>();
    for (const a of approvals.filter((x) => x.status === 'pending')) {
      const k = a.approver_id ?? 'pool';
      const e = pendingByApprover.get(k) ?? { name: a.approver_name ?? 'Approver pool', pending: 0, overdue: 0 };
      e.pending++; if (a.overdue) e.overdue++;
      pendingByApprover.set(k, e);
    }
    const approvalStats = {
      decisions: decided.length, pending: approvals.filter((a) => a.status === 'pending').length,
      pendingOverdue: approvals.filter((a) => a.overdue).length,
      turnaroundHours: { average: avg(decided), median: median(decided) == null ? null : round1(median(decided)!), p90: percentile(decided, 0.9) == null ? null : round1(percentile(decided, 0.9)!) },
      outcomes: count('status', approvals.filter((a) => a.status !== 'pending') as any),
      workload: [...pendingByApprover.values()].sort((a, b) => b.pending - a.pending).slice(0, 20),
    };

    // ---- check-ins ----
    const ciParams: unknown[] = [ctx.orgId, asOf];
    const ciScope = scopeOwnerPredicate(ctx, ciParams, 'e.owner_id');
    ciParams.push(cycle.id);
    const ciW = [ciScope, `e.state <> 'upcoming'`, `e.period_id in (select id from review_periods where org_id = $1 and cycle_id = $${ciParams.length})`];
    if (f.departmentId) { ciParams.push(f.departmentId); ciW.push(`e.owner_id in (select id from users where org_id = $1 and department_id in (select department_descendants($1, $${ciParams.length})))`); }
    if (f.ownerId) { ciParams.push(f.ownerId); ciW.push(`e.owner_id = $${ciParams.length}`); }
    const checkins = await tx.query<any>(
      `with e as (${EXPECTED_CHECKINS_SQL}) select e.period_id, e.period_name, e.sequence, e.state, e.is_late, e.health, e.progress_snapshot
       from e where ${ciW.join(' and ')}`, ciParams);
    const periods = new Map<string, any>();
    for (const c of checkins) {
      const p = periods.get(c.period_id) ?? { periodId: c.period_id, name: c.period_name, sequence: c.sequence, expected: 0, submitted: 0, onTime: 0, late: 0, missing: 0, snapshots: [] as number[], health: { on_track: 0, at_risk: 0, off_track: 0, completed: 0 } };
      p.expected++;
      if (c.state === 'submitted') {
        p.submitted++; c.is_late ? p.late++ : p.onTime++;
        if (c.progress_snapshot != null) p.snapshots.push(Number(c.progress_snapshot));
        if (c.health) p.health[c.health as keyof typeof p.health]++;
      } else if (c.state === 'overdue') p.missing++;
      periods.set(c.period_id, p);
    }
    const trend = [...periods.values()].sort((a, b) => a.sequence - b.sequence).map((p, i, arr) => {
      const averageProgress = avg(p.snapshots);
      const prev = i > 0 ? arr[i - 1] : null;
      const prevAvg = prev ? avg(prev.snapshots) : null;
      return {
        periodId: p.periodId, name: p.name, expected: p.expected, submitted: p.submitted, onTime: p.onTime, late: p.late, missing: p.missing,
        completionRate: pct(p.submitted, p.expected), onTimeRate: pct(p.onTime, p.expected), averageProgress, health: p.health,
        deltaVsPrevious: averageProgress != null && prevAvg != null ? round1(averageProgress - prevAvg) : null,
      };
    });

    // ---- alignment ----
    const nonCompany = rows.filter((r) => r.level !== 'company' && ['active', 'completed', 'pending_approval'].includes(r.status));
    const aligned = nonCompany.filter((r) => r.parent_goal_id);
    const companyGoals = rows.filter((r) => r.level === 'company' && r.status === 'active');
    const parentIds = new Set(rows.map((r) => r.parent_goal_id).filter(Boolean));
    const alignment = {
      alignedGoals: aligned.length, unalignedGoals: nonCompany.length - aligned.length, alignmentRate: pct(aligned.length, nonCompany.length),
      byLevel: ['department', 'team', 'individual'].map((lv) => { const l = nonCompany.filter((r) => r.level === lv); return { level: lv, goals: l.length, aligned: l.filter((r) => r.parent_goal_id).length, rate: pct(l.filter((r) => r.parent_goal_id).length, l.length) }; }),
      companyGoalsWithContribution: companyGoals.filter((r) => parentIds.has(r.id)).length, companyGoals: companyGoals.length,
    };

    // ---- attention list ----
    const attention = active.filter((r) => ['overdue', 'at_risk', 'stalled'].includes(r.risk))
      .sort((a, b) => ({ overdue: 0, at_risk: 1, stalled: 2 } as any)[a.risk] - ({ overdue: 0, at_risk: 1, stalled: 2 } as any)[b.risk] || String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 25).map((r) => ({ id: r.id, title: r.title, owner: r.owner_name, risk: r.risk, progress: r.progress, dueDate: r.due_date, level: r.level }));

    return {
      cycle: { id: cycle.id, name: cycle.name }, asOf, scope: can(ctx, 'analytics.read_org') || can(ctx, 'goals.read_org') ? 'organisation' : can(ctx, 'analytics.read_scope') || can(ctx, 'goals.read_department') ? 'reporting line' : 'personal',
      summary, byDepartment, byTeam, byOwner, approvals: approvalStats, checkins: { periods: trend }, alignment, attention,
    };
  });
}

/** Manager workload: pending approvals, due check-ins and drafts across the caller's reporting line. */
export async function managerWorkload(ctx: Ctx, asOf = todayUtc()) {
  requirePerm(ctx, 'goals.approve', 'checkins.review', 'goals.approve_any');
  return withOrg(ctx.orgId, async (tx) => {
    const pendingApprovals = await tx.one<{ n: number; overdue: number }>(
      `select count(*)::int as n, count(*) filter (where ar.due_at < now())::int as overdue from approval_requests ar join goals g on g.org_id = ar.org_id and g.id = ar.goal_id
       where ar.org_id = $1 and ar.status = 'pending' and g.owner_id <> $2 and (ar.approver_id = $2 or ar.approver_id in (select ad.delegator_id from approval_delegations ad where ad.org_id = ar.org_id and ad.delegate_id = $2 and ad.revoked_at is null and now() between ad.starts_at and ad.ends_at))`, [ctx.orgId, ctx.userId]);
    const ci = await tx.one<{ to_review: number; overdue: number }>(
      `with e as (${EXPECTED_CHECKINS_SQL}) select count(*) filter (where state = 'submitted' and checkin_status = 'submitted')::int as to_review, count(*) filter (where state = 'overdue')::int as overdue
       from e where owner_id in (select reporting_subtree($1, $3))`, [ctx.orgId, asOf, ctx.userId]);
    const reports = await tx.one<{ n: number }>('select count(*)::int as n from users where org_id = $1 and manager_id = $2 and status = $3', [ctx.orgId, ctx.userId, 'active']);
    return { directReports: reports!.n, pendingApprovals: pendingApprovals!.n, overdueApprovals: pendingApprovals!.overdue, checkinsToReview: ci!.to_review, overdueCheckins: ci!.overdue };
  });
}
