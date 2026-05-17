import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ManagerCheckinsClient } from './checkins-client';
import { activeQuarter } from '@/lib/goals';

export default async function ManagerCheckinsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  const { data: reports } = await supabase
    .from('users')
    .select('*')
    .eq('manager_id', user.id);

  const reportIds = (reports ?? []).map(r => r.id);
  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('*, goals(*)')
    .eq('cycle_id', cycle!.id)
    .in('employee_id', reportIds.length ? reportIds : ['00000000-0000-0000-0000-000000000000']);

  const allGoalIds = (sheets ?? []).flatMap((s: any) => (s.goals ?? []).map((g: any) => g.id));
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .in('goal_id', allGoalIds.length ? allGoalIds : ['00000000-0000-0000-0000-000000000000']);

  return (
    <AppShell role="Manager">
      <ManagerCheckinsClient
        reports={reports ?? []}
        sheets={(sheets ?? []) as any}
        checkIns={checkIns ?? []}
        cycle={cycle!}
        currentQuarter={activeQuarter(cycle!) ?? 'Q1'}
      />
    </AppShell>
  );
}
