import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SidebarNav } from '@/components/sidebar-nav';
import { TopBar } from '@/components/top-bar';
import type { UserRole } from '@/lib/types';

export async function AppShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role: UserRole;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');
  const { data: appUser } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
  if (!appUser) redirect('/');
  if (appUser.role !== role) {
    // Route them to their actual home instead
    if (appUser.role === 'Admin')   redirect('/admin');
    if (appUser.role === 'Manager') redirect('/manager');
    if (appUser.role === 'Employee') redirect('/employee');
  }

  // Pull unread notifications for top-bar bell
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', appUser.id)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className="flex min-h-screen">
      <SidebarNav user={appUser} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={appUser} notifications={notifications ?? []} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
