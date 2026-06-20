import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CheckInWorkspace } from '@/components/checkin-workspace';
import { FeedbackPanel } from '@/components/feedback-panel';
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

  const { data: feedback } = await supabase
    .from('feedback')
    .select('*, author:users!feedback_author_id_fkey(id, full_name)')
    .eq('subject_id', user.id)
    .order('created_at', { ascending: false });

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
      <div className="px-8 pb-10 max-w-4xl mx-auto w-full">
        <FeedbackPanel
          subjectId={user.id}
          subjectName=""
          currentUserId={user.id}
          canGive={false}
          initialFeedback={(feedback ?? []) as any}
        />
      </div>
    </AppShell>
  );
}
