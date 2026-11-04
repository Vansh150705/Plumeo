import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireCtx, requirePermPage } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { searchAudit } from '@/server/services/audit';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Empty } from '@/components/ui/empty';
import { Pill } from '@/components/ui/pill';
import { AuditVerify } from '@/components/audit-verify';
import { fmtDateTime } from '@/lib/utils';

export const metadata = { title: 'Audit trail' };
const ENTITIES = ['goal', 'user', 'role', 'department', 'team', 'cycle', 'policy', 'integration', 'template', 'delegation', 'org', 'export', 'audit'];

export default async function AuditPage({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requireCtx(); requirePermPage(ctx, 'audit.read');
  const res = await searchAudit(ctx, { q: sp.q, action: sp.action, entityType: sp.entityType, entityId: sp.entityId, from: sp.from, to: sp.to, limit: 50, beforeSeq: sp.beforeSeq ? Number(sp.beforeSeq) : undefined });
  const next = new URLSearchParams(Object.entries({ ...sp, beforeSeq: res.nextBeforeSeq ? String(res.nextBeforeSeq) : '' }).filter(([, v]) => v).map(([k, v]) => [k, v as string])).toString();
  const exp = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'beforeSeq').map(([k, v]) => [k, v as string])).toString();
  return (
    <div>
      <PageHeader title="Audit trail" description="An append-only, hash-chained record of every important action. Entries cannot be edited or removed through Plumeo."
        actions={can(ctx, 'audit.export') ? <Button asChild variant="outline"><a href={`/api/v1/exports/audit.csv?${exp}`}><Download className="size-4" aria-hidden />Export CSV</a></Button> : undefined} />
      <div className="mb-4"><AuditVerify /></div>
      <form method="get" className="mb-4 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filter the audit trail">
        <Input name="q" defaultValue={sp.q} placeholder="Search actor, action or content" aria-label="Search" className="lg:col-span-2" />
        <Input name="action" defaultValue={sp.action} placeholder="Action, e.g. goal.*" aria-label="Action" />
        <Select name="entityType" defaultValue={sp.entityType ?? ''} aria-label="Entity type"><option value="">All entities</option>{ENTITIES.map((e) => <option key={e}>{e}</option>)}</Select>
        <Input name="from" type="date" defaultValue={sp.from} aria-label="From date" /><Input name="to" type="date" defaultValue={sp.to} aria-label="To date" />
        {sp.entityId && <input type="hidden" name="entityId" value={sp.entityId} />}
        <div className="flex gap-2 lg:col-span-6"><Button type="submit">Search</Button><Button asChild variant="ghost"><Link href="/app/audit">Reset</Link></Button>{sp.entityId && <span className="self-center text-xs text-muted-foreground">History of one record</span>}</div>
      </form>
      {res.data.length === 0 ? <Empty title="No matching events">Try widening the filters.</Empty> : (
        <div className="table-wrap"><table><caption className="sr-only">Audit events, newest first</caption>
          <thead><tr><th scope="col">#</th><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Detail</th></tr></thead>
          <tbody>{res.data.map((e: any) => (
            <tr key={e.seq}>
              <td className="tabular-nums text-muted-foreground">{e.seq}</td><td className="whitespace-nowrap">{fmtDateTime(e.occurred_at)}</td>
              <td className="whitespace-nowrap">{e.actor_name ?? <span className="text-muted-foreground">—</span>}{e.actor_type !== 'user' && <Pill className="ml-1.5">{e.actor_type}</Pill>}</td>
              <td><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.action}</code></td>
              <td className="whitespace-nowrap">{e.entity_id && e.entity_type === 'goal' ? <Link href={`/app/goals/${e.entity_id}`} className="underline underline-offset-2">goal</Link> : e.entity_type}{e.entity_id && <Link href={`/app/audit?entityId=${e.entity_id}`} className="ml-1.5 text-xs text-muted-foreground hover:text-foreground">history</Link>}</td>
              <td className="max-w-md">{(e.before_data || e.after_data || Object.keys(e.metadata ?? {}).length > 0) ? (
                <details><summary className="cursor-pointer text-xs text-muted-foreground">View values</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">{e.before_data && <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]"><b>Before</b>{'\n'}{JSON.stringify(e.before_data, null, 1)}</pre>}{e.after_data && <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]"><b>After</b>{'\n'}{JSON.stringify(e.after_data, null, 1)}</pre>}</div>
                  {Object.keys(e.metadata ?? {}).length > 0 && <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(e.metadata, null, 1)}</pre>}
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">hash {e.hash.slice(0, 16)}… · request {e.request_id}</div></details>) : <span className="text-xs text-muted-foreground">—</span>}</td>
            </tr>))}</tbody></table></div>
      )}
      {res.nextBeforeSeq && <div className="mt-4 text-center"><Button asChild variant="outline"><Link href={`/app/audit?${next}`}>Older events</Link></Button></div>}
    </div>
  );
}
