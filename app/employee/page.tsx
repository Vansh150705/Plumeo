import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getOrCreateMySheet } from '@/lib/actions';
import { AppShell } from '@/components/app-shell';
import { GoalSheetEditor } from '@/components/goal-sheet-editor';
import { isAiConfigured } from '@/lib/ai-config';

export default async function EmployeePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  // Ensure user has a sheet
  const sheet = await getOrCreateMySheet();

  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('sheet_id', sheet.id)
    .order('display_order', { ascending: true });

  const { data: cycle } = await supabase.from('cycles').select('*').eq('id', sheet.cycle_id).single();
  const { data: thrustAreas } = await supabase.from('thrust_areas').select('*').eq('is_active', true).order('name');

  return (
    <AppShell role="Employee">
      <GoalSheetEditor
        sheet={sheet}
        goals={goals ?? []}
        cycle={cycle!}
        thrustAreas={thrustAreas?.map(t => t.name) ?? []}
        readOnly={false}
        aiEnabled={isAiConfigured()}
      />
    </AppShell>
  );
}
