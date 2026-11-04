import { requireCtx, requirePermPage } from '@/server/auth/request';
import { listRoles } from '@/server/services/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { PageHeader } from '@/components/page-header';
import { RolesAdmin } from '@/components/admin/roles-admin';

export const metadata = { title: 'Roles & access' };

export default async function RolesPage() {
  const ctx = await requireCtx(); requirePermPage(ctx, 'roles.manage');
  const roles = await listRoles(ctx);
  return (
    <div>
      <PageHeader title="Roles & access" description="Permissions are enforced by the server on every request. Built-in roles cover the common cases; create custom roles for anything else. People are assigned roles on the People page." />
      <RolesAdmin roles={roles as any[]} catalogue={PERMISSIONS as Record<string, string>} held={[...ctx.perms]} />
    </div>
  );
}
