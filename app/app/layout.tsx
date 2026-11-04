import { requireCtx } from '@/server/auth/request';
import { AppShell } from '@/components/app-shell';
import { withOrg } from '@/server/db/pool';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const info = await withOrg(ctx.orgId, async (tx) => ({
    org: await tx.one<{ name: string }>('select name from orgs where id = $1', [ctx.orgId]),
    unread: (await tx.one<{ n: number }>('select count(*)::int as n from notifications where org_id = $1 and user_id = $2 and read_at is null', [ctx.orgId, ctx.userId]))!.n,
    approvals: (await tx.one<{ n: number }>(
      `select count(*)::int as n from approval_requests ar where ar.org_id = $1 and ar.status = 'pending' and (ar.approver_id = $2 or ar.approver_id in
         (select delegator_id from approval_delegations where org_id = $1 and delegate_id = $2 and revoked_at is null and now() between starts_at and ends_at))`, [ctx.orgId, ctx.userId]))!.n,
  }));
  return (
    <AppShell user={{ id: ctx.userId, name: ctx.userName, roles: ctx.roleKeys }} orgName={info.org?.name ?? ''} perms={[...ctx.perms]} unread={info.unread} approvals={info.approvals}>
      {children}
    </AppShell>
  );
}
