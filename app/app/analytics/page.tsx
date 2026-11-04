import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { requireCtx } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { getAnalytics } from '@/server/services/analytics';
import { listCycles } from '@/server/services/cycles';
import { listStructure } from '@/server/services/structure';
import { PageHeader, Stat } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Empty } from '@/components/ui/empty';
import { RiskPill } from '@/components/status';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CheckinChart, DepartmentChart, PriorityChart, StatusChart, TrendChart } from '@/components/analytics-charts';

export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requireCtx();
  const [cycles, structure] = await Promise.all([listCycles(ctx), listStructure(ctx)]);
  const filters = { cycleId: sp.cycleId || undefined, departmentId: sp.departmentId || undefined, teamId: sp.teamId || undefined, status: sp.status ? sp.status.split(',') : undefined, level: sp.level ? sp.level.split(',') : undefined };
  const a: any = await getAnalytics(ctx, Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)));
  const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v).map(([k, v]) => [k, v as string])).toString();
  const canExport = can(ctx, 'exports.run');
  const wide = a.scope !== 'personal';

  return (
    <div>
      <PageHeader title="Analytics" description={a.cycle ? `${a.cycle.name} · showing ${a.scope === 'organisation' ? 'the whole organisation' : a.scope === 'reporting line' ? 'your reporting line' : 'your own goals'}` : undefined}
        actions={canExport && a.cycle ? <><Button asChild variant="outline"><a href={`/api/v1/exports/goals.csv?${q}`}><Download className="size-4" aria-hidden />Goals CSV</a></Button><Button asChild variant="outline"><a href={`/api/v1/exports/checkins.csv?${q}`}><Download className="size-4" aria-hidden />Check-ins CSV</a></Button><Button asChild variant="outline"><a href={`/api/v1/exports/summary.pdf?${q}`}><FileText className="size-4" aria-hidden />PDF summary</a></Button></> : undefined} />
      <form method="get" className="mb-6 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Analytics filters">
        <Select name="cycleId" defaultValue={a.cycle?.id ?? ''} aria-label="Cycle">{cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="departmentId" defaultValue={sp.departmentId ?? ''} aria-label="Department" disabled={!wide}><option value="">All departments</option>{structure.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select name="teamId" defaultValue={sp.teamId ?? ''} aria-label="Team" disabled={!wide}><option value="">All teams</option>{structure.teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select name="level" defaultValue={sp.level ?? ''} aria-label="Level"><option value="">All levels</option>{['company', 'department', 'team', 'individual'].map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Status"><option value="">All statuses</option>{['active', 'completed', 'pending_approval', 'draft'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
        <div className="flex gap-2"><Button type="submit" className="flex-1">Apply</Button><Button asChild variant="ghost"><Link href="/app/analytics">Reset</Link></Button></div>
      </form>

      {!a.cycle || a.summary.totalGoals === 0 ? <Empty title="Nothing to analyse yet">Once goals are approved and check-ins start, progress, risk and completion metrics appear here. Figures are never estimated.</Empty> : (
        <div className="space-y-6">
          <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Average progress" value={a.summary.averageProgress == null ? '—' : `${a.summary.averageProgress}%`} hint={`${a.summary.goalsWithoutMeasurableProgress} active goals not measurable yet`} />
            <Stat label="Completion rate" value={a.summary.completionRate == null ? '—' : `${a.summary.completionRate}%`} hint="completed ÷ approved goals" />
            <Stat label="At risk · overdue · stalled" value={`${a.summary.atRisk} · ${a.summary.overdue} · ${a.summary.stalled}`} tone={a.summary.overdue ? 'bad' : a.summary.atRisk ? 'warn' : 'good'} />
            <Stat label="Alignment" value={a.alignment.alignmentRate == null ? '—' : `${a.alignment.alignmentRate}%`} hint={`${a.alignment.alignedGoals} aligned · ${a.alignment.unalignedGoals} not yet`} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2"><StatusChart byStatus={a.summary.byStatus} /><DepartmentChart rows={a.byDepartment} /><CheckinChart periods={a.checkins.periods} /><TrendChart periods={a.checkins.periods} /></div>

          <section className="grid gap-4 lg:grid-cols-3" aria-label="Approvals">
            <div className="rounded-xl border border-border bg-card p-4 lg:col-span-1"><h2 className="mb-3 text-sm font-semibold">Approval turnaround</h2>
              {a.approvals.decisions === 0 ? <p className="text-sm text-muted-foreground">No decisions yet.</p> : <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">Average</dt><dd className="tabular-nums">{a.approvals.turnaroundHours.average < 0.1 ? '< 0.1' : a.approvals.turnaroundHours.average} h</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Median</dt><dd className="tabular-nums">{a.approvals.turnaroundHours.median < 0.1 ? '< 0.1' : a.approvals.turnaroundHours.median} h</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">90th percentile</dt><dd className="tabular-nums">{a.approvals.turnaroundHours.p90 < 0.1 ? '< 0.1' : a.approvals.turnaroundHours.p90} h</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Decisions</dt><dd className="tabular-nums">{a.approvals.decisions}</dd></div></dl>}
              <div className="mt-3 border-t border-border pt-3 text-sm"><span className="text-muted-foreground">Pending now:</span> <span className="font-medium">{a.approvals.pending}</span>{a.approvals.pendingOverdue > 0 && <span className="text-destructive"> ({a.approvals.pendingOverdue} overdue)</span>}</div></div>
            <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2"><h2 className="mb-3 text-sm font-semibold">Approver workload</h2>
              {a.approvals.workload.length === 0 ? <p className="text-sm text-muted-foreground">No approvals are waiting.</p> : <ul className="divide-y divide-border text-sm">{a.approvals.workload.map((w: any, i: number) => <li key={i} className="flex justify-between py-2"><span>{w.name}</span><span className="tabular-nums text-muted-foreground">{w.pending} pending{w.overdue ? `, ${w.overdue} overdue` : ''}</span></li>)}</ul>}</div>
          </section>

          {a.byDepartment.length > 0 && wide && (
            <section aria-label="Departments"><h2 className="mb-2 text-sm font-semibold">Departments</h2><div className="table-wrap"><table><caption className="sr-only">Progress by department</caption><thead><tr><th scope="col">Department</th><th scope="col">Goals</th><th scope="col">Active</th><th scope="col">Completed</th><th scope="col" className="min-w-36">Avg progress</th><th scope="col">At risk</th><th scope="col">Overdue</th></tr></thead>
              <tbody>{a.byDepartment.map((d: any) => <tr key={d.id}><td className="font-medium">{d.name}</td><td>{d.goals}</td><td>{d.active}</td><td>{d.completed}</td><td><ProgressBar value={d.averageProgress} /></td><td>{d.atRisk}</td><td>{d.overdue}</td></tr>)}</tbody></table></div></section>
          )}
          {a.byTeam.length > 0 && wide && (
            <section aria-label="Teams"><h2 className="mb-2 text-sm font-semibold">Teams</h2><div className="table-wrap"><table><caption className="sr-only">Progress by team</caption><thead><tr><th scope="col">Team</th><th scope="col">Goals</th><th scope="col">Active</th><th scope="col" className="min-w-36">Avg progress</th><th scope="col">At risk</th><th scope="col">Overdue</th></tr></thead>
              <tbody>{a.byTeam.map((d: any) => <tr key={d.id}><td className="font-medium">{d.name}</td><td>{d.goals}</td><td>{d.active}</td><td><ProgressBar value={d.averageProgress} /></td><td>{d.atRisk}</td><td>{d.overdue}</td></tr>)}</tbody></table></div></section>
          )}

          <div className="grid gap-4 lg:grid-cols-2"><PriorityChart byPriority={a.summary.byPriority} />
            <div className="rounded-xl border border-border bg-card p-4"><h2 className="mb-3 text-sm font-semibold">Alignment by level</h2><ul className="space-y-3 text-sm">{a.alignment.byLevel.map((l: any) => <li key={l.level}><div className="mb-1 flex justify-between"><span className="capitalize">{l.level}</span><span className="text-muted-foreground">{l.aligned} of {l.goals}</span></div><ProgressBar value={l.rate} tone="gold" /></li>)}</ul><p className="mt-3 text-xs text-muted-foreground">Company goals with at least one aligned goal: {a.alignment.companyGoalsWithContribution} of {a.alignment.companyGoals}.</p></div></div>

          {a.attention.length > 0 && (
            <section aria-label="Needs attention"><h2 className="mb-2 text-sm font-semibold">Needs attention</h2><div className="table-wrap"><table><caption className="sr-only">Goals needing attention</caption><thead><tr><th scope="col">Goal</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Progress</th><th scope="col">Signal</th></tr></thead>
              <tbody>{a.attention.map((x: any) => <tr key={x.id}><td className="max-w-xs truncate"><Link href={`/app/goals/${x.id}`} className="font-medium hover:underline">{x.title}</Link></td><td>{x.owner}</td><td className="whitespace-nowrap text-muted-foreground">{x.dueDate}</td><td className="min-w-32"><ProgressBar value={x.progress} /></td><td><RiskPill risk={x.risk} /></td></tr>)}</tbody></table></div></section>
          )}
          <p className="text-xs text-muted-foreground">Progress is the weight-averaged attainment of key results (start → target). Goals without measurable key results are shown as “not measurable”, never as 0%. See the README for every definition.</p>
        </div>
      )}
    </div>
  );
}
