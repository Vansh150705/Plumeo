import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { computeScore, formatTarget, uomLabel } from '@/lib/goals';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (appUser?.role !== 'Admin') return new NextResponse('Forbidden', { status: 403 });

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('*, goals(*), employee:users!goal_sheets_employee_id_fkey(*)')
    .eq('cycle_id', cycle!.id);

  const allGoalIds = (sheets ?? []).flatMap((s: any) => (s.goals ?? []).map((g: any) => g.id));
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .in('goal_id', allGoalIds.length ? allGoalIds : ['00000000-0000-0000-0000-000000000000']);

  const headers = [
    'Cycle', 'Employee', 'UPN', 'Department', 'Sheet status',
    'Goal title', 'Thrust area', 'UoM', 'Direction', 'Target', 'Weightage',
    'Quarter', 'Achievement', 'Score', 'Status', 'Employee comment', 'Manager comment',
  ];
  const rows = [headers.join(',')];
  const csvEscape = (v: any): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  for (const sheet of (sheets ?? []) as any[]) {
    for (const goal of (sheet.goals ?? [])) {
      const cisForGoal = (checkIns ?? []).filter(c => c.goal_id === goal.id);
      if (cisForGoal.length === 0) {
        rows.push([
          cycle!.name, sheet.employee.full_name, sheet.employee.upn, sheet.employee.department, sheet.status,
          goal.title, goal.thrust_area, goal.uom, goal.direction, formatTarget(goal), goal.weightage,
          '', '', '', '', '', '',
        ].map(csvEscape).join(','));
      } else {
        for (const ci of cisForGoal) {
          const score = computeScore(goal, ci);
          const achievement = goal.uom === 'Zero' ? (ci.zero_achieved ? '0' : 'breach')
            : goal.uom === 'Timeline' ? (ci.actual_date ?? '')
            : (ci.actual_numeric ?? '');
          rows.push([
            cycle!.name, sheet.employee.full_name, sheet.employee.upn, sheet.employee.department, sheet.status,
            goal.title, goal.thrust_area, goal.uom, goal.direction, formatTarget(goal), goal.weightage,
            ci.quarter, achievement, score == null ? '' : Math.round(score), ci.progress_status,
            ci.employee_comment ?? '', ci.manager_comment ?? '',
          ].map(csvEscape).join(','));
        }
      }
    }
  }

  const filename = `atomquest-achievement-${cycle!.name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(rows.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
