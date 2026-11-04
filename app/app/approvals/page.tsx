import Link from 'next/link';
import { requireCtx } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { listApprovalQueue, listDelegations } from '@/server/services/approvals';
import { PageHeader } from '@/components/page-header';
import { Empty } from '@/components/ui/empty';
import { ApprovalQueue } from '@/components/approval-queue';
import { Delegations } from '@/components/delegations';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Approvals' };

export default async function ApprovalsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const ctx = await requireCtx();
  const oversight = can(ctx, 'goals.approve_any');
  const tab = searchParams.tab === 'oversight' && oversight ? 'oversight' : searchParams.tab === 'delegations' ? 'delegations' : 'mine';
  const [mine, all, delegations] = await Promise.all([listApprovalQueue(ctx, 'mine'), tab === 'oversight' ? listApprovalQueue(ctx, 'all') : Promise.resolve([]), listDelegations(ctx)]);
  const tabs = [['mine', `Waiting for me (${mine.length})`], ...(oversight ? [['oversight', 'Organisation oversight']] : []), ['delegations', 'Delegation']];
  return (
    <div>
      <PageHeader title="Approvals" description="Review goals and amendments waiting for your decision." />
      <div role="tablist" aria-label="Approval views" className="mb-6 flex gap-1 border-b border-border">
        {tabs.map(([k, l]) => <Link key={k} role="tab" aria-selected={tab === k} href={k === 'mine' ? '/app/approvals' : `/app/approvals?tab=${k}`} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', tab === k ? 'border-[hsl(var(--gold))] font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>{l}</Link>)}
      </div>
      {tab === 'mine' && (mine.length ? <ApprovalQueue items={mine} scope="mine" /> : <Empty title="You're all caught up">Nothing is waiting for your approval right now.</Empty>)}
      {tab === 'oversight' && (all.length ? <ApprovalQueue items={all} scope="all" /> : <Empty title="No pending approvals">There are no open approval requests in the organisation.</Empty>)}
      {tab === 'delegations' && <Delegations items={delegations} meId={ctx.userId} canDelegate={can(ctx, 'goals.approve') || oversight} />}
    </div>
  );
}
