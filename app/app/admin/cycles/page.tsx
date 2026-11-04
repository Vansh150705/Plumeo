import { requireCtx, requirePermPage } from '@/server/auth/request';
import { listCycles } from '@/server/services/cycles';
import { PageHeader } from '@/components/page-header';
import { CyclesAdmin } from '@/components/admin/cycles-admin';

export const metadata = { title: 'Cycles & periods' };

export default async function CyclesPage() {
  const ctx = await requireCtx(); requirePermPage(ctx, 'cycles.manage');
  return (<div><PageHeader title="Cycles & review periods" description="Define goal cycles and when check-ins open and fall due. Quarterly is the default; custom periods are supported." /><CyclesAdmin cycles={await listCycles(ctx)} /></div>);
}
