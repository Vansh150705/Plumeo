import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ApprovalsClient } from './approvals-client';

export default async function ApprovalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: reports } = await supabase
    .from('users')
    .select('id, full_name, department, upn, manager_id')
    .eq('manager_id', user.id);

  const reportIds = (reports ?? []).map(r => r.id);
  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  const { data: thrustAreas } = await supabase.from('thrust_areas').select('name').eq('is_active', true);

  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('*, goals(*), employee:users!goal_sheets_employee_id_fkey(*)')
    .eq('cycle_id', cycle!.id)
    .in('employee_id', reportIds.length ? reportIds : ['00000000-0000-0000-0000-000000000000'])
    .order('submitted_at', { ascending: false });

  return (
    <AppShell role="Manager">
      <ApprovalsClient
        sheets={(sheets ?? []) as any}
        cycle={cycle!}
        thrustAreas={(thrustAreas ?? []).map((t: any) => t.name)}
      />
    </AppShell>
  );
}
