import Link from 'next/link';
import { Download, Plus } from 'lucide-react';
import { requireCtx } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { listGoals } from '@/server/services/goals';
import { listCycles } from '@/server/services/cycles';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Empty } from '@/components/ui/empty';
import { GoalStatusPill, LevelPill, PriorityPill, RiskPill } from '@/components/status';
import { ProgressBar } from '@/components/ui/progress-bar';
import { fmtDate } from '@/lib/utils';

export const metadata = { title: 'Goals' };
const PAGE = 25;

export default async function GoalsPage({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requireCtx();
  const cycles = await listCycles(ctx);
  const cycleId = sp.cycleId ?? (cycles.find((c: any) => c.status === 'active') ?? cycles[0])?.id;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const csv = (v?: string) => (v ? v.split(',') : undefined);
  const scope = sp.scope === 'all' ? 'all' : 'mine';
  const res = await listGoals(ctx, { cycleId, level: csv(sp.level), status: csv(sp.status), priority: csv(sp.priority), risk: csv(sp.risk), q: sp.q, mine: scope === 'mine', sort: sp.sort ?? 'updated', order: (sp.order as any) ?? 'desc', limit: PAGE, offset });
  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return `?${p.toString()}`;
  };
  const exportHref = `/api/v1/exports/goals.csv?${new URLSearchParams({ ...(cycleId ? { cycleId } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.level ? { level: sp.level } : {}) })}`;

  return (
    <div>
      <PageHeader title="Goals" description={scope === 'mine' ? 'Goals you own or contribute to.' : 'Every goal you are allowed to see, across the organisation.'}
        actions={<>{can(ctx, 'exports.run') && <Button asChild variant="outline"><a href={exportHref}><Download className="size-4" aria-hidden />Export CSV</a></Button>}<Button asChild><Link href="/app/goals/new"><Plus className="size-4" aria-hidden />New goal</Link></Button></>} />
      <form method="get" className="mb-4 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filter goals">
        <Input name="q" defaultValue={sp.q} placeholder="Search title or description" aria-label="Search" className="lg:col-span-2" />
        <Select name="scope" defaultValue={scope} aria-label="Scope"><option value="mine">My goals</option><option value="all">Everything I can see</option></Select>
        <Select name="cycleId" defaultValue={cycleId} aria-label="Cycle">{cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="level" defaultValue={sp.level ?? ''} aria-label="Level"><option value="">All levels</option>{['company', 'department', 'team', 'individual'].map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Status"><option value="">All statuses</option>{[['draft', 'Draft'], ['pending_approval', 'Awaiting approval'], ['changes_requested', 'Changes requested'], ['rejected', 'Rejected'], ['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Select name="risk" defaultValue={sp.risk ?? ''} aria-label="Risk"><option value="">Any risk</option>{[['on_track', 'On track'], ['at_risk', 'At risk'], ['overdue', 'Overdue'], ['stalled', 'Stalled']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Select name="sort" defaultValue={sp.sort ?? 'updated'} aria-label="Sort by"><option value="updated">Recently updated</option><option value="due">Due date</option><option value="priority">Priority</option><option value="title">Title</option></Select>
        <Select name="order" defaultValue={sp.order ?? 'desc'} aria-label="Order"><option value="desc">Descending</option><option value="asc">Ascending</option></Select>
        <div className="flex gap-2 lg:col-span-2"><Button type="submit" className="flex-1">Apply filters</Button><Button asChild variant="ghost"><Link href="/app/goals">Reset</Link></Button></div>
      </form>

      {res.data.length === 0 ? (
        <Empty title="No goals match" action={<Button asChild size="sm"><Link href="/app/goals/new">Draft a goal</Link></Button>}>Try changing the filters, or draft a new goal.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Goals</caption>
              <thead><tr><th scope="col">Goal</th><th scope="col">Level</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col" className="min-w-40">Progress</th><th scope="col">Due</th><th scope="col">Risk</th></tr></thead>
              <tbody>
                {res.data.map((g: any) => (
                  <tr key={g.id}>
                    <td className="max-w-xs"><Link href={`/app/goals/${g.id}`} className="font-medium hover:underline">{g.title}</Link>{g.parent_title && <div className="truncate text-xs text-muted-foreground">↳ {g.parent_title}</div>}</td>
                    <td><LevelPill level={g.level} /></td>
                    <td className="whitespace-nowrap text-muted-foreground">{g.owner_name}</td>
                    <td><GoalStatusPill status={g.status} /></td>
                    <td><ProgressBar value={g.progress} label={`Progress of ${g.title}`} /></td>
                    <td className="whitespace-nowrap text-muted-foreground">{fmtDate(g.due_date)}</td>
                    <td>{g.status === 'active' ? <RiskPill risk={g.risk} /> : <PriorityPill priority={g.priority} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
            <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE, res.page.total)} of {res.page.total}</span>
            <div className="flex gap-2">
              {offset > 0 && <Button asChild variant="outline" size="sm"><Link href={qs({ offset: Math.max(0, offset - PAGE) })}>Previous</Link></Button>}
              {offset + PAGE < res.page.total && <Button asChild variant="outline" size="sm"><Link href={qs({ offset: offset + PAGE })}>Next</Link></Button>}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
