import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill, StatusPill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { FileSpreadsheet, Download, FileText } from 'lucide-react';
import { computeScore } from '@/lib/goals';

export default async function ReportsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  const { data: users } = await supabase.from('users').select('*').eq('role', 'Employee');
  const { data: sheets } = await supabase.from('goal_sheets').select('*, goals(*)').eq('cycle_id', cycle!.id);
  const goalIds = (sheets ?? []).flatMap((s: any) => (s.goals ?? []).map((g: any) => g.id));
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .in('goal_id', goalIds.length ? goalIds : ['00000000-0000-0000-0000-000000000000']);

  // Per-employee summary
  const rows = (users ?? []).map(u => {
    const sheet = (sheets ?? []).find((s: any) => s.employee_id === u.id) as any;
    const goals = sheet?.goals ?? [];
    const totalCheckIns = goals.length * 4;
    const doneCheckIns = goals.reduce((acc: number, g: any) =>
      acc + (checkIns ?? []).filter(c => c.goal_id === g.id).length, 0);
    let weightedSum = 0, weightedTotal = 0;
    for (const g of goals) {
      const cis = (checkIns ?? []).filter(c => c.goal_id === g.id);
      const latest = cis.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
      if (!latest) continue;
      const s = computeScore(g, latest);
      if (s == null) continue;
      weightedSum += s * g.weightage;
      weightedTotal += g.weightage;
    }
    return {
      user: u,
      sheet,
      goalCount: goals.length,
      score: weightedTotal === 0 ? null : Math.round(weightedSum / weightedTotal),
      checkinCompletion: totalCheckIns === 0 ? 0 : Math.round((doneCheckIns / totalCheckIns) * 100),
    };
  });

  return (
    <AppShell role="Admin">
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">BRD §4 · Reporting</div>
          <h1 className="font-serif text-4xl tracking-tight">Reports & exports</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Achievement reports streamed as CSV. Completion dashboard summarises every employee&apos;s sheet state and check-in coverage.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <Card className="hover:border-primary/30 transition group">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center shrink-0">
                  <FileSpreadsheet className="size-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="text-base font-medium mb-1">Achievement export</div>
                  <div className="text-sm text-muted-foreground mb-3">
                    One row per goal × quarter with planned vs actual, scoring, and status.
                  </div>
                  <Button asChild>
                    <a href="/api/reports/achievement" download>
                      <Download className="size-3.5" /> Download CSV
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/30 transition group">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-lg bg-purple-500/10 border border-purple-500/20 grid place-items-center shrink-0">
                  <FileText className="size-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="text-base font-medium mb-1">Audit export</div>
                  <div className="text-sm text-muted-foreground mb-3">
                    Full audit trail — who changed what, when. Useful for compliance reviews.
                  </div>
                  <Button asChild variant="secondary">
                    <a href="/api/reports/audit" download>
                      <Download className="size-3.5" /> Download CSV
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold">Completion dashboard</div>
              <Pill variant="gold">{cycle?.name}</Pill>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background/50">
                  <tr className="text-left">
                    <Th>Employee</Th>
                    <Th>Sheet status</Th>
                    <Th>Goals</Th>
                    <Th>Check-in coverage</Th>
                    <Th>Latest score</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => (
                    <tr key={r.user.id} className="hover:bg-accent/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.user.full_name} id={r.user.id} size={28} />
                          <div>
                            <div className="font-medium">{r.user.full_name}</div>
                            <div className="text-[11px] text-muted-foreground">{r.user.department}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.sheet ? <StatusPill status={r.sheet.status} /> : <Pill variant="gray">No sheet</Pill>}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">{r.goalCount}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${r.checkinCompletion}%` }} />
                          </div>
                          <span className="font-mono text-[11px] tabular-nums w-9">{r.checkinCompletion}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">{r.score ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{children}</th>;
}
