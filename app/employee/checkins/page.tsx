import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CheckInWorkspace } from '@/components/checkin-workspace';
import { activeQuarter } from '@/lib/goals';

export default async function EmployeeCheckinsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  const { data: sheet } = await supabase
    .from('goal_sheets')
    .select('*')
    .eq('cycle_id', cycle!.id)
    .eq('employee_id', user.id)
    .maybeSingle();
  if (!sheet) redirect('/employee');

  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('sheet_id', sheet.id)
    .order('display_order');
  const goalIds = (goals ?? []).map(g => g.id);
  const { data: checkIns } = goalIds.length
    ? await supabase.from('check_ins').select('*').in('goal_id', goalIds)
    : { data: [] };

  const currentQuarter = activeQuarter(cycle!) ?? 'Q1';

  return (
    <AppShell role="Employee">
      <CheckInWorkspace
        goals={goals ?? []}
        checkIns={checkIns ?? []}
        currentQuarter={currentQuarter}
        cycle={cycle!}
        sheetStatus={sheet.status}
        viewerRole="Employee"
      />
    </AppShell>
  );
}
