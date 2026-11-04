import { requireCtx, requirePermPage } from '@/server/auth/request';
import { getPolicy } from '@/server/services/orgs';
import { PageHeader } from '@/components/page-header';
import { PolicyForm } from '@/components/admin/policy-form';

export const metadata = { title: 'Policies' };

export default async function PoliciesPage() {
  const ctx = await requireCtx(); requirePermPage(ctx, 'policies.manage');
  const { policy, version } = await getPolicy(ctx);
  return (<div><PageHeader title="Policies" description="Organisation-wide rules for approvals, amendments, goal quality, check-ins and sessions. Every change is recorded with the before and after values." /><PolicyForm initial={policy} version={version} /></div>);
}
