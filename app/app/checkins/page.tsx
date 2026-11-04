import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireCtx } from '@/server/auth/request';
import { listActionItems, listMyCheckins } from '@/server/services/checkins';
import { PageHeader } from '@/components/page-header';
import { Empty } from '@/components/ui/empty';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckinStatePill, HealthPill } from '@/components/status';
import { ActionItemList } from '@/components/checkin-panels';
import { fmtDate } from '@/lib/utils';

export const metadata = { title: 'Check-ins' };

export default async function CheckinsPage() {
  const ctx = await requireCtx();
  const [periods, actions] = await Promise.all([listMyCheckins(ctx), listActionItems(ctx, { status: 'open' })]);
  return (
    <div>
      <PageHeader title="Check-ins" description="A short, regular reflection on each goal. Submitted check-ins are kept as a permanent record." />
      {actions.length > 0 && <Card className="mb-6"><CardHeader className="pb-2"><CardTitle>Follow-ups for you</CardTitle></CardHeader><CardContent><ActionItemList items={actions} /></CardContent></Card>}
      {periods.length === 0 ? <Empty title="No check-ins due">Once a review period opens, your active goals will appear here.</Empty> : (
        <div className="space-y-8">{periods.map((p: any) => (
          <section key={p.id} aria-labelledby={`p-${p.id}`}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id={`p-${p.id}`} className="text-base font-semibold">{p.name}</h2><span className="text-xs text-muted-foreground">Window {fmtDate(p.opens_on)} – due {fmtDate(p.due_on)}</span></div>
            <ul className="space-y-2">{p.items.map((i: any) => (
              <li key={i.goal_id}><Link href={`/app/checkins/${i.goal_id}/${p.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-primary/40">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span><HealthPill health={i.health} />{i.is_late && <span className="text-xs text-[hsl(var(--warning))]">late</span>}<CheckinStatePill state={i.state} /><ArrowRight className="size-4 text-muted-foreground" aria-hidden />
              </Link></li>))}</ul>
          </section>))}</div>
      )}
    </div>
  );
}
