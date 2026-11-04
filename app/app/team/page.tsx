import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireCtx } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { myTeam } from '@/server/services/users';
import { listTeamCheckins } from '@/server/services/checkins';
import { listApprovalQueue } from '@/server/services/approvals';
import { managerWorkload } from '@/server/services/analytics';
import { PageHeader, Stat } from '@/components/page-header';
import { Empty } from '@/components/ui/empty';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CheckinStatePill, HealthPill } from '@/components/status';
import { fmtDate } from '@/lib/utils';

export const metadata = { title: 'My team' };

export default async function TeamPage({ searchParams }: { searchParams: { state?: string } }) {
  const ctx = await requireCtx();
  if (!can(ctx, 'goals.approve') && !can(ctx, 'checkins.review') && !can(ctx, 'goals.read_reports') && !can(ctx, 'goals.read_org')) redirect('/app?denied=1');
  const [team, checkins, approvals, load] = await Promise.all([
    myTeam(ctx), listTeamCheckins(ctx, { state: searchParams.state || undefined }).catch(() => []), listApprovalQueue(ctx).catch(() => []), managerWorkload(ctx).catch(() => null),
  ]);
  return (
    <div>
      <PageHeader title="My team" description="Everyone in your reporting line: where their goals stand and what needs your attention." />
      {load && <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Direct reports" value={load.directReports} />
        <Stat label="Approvals pending" value={load.pendingApprovals} tone={load.overdueApprovals ? 'warn' : undefined} hint={load.overdueApprovals ? `${load.overdueApprovals} overdue` : undefined} />
        <Stat label="Check-ins to review" value={load.checkinsToReview} />
        <Stat label="Overdue check-ins" value={load.overdueCheckins} tone={load.overdueCheckins ? 'bad' : 'good'} />
      </div>}
      {approvals.length > 0 && <div className="mb-6 rounded-xl border border-[hsl(var(--gold))]/40 bg-[hsl(var(--gold))]/5 p-4 text-sm">{approvals.length} goal{approvals.length > 1 ? 's are' : ' is'} waiting for your approval. <Link href="/app/approvals" className="font-medium underline underline-offset-4">Review now</Link></div>}
      <h2 className="mb-3 text-base font-semibold">People</h2>
      {team.length === 0 ? <Empty title="No one reports to you yet">People assigned to you as their manager appear here.</Empty> : (
        <div className="table-wrap mb-10"><table><caption className="sr-only">Team members</caption><thead><tr><th scope="col">Person</th><th scope="col">Active goals</th><th scope="col">Awaiting approval</th><th scope="col">Drafts</th></tr></thead>
          <tbody>{team.map((m: any) => <tr key={m.id}><td><div className="font-medium">{m.full_name}</div><div className="text-xs text-muted-foreground">{m.job_title}{m.direct_report ? '' : ' · indirect report'}</div></td><td className="tabular-nums">{m.active_goals}</td><td className="tabular-nums">{m.pending_goals ? <Link href="/app/approvals" className="font-medium underline">{m.pending_goals}</Link> : 0}</td><td className="tabular-nums">{m.draft_goals}</td></tr>)}</tbody></table></div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Team check-ins</h2>
        <form method="get" className="flex gap-2"><Select name="state" defaultValue={searchParams.state ?? ''} aria-label="Filter by state" className="w-44"><option value="">All states</option><option value="overdue">Overdue</option><option value="due">Due</option><option value="submitted">Submitted</option><option value="reopened">Needs correction</option></Select><Button type="submit" variant="outline">Filter</Button></form></div>
      {checkins.length === 0 ? <Empty title="No check-ins to show">Check-ins appear once a review period opens.</Empty> : (
        <div className="table-wrap"><table><caption className="sr-only">Team check-ins</caption><thead><tr><th scope="col">Person</th><th scope="col">Goal</th><th scope="col">Period</th><th scope="col">Due</th><th scope="col">State</th><th scope="col">Health</th></tr></thead>
          <tbody>{checkins.map((c: any) => <tr key={c.goal_id + c.period_id}><td className="whitespace-nowrap">{c.owner_name}</td><td className="max-w-xs truncate"><Link href={`/app/checkins/${c.goal_id}/${c.period_id}`} className="font-medium hover:underline">{c.title}</Link></td><td>{c.period_name}</td><td className="whitespace-nowrap text-muted-foreground">{fmtDate(c.due_on)}</td><td><CheckinStatePill state={c.state} />{c.is_late && <span className="ml-1.5 text-xs text-[hsl(var(--warning))]">late</span>}</td><td><HealthPill health={c.health} /></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
