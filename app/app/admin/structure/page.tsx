import { requireCtx, requirePermPage } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { listStructure } from '@/server/services/structure';
import { PageHeader } from '@/components/page-header';
import { StructureAdmin } from '@/components/admin/structure-admin';
import { Empty } from '@/components/ui/empty';

export const metadata = { title: 'Structure' };

export default async function StructurePage() {
  const ctx = await requireCtx(); requirePermPage(ctx, 'structure.manage', 'users.read', 'users.manage');
  const s = await listStructure(ctx);
  return (
    <div>
      <PageHeader title="Organisation structure" description="Business units, departments, teams and sub-teams. Department heads and team leads automatically receive the matching visibility and approval rights." />
      {s.departments.length === 0 && !can(ctx, 'structure.manage') ? <Empty title="No structure yet">An administrator has not set up departments.</Empty> : <StructureAdmin departments={s.departments as any} teams={s.teams as any} canManage={can(ctx, 'structure.manage')} />}
    </div>
  );
}
