import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { UsersClient } from './users-client';

export default async function AdminUsers() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: users } = await supabase.from('users').select('*').order('full_name');
  // Resolve manager names client-side
  const byId: Record<string, string> = Object.fromEntries((users ?? []).map(u => [u.id, u.full_name]));

  return (
    <AppShell role="Admin">
      <UsersClient users={(users ?? []).map(u => ({ ...u, manager_name: u.manager_id ? byId[u.manager_id] : null }))} />
    </AppShell>
  );
}
