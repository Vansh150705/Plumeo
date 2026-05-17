import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Inbox } from '@/components/inbox';

export default async function EmployeeInbox() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');
  const { data: notifs } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  return (
    <AppShell role="Employee">
      <Inbox notifications={notifs ?? []} />
    </AppShell>
  );
}
