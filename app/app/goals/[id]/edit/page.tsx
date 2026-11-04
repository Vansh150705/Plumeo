import { notFound, redirect } from 'next/navigation';
import { requireCtx } from '@/server/auth/request';
import { goalFormData } from '@/server/auth/form-data';
import { getGoalDetail } from '@/server/services/goals';
import { AppError } from '@/server/core/errors';
import { PageHeader } from '@/components/page-header';
import { GoalForm } from '@/components/goal-form';

export const metadata = { title: 'Edit goal' };

export default async function EditGoal({ params }: { params: { id: string } }) {
  const ctx = await requireCtx();
  const detail = await getGoalDetail(ctx, params.id).catch((e) => { if (e instanceof AppError && (e.code === 'not_found' || e.code === 'validation_failed')) notFound(); throw e; });
  if (!detail.permissions.edit) redirect(`/app/goals/${params.id}`);
  const data = await goalFormData(ctx);
  return (
    <div>
      <PageHeader title="Edit goal" description={detail.goal.status === 'changes_requested' ? 'Your manager asked for changes. Update the goal and resubmit it.' : undefined} />
      <GoalForm mode="edit" {...data} initial={detail} />
    </div>
  );
}
