import Link from 'next/link';
import { ArrowRight, CheckCircle2, ClipboardCheck, Plus, Target, UsersRound } from 'lucide-react';
import { requireCtx } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { listGoals } from '@/server/services/goals';
import { listApprovalQueue } from '@/server/services/approvals';
import { listMyCheckins, todayUtc } from '@/server/services/checkins';
import { listActionItems } from '@/server/services/checkins';
import { getAnalytics, managerWorkload } from '@/server/services/analytics';
import { listCycles } from '@/server/services/cycles';
import { PageHeader, Stat } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GoalStatusPill, RiskPill, CheckinStatePill } from '@/components/status';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Empty } from '@/components/ui/empty';
import { fmtDate } from '@/lib/utils';

export const metadata = { title: 'Home' };

export default async function Home({ searchParams }: { searchParams: { denied?: string } }) {
  const ctx = await requireCtx();
  const [mine, queue, checkins, actions, cycles] = await Promise.all([
    listGoals(ctx, { mine: true, limit: 100, sort: 'due', order: 'asc' }),
    listApprovalQueue(ctx).catch(() => []),
    listMyCheckins(ctx),
    listActionItems(ctx, { status: 'open' }),
    listCycles(ctx),
  ]);
  const isManager = can(ctx, 'goals.approve') || can(ctx, 'checkins.review');
  const [workload, org] = await Promise.all([
    isManager ? managerWorkload(ctx).catch(() => null) : null,
    can(ctx, 'analytics.read_org') ? getAnalytics(ctx, {}).catch(() => null) as Promise<any> : null,
  ]);

  const goals = mine.data.filter((g: any) => g.owner_id === ctx.userId);
  const by = (s: string) => goals.filter((g: any) => g.status === s);
  const active = by('active');
  const measured = active.filter((g: any) => g.progress != null);
  const avg = measured.length ? Math.round(measured.reduce((a: number, g: any) => a + g.progress, 0) / measured.length) : null;
  const dueCheckins = checkins.flatMap((p: any) => p.items.filter((i: any) => ['due', 'overdue', 'reopened'].includes(i.state)).map((i: any) => ({ ...i, period: p.name, periodId: p.id })));
  const needsAction = [...by('changes_requested'), ...by('rejected'), ...by('draft')];
  const atRisk = active.filter((g: any) => ['overdue', 'at_risk', 'stalled'].includes(g.risk));
  const cycle = cycles.find((c: any) => c.status === 'active');
  const first = ctx.userName.split(' ')[0];

  return (
    <div>
      {searchParams.denied && <div role="status" className="mb-4 rounded-lg border border-border bg-accent px-4 py-2.5 text-sm">You don&apos;t have access to that page.</div>}
      <PageHeader eyebrow={cycle ? `${cycle.name} · ${fmtDate(todayUtc())}` : undefined} title={`Hello, ${first}`}
        description={goals.length ? 'Here is where your goals stand and what needs you today.' : 'Welcome to Plumeo. Start by drafting your first goal.'}
        actions={<Button asChild><Link href="/app/goals/new"><Plus className="size-4" aria-hidden />New goal</Link></Button>} />

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active goals" value={active.length} hint={`${by('pending_approval').length} awaiting approval`} />
        <Stat label="Average progress" value={avg == null ? '—' : `${avg}%`} hint={avg == null ? 'Add key results to measure progress' : `across ${measured.length} measurable goals`} />
        <Stat label="Check-ins to do" value={dueCheckins.length} tone={dueCheckins.some((c: any) => c.state === 'overdue') ? 'bad' : undefined} hint={dueCheckins.filter((c: any) => c.state === 'overdue').length ? `${dueCheckins.filter((c: any) => c.state === 'overdue').length} overdue` : 'None overdue'} />
        <Stat label="Waiting on you" value={queue.length} hint={queue.length ? 'Approvals to decide' : 'Nothing to approve'} tone={queue.some((q: any) => q.overdue) ? 'warn' : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle>Needs your attention</CardTitle></CardHeader>
            <CardContent>
              {needsAction.length + dueCheckins.length + atRisk.length + actions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up. 🎉</p>
              ) : (
                <ul className="divide-y divide-border">
                  {needsAction.map((g: any) => (
                    <li key={g.id}><Link href={`/app/goals/${g.id}`} className="flex items-center gap-3 py-3 hover:opacity-80"><Target className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm">{g.title}</span><GoalStatusPill status={g.status} /></Link></li>
                  ))}
                  {dueCheckins.map((c: any) => (
                    <li key={c.goal_id + c.periodId}><Link href={`/app/checkins/${c.goal_id}/${c.periodId}`} className="flex items-center gap-3 py-3 hover:opacity-80"><ClipboardCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm">{c.period} check-in · {c.title}</span><CheckinStatePill state={c.state} /></Link></li>
                  ))}
                  {atRisk.map((g: any) => (
                    <li key={g.id}><Link href={`/app/goals/${g.id}`} className="flex items-center gap-3 py-3 hover:opacity-80"><Target className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm">{g.title}</span><RiskPill risk={g.risk} /></Link></li>
                  ))}
                  {actions.map((a: any) => (
                    <li key={a.id}><Link href={`/app/goals/${a.goal_id}`} className="flex items-center gap-3 py-3 hover:opacity-80"><CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm">{a.title}</span><span className="text-xs text-muted-foreground">{a.due_date ? `Due ${fmtDate(a.due_date)}` : 'Follow-up'}</span></Link></li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle>My active goals</CardTitle><Link href="/app/goals?mine=true" className="text-xs text-muted-foreground hover:text-foreground">View all <ArrowRight className="inline size-3" aria-hidden /></Link></CardHeader>
            <CardContent>
              {active.length === 0 ? <Empty title="No active goals yet" action={<Button asChild size="sm"><Link href="/app/goals/new">Draft a goal</Link></Button>}>Goals become active once your manager approves them.</Empty> : (
                <ul className="space-y-4">{active.slice(0, 6).map((g: any) => (
                  <li key={g.id}><div className="mb-1.5 flex items-center justify-between gap-3"><Link href={`/app/goals/${g.id}`} className="truncate text-sm font-medium hover:underline">{g.title}</Link><RiskPill risk={g.risk} /></div><ProgressBar value={g.progress} label={g.title} /></li>
                ))}</ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {queue.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle>Approvals waiting</CardTitle><Link href="/app/approvals" className="text-xs text-muted-foreground hover:text-foreground">Open queue</Link></CardHeader>
              <CardContent><ul className="divide-y divide-border">{queue.slice(0, 4).map((q: any) => (
                <li key={q.id} className="py-2.5"><Link href="/app/approvals" className="block"><div className="truncate text-sm font-medium">{q.title}</div><div className="text-xs text-muted-foreground">{q.owner_name}{q.overdue ? ' · overdue' : ''}</div></Link></li>
              ))}</ul></CardContent>
            </Card>
          )}
          {workload && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-[hsl(var(--gold))]" aria-hidden />My team</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-2xl font-semibold tabular-nums">{workload.directReports}</div><div className="text-xs text-muted-foreground">direct reports</div></div>
                <div><div className="text-2xl font-semibold tabular-nums">{workload.pendingApprovals}</div><div className="text-xs text-muted-foreground">approvals pending</div></div>
                <div><div className="text-2xl font-semibold tabular-nums">{workload.checkinsToReview}</div><div className="text-xs text-muted-foreground">check-ins to review</div></div>
                <div><div className={`text-2xl font-semibold tabular-nums ${workload.overdueCheckins ? 'text-destructive' : ''}`}>{workload.overdueCheckins}</div><div className="text-xs text-muted-foreground">overdue check-ins</div></div>
                <Link href="/app/team" className="col-span-2 text-xs text-muted-foreground hover:text-foreground">Open team view <ArrowRight className="inline size-3" aria-hidden /></Link>
              </CardContent>
            </Card>
          )}
          {org?.summary && (
            <Card>
              <CardHeader className="pb-3"><CardTitle>Organisation pulse</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Average progress</span><span className="font-medium tabular-nums">{org.summary.averageProgress ?? '—'}{org.summary.averageProgress != null ? '%' : ''}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">At risk / overdue</span><span className="font-medium tabular-nums">{org.summary.atRisk} / {org.summary.overdue}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Approvals pending</span><span className="font-medium tabular-nums">{org.approvals.pending}{org.approvals.pendingOverdue ? ` (${org.approvals.pendingOverdue} overdue)` : ''}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Goals aligned</span><span className="font-medium tabular-nums">{org.alignment.alignmentRate ?? '—'}{org.alignment.alignmentRate != null ? '%' : ''}</span></div>
                <Link href="/app/analytics" className="block pt-1 text-xs text-muted-foreground hover:text-foreground">Open analytics <ArrowRight className="inline size-3" aria-hidden /></Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
