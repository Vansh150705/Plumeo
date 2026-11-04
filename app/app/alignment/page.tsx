import { requireCtx } from '@/server/auth/request';
import { getAlignment } from '@/server/services/goals';
import { listCycles } from '@/server/services/cycles';
import { PageHeader, Stat } from '@/components/page-header';
import { AlignmentTree } from '@/components/alignment-tree';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';

export const metadata = { title: 'Alignment' };

export default async function AlignmentPage({ searchParams }: { searchParams: { cycleId?: string } }) {
  const ctx = await requireCtx();
  const cycles = await listCycles(ctx);
  const cycleId = searchParams.cycleId ?? (cycles.find((c: any) => c.status === 'active') ?? cycles[0])?.id;
  if (!cycleId) return <Empty title="No goal cycle yet">An administrator needs to create a cycle first.</Empty>;
  const { nodes } = await getAlignment(ctx, cycleId);
  const real = nodes.filter((n: any) => !n.redacted);
  const nonCompany = real.filter((n: any) => n.level !== 'company' && n.status !== 'pending_approval');
  const aligned = nonCompany.filter((n: any) => n.parent_goal_id).length;
  return (
    <div>
      <PageHeader title="Alignment" description="See how company, department, team and individual goals connect — and how your work contributes."
        actions={<form method="get" className="flex gap-2"><Select name="cycleId" defaultValue={cycleId} aria-label="Cycle" className="w-48">{cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><Button type="submit" variant="outline">Show</Button></form>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Goals in view" value={real.length} />
        <Stat label="Aligned to a broader goal" value={nonCompany.length ? `${Math.round((aligned / nonCompany.length) * 100)}%` : '—'} hint={`${aligned} of ${nonCompany.length}`} />
        <Stat label="Company goals" value={real.filter((n: any) => n.level === 'company').length} />
      </div>
      {nodes.length === 0 ? <Empty title="No goals to show yet">Approved and pending goals for this cycle will appear here.</Empty> : <AlignmentTree nodes={nodes as any} meId={ctx.userId} />}
    </div>
  );
}
