import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { AnalyticsCharts } from './analytics-charts';
import { computeScore } from '@/lib/goals';

export default async function AdminAnalytics() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  const { data: users } = await supabase.from('users').select('*');
  const { data: sheets } = await supabase.from('goal_sheets').select('*, goals(*)').eq('cycle_id', cycle!.id);
  const allGoalIds = (sheets ?? []).flatMap((s: any) => (s.goals ?? []).map((g: any) => g.id));
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .in('goal_id', allGoalIds.length ? allGoalIds : ['00000000-0000-0000-0000-000000000000']);

  // average score per quarter, across the whole org
  const qoqData = (['Q1', 'Q2', 'Q3', 'Q4'] as const).map(q => {
    const cisForQ = (checkIns ?? []).filter(c => c.quarter === q);
    let sum = 0, total = 0;
    for (const ci of cisForQ) {
      const g = (sheets ?? []).flatMap((s: any) => s.goals ?? []).find((g: any) => g.id === ci.goal_id);
      if (!g) continue;
      const s = computeScore(g, ci);
      if (s == null) continue;
      sum += s * g.weightage;
      total += g.weightage;
    }
    return { quarter: q, score: total === 0 ? null : Math.round(sum / total), count: cisForQ.length };
  });

  // Goals by thrust area
  const thrustCounts: Record<string, number> = {};
  for (const s of sheets ?? []) {
    for (const g of (s as any).goals ?? []) {
      thrustCounts[g.thrust_area] = (thrustCounts[g.thrust_area] ?? 0) + 1;
    }
  }
  const thrustData = Object.entries(thrustCounts).map(([name, value]) => ({ name, value }));

  // Goals by UoM
  const uomCounts: Record<string, number> = {};
  for (const s of sheets ?? []) {
    for (const g of (s as any).goals ?? []) {
      uomCounts[g.uom] = (uomCounts[g.uom] ?? 0) + 1;
    }
  }
  const uomData = Object.entries(uomCounts).map(([name, value]) => ({ name, value }));

  // Department × Quarter completion heatmap
  const departments = Array.from(new Set((users ?? []).map(u => u.department).filter(Boolean))) as string[];
  const heatmap: Record<string, Record<string, number>> = {};
  for (const dept of departments) {
    heatmap[dept] = {};
    const deptUsers = (users ?? []).filter(u => u.department === dept);
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
      let sum = 0, total = 0;
      for (const u of deptUsers) {
        const sheet = (sheets ?? []).find((s: any) => s.employee_id === u.id);
        if (!sheet) continue;
        for (const g of (sheet as any).goals ?? []) {
          const ci = (checkIns ?? []).find(c => c.goal_id === g.id && c.quarter === q);
          if (!ci) continue;
          const s = computeScore(g, ci);
          if (s == null) continue;
          sum += s * g.weightage;
          total += g.weightage;
        }
      }
      heatmap[dept][q] = total === 0 ? 0 : Math.round(sum / total);
    }
  }

  // manager effectiveness: what share of expected check-ins each team captured
  const managers = (users ?? []).filter(u => u.role === 'Manager');
  const mgrData = managers.map(m => {
    const team = (users ?? []).filter(u => u.manager_id === m.id);
    let totalCheckIns = 0, doneCheckIns = 0;
    for (const t of team) {
      const sheet = (sheets ?? []).find((s: any) => s.employee_id === t.id);
      if (!sheet) continue;
      const goalCount = ((sheet as any).goals ?? []).length;
      totalCheckIns += goalCount * 4;  // 4 quarters
      for (const g of (sheet as any).goals ?? []) {
        doneCheckIns += (checkIns ?? []).filter(c => c.goal_id === g.id).length;
      }
    }
    return {
      name: m.full_name.split(' ')[0],
      completion: totalCheckIns === 0 ? 0 : Math.round((doneCheckIns / totalCheckIns) * 100),
      team: team.length,
    };
  });

  return (
    <AppShell role="Admin">
      <AnalyticsCharts
        qoqData={qoqData}
        thrustData={thrustData}
        uomData={uomData}
        heatmap={heatmap}
        managerData={mgrData}
        departments={departments}
      />
    </AppShell>
  );
}
