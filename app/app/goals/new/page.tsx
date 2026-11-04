import { requireCtx } from '@/server/auth/request';
import { goalFormData } from '@/server/auth/form-data';
import { PageHeader } from '@/components/page-header';
import { GoalForm } from '@/components/goal-form';

export const metadata = { title: 'New goal' };

export default async function NewGoal({ searchParams }: { searchParams: { parent?: string; cycleId?: string } }) {
  const ctx = await requireCtx();
  const data = await goalFormData(ctx);
  return (
    <div>
      <PageHeader title="New goal" description="Draft it freely — nothing is sent for approval until you submit." />
      <GoalForm mode="create" {...data} defaultParentId={searchParams.parent} defaultCycleId={searchParams.cycleId} />
    </div>
  );
}
