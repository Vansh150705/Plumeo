import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SharedGoalsClient } from './shared-client';

export default async function SharedGoalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();

  const { data: mySheet } = await supabase
    .from('goal_sheets')
    .select('*, goals(*)')
    .eq('cycle_id', cycle!.id)
    .eq('employee_id', user.id)
    .maybeSingle();

  const { data: reports } = await supabase
    .from('users')
    .select('*')
    .eq('manager_id', user.id);

  return (
    <AppShell role="Manager">
      <SharedGoalsClient
        myGoals={(mySheet as any)?.goals ?? []}
        reports={reports ?? []}
      />
    </AppShell>
  );
}
