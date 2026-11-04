import Link from 'next/link';
import { requireCtx, requirePermPage } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { listUsers } from '@/server/services/users';
import { listStructure } from '@/server/services/structure';
import { listRoles } from '@/server/services/rbac';
import { PageHeader } from '@/components/page-header';
import { PeopleAdmin } from '@/components/admin/people-admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export const metadata = { title: 'People' };
const PAGE = 50;

export default async function PeoplePage({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requireCtx(); requirePermPage(ctx, 'users.manage', 'users.read');
  const offset = Math.max(0, Number(sp.offset) || 0);
  const [res, structure, roles] = await Promise.all([listUsers(ctx, { q: sp.q, status: sp.status || undefined, departmentId: sp.departmentId || undefined, limit: PAGE, offset }), listStructure(ctx), can(ctx, 'roles.manage') || can(ctx, 'users.manage') ? listRoles(ctx) : Promise.resolve([])]);
  const qs = (o: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.departmentId ? { departmentId: sp.departmentId } : {}), offset: String(o) })}`;
  return (
    <div>
      <PageHeader title="People" description={`${res.page.total} people in your organisation. Reporting lines drive approvals and visibility.`} />
      <form method="get" className="mb-4 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-4" role="search">
        <Input name="q" defaultValue={sp.q} placeholder="Search name or email" aria-label="Search people" />
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Status"><option value="">Any status</option>{['active', 'invited', 'suspended', 'deactivated', 'anonymized'].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select name="departmentId" defaultValue={sp.departmentId ?? ''} aria-label="Department"><option value="">All departments</option>{structure.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      <PeopleAdmin users={res.data} lookups={{ departments: structure.departments as any, teams: structure.teams as any, roles: roles as any }} canManage={can(ctx, 'users.manage')} canRoles={can(ctx, 'roles.manage')} canAnonymize={can(ctx, 'users.anonymize')} welcome={sp.welcome === '1'} />
      <div className="mt-4 flex justify-between text-sm"><span className="text-muted-foreground">{res.page.total ? `${offset + 1}–${Math.min(offset + PAGE, res.page.total)} of ${res.page.total}` : ''}</span><div className="flex gap-2">{offset > 0 && <Button asChild variant="outline" size="sm"><Link href={qs(Math.max(0, offset - PAGE))}>Previous</Link></Button>}{offset + PAGE < res.page.total && <Button asChild variant="outline" size="sm"><Link href={qs(offset + PAGE)}>Next</Link></Button>}</div></div>
    </div>
  );
}
