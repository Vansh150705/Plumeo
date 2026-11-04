import Link from 'next/link';
import { requireCtx } from '@/server/auth/request';
import { listNotifications } from '@/server/services/notifications';
import { PageHeader } from '@/components/page-header';
import { Empty } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { NotificationList } from '@/components/notification-list';

export const metadata = { title: 'Notifications' };
const PAGE = 30;

export default async function NotificationsPage({ searchParams }: { searchParams: { offset?: string } }) {
  const ctx = await requireCtx();
  const offset = Math.max(0, Number(searchParams.offset) || 0);
  const r = await listNotifications(ctx, { limit: PAGE, offset });
  return (
    <div>
      <PageHeader title="Notifications" description="Approvals, feedback, deadlines and important updates. Choose what you receive in Settings." actions={<Button asChild variant="ghost"><Link href="/app/settings#notifications">Preferences</Link></Button>} />
      {r.data.length === 0 ? <Empty title="Nothing here yet">You&apos;ll see approvals, feedback and reminders as they happen.</Empty> : <NotificationList items={r.data} unread={r.unread} />}
      <div className="mt-4 flex justify-between">{offset > 0 ? <Button asChild variant="outline" size="sm"><Link href={`?offset=${Math.max(0, offset - PAGE)}`}>Newer</Link></Button> : <span />}{offset + PAGE < r.page.total && <Button asChild variant="outline" size="sm"><Link href={`?offset=${offset + PAGE}`}>Older</Link></Button>}</div>
    </div>
  );
}
