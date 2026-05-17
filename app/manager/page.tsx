import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Pill, StatusPill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { ClipboardCheck, Target, AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { fmtRelative } from '@/lib/utils';
import { computeScore } from '@/lib/goals';

export default async function ManagerHome() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  // Reports
  const { data: reports } = await supabase
    .from('users')
    .select('*')
    .eq('manager_id', user.id)
    .order('full_name');

  const reportIds = (reports ?? []).map(r => r.id);
  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();

  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('*, goals(*)')
    .eq('cycle_id', cycle!.id)
    .in('employee_id', reportIds.length ? reportIds : ['00000000-0000-0000-0000-000000000000']);

  const { data: escalations } = await supabase
    .from('escalation_events')
    .select('*, rule:escalation_rules(name), subject:users!escalation_events_subject_id_fkey(full_name)')
    .in('subject_id', reportIds.length ? reportIds : ['00000000-0000-0000-0000-000000000000'])
    .is('resolved_at', null)
    .order('triggered_at', { ascending: false })
    .limit(5);

  // Compute sheet score per report (across all goals + check-ins captured)
  const allGoalIds = (sheets ?? []).flatMap((s: any) => (s.goals ?? []).map((g: any) => g.id));
  const { data: allCheckIns } = allGoalIds.length
    ? await supabase.from('check_ins').select('*, goal:goals(*)').in('goal_id', allGoalIds)
    : { data: [] };

  const sheetScoreOf = (sheetId: string) => {
    const s = (sheets ?? []).find((x: any) => x.id === sheetId);
    if (!s) return null;
    const goals = s.goals ?? [];
    if (!goals.length) return null;
    let weightedSum = 0, weightedTotal = 0;
    for (const g of goals) {
      const cis = (allCheckIns ?? []).filter((c: any) => c.goal_id === g.id);
      // Use the latest check-in
      const latest = cis.sort((a: any, b: any) => (a.updated_at < b.updated_at ? 1 : -1))[0];
      if (!latest) continue;
      const score = computeScore(g, latest);
      if (score == null) continue;
      weightedSum += score * g.weightage;
      weightedTotal += g.weightage;
    }
    if (weightedTotal === 0) return null;
    return Math.round(weightedSum / weightedTotal);
  };

  const submitted = (sheets ?? []).filter((s: any) => s.status === 'Submitted').length;
  const approved = (sheets ?? []).filter((s: any) => s.status === 'Approved' || s.status === 'Locked').length;
  const draft = (sheets ?? []).filter((s: any) => s.status === 'Draft').length;

  return (
    <AppShell role="Manager">
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Team dashboard</div>
          <h1 className="font-serif text-4xl tracking-tight">{(reports?.length ?? 0)} direct reports</h1>
        </div>

        {/* Stat strip */}
        <div className="grid md:grid-cols-4 gap-3">
          <StatCard icon={ClipboardCheck} label="Pending approval" value={submitted} accent="blue" href="/manager/approvals" />
          <StatCard icon={Target} label="Approved sheets" value={approved} accent="green" />
          <StatCard icon={AlertTriangle} label="Still in draft" value={draft} accent="orange" />
          <StatCard icon={TrendingUp} label="Escalations" value={escalations?.length ?? 0} accent="red" />
        </div>

        {/* Team table */}
        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold">Your team</div>
              <Link href="/manager/approvals" className="text-xs text-primary hover:underline">Review pending →</Link>
            </div>
            <div className="divide-y divide-border">
              {(reports ?? []).map(r => {
                const sheet = (sheets ?? []).find((s: any) => s.employee_id === r.id);
                const score = sheet ? sheetScoreOf(sheet.id) : null;
                const goalCount = (sheet as any)?.goals?.length ?? 0;
                return (
                  <Link
                    key={r.id}
                    href={sheet ? `/manager/approvals?sheet=${sheet.id}` : '#'}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-accent transition group"
                  >
                    <Avatar name={r.full_name} id={r.id} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{r.full_name}</div>
                      <div className="text-xs text-muted-foreground">{r.department} · {r.upn}</div>
                    </div>
                    <div className="hidden md:flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <div className="font-mono">{goalCount} goal{goalCount === 1 ? '' : 's'}</div>
                        <div className="text-muted-foreground text-[10px]">defined</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono tabular-nums">{score ?? '—'}</div>
                        <div className="text-muted-foreground text-[10px]">score</div>
                      </div>
                    </div>
                    {sheet ? <StatusPill status={(sheet as any).status} /> : <Pill variant="gray">No sheet</Pill>}
                    <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                  </Link>
                );
              })}
              {(!reports || reports.length === 0) && (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No direct reports in the demo directory.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Escalations */}
        {escalations && escalations.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold">Recent escalations on your team</div>
                <Pill variant="red">{escalations.length} active</Pill>
              </div>
              <div className="divide-y divide-border">
                {escalations.map((e: any) => (
                  <div key={e.id} className="px-5 py-3 flex items-start gap-3">
                    <AlertTriangle className="size-4 text-orange-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{e.rule?.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {e.subject?.full_name} · {e.reason}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">{fmtRelative(e.triggered_at)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ icon: Icon, label, value, accent, href }: {
  icon: any; label: string; value: number; accent: 'blue' | 'green' | 'orange' | 'red'; href?: string;
}) {
  const colors = {
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    green: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    orange: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
  }[accent];
  const inner = (
    <Card className="hover:border-primary/30 transition h-full">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`size-10 rounded-lg border grid place-items-center ${colors}`}>
          <Icon className="size-4" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="font-serif text-2xl tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
