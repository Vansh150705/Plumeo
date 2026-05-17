import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getOrCreateMySheet } from '@/lib/actions';
import { AppShell } from '@/components/app-shell';
import { GoalSheetEditor } from '@/components/goal-sheet-editor';

export default async function ManagerMyGoals() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const sheet = await getOrCreateMySheet();
  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('sheet_id', sheet.id)
    .order('display_order');
  const { data: cycle } = await supabase.from('cycles').select('*').eq('id', sheet.cycle_id).single();
  const { data: thrustAreas } = await supabase.from('thrust_areas').select('*').eq('is_active', true);

  return (
    <AppShell role="Manager">
      <GoalSheetEditor
        sheet={sheet}
        goals={goals ?? []}
        cycle={cycle!}
        thrustAreas={(thrustAreas ?? []).map((t: any) => t.name)}
        readOnly={false}
      />
    </AppShell>
  );
}
