import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Pill, StatusPill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import Link from 'next/link';
import { Users, FileCheck, AlertTriangle, TrendingUp, BarChart3, Bell, ScrollText, GitBranch } from 'lucide-react';
import { fmtRelative } from '@/lib/utils';

export default async function AdminHome() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();

  const [
    { data: users },
    { data: sheets },
    { data: escalations },
    { data: recentAudits },
  ] = await Promise.all([
    supabase.from('users').select('*').eq('is_active', true),
    supabase.from('goal_sheets').select('*').eq('cycle_id', cycle!.id),
    supabase.from('escalation_events')
      .select('*, rule:escalation_rules(name), subject:users!escalation_events_subject_id_fkey(full_name)')
      .is('resolved_at', null)
      .order('triggered_at', { ascending: false })
      .limit(5),
    supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(8),
  ]);

  const byStatus = {
    Draft:     (sheets ?? []).filter(s => s.status === 'Draft').length,
    Submitted: (sheets ?? []).filter(s => s.status === 'Submitted').length,
    Returned:  (sheets ?? []).filter(s => s.status === 'Returned').length,
    Approved:  (sheets ?? []).filter(s => s.status === 'Approved').length,
    Locked:    (sheets ?? []).filter(s => s.status === 'Locked').length,
  };

  const empCount = (users ?? []).filter(u => u.role === 'Employee').length;
  const mgrCount = (users ?? []).filter(u => u.role === 'Manager').length;
  const adminCount = (users ?? []).filter(u => u.role === 'Admin').length;

  return (
    <AppShell role="Admin">
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Operations</div>
          <h1 className="font-serif text-4xl tracking-tight">{cycle?.name ?? 'No active cycle'}</h1>
        </div>

        {/* KPI strip */}
        <div className="grid md:grid-cols-4 gap-3">
          <KpiCard icon={Users} label="People" value={users?.length ?? 0} hint={`${empCount}E · ${mgrCount}M · ${adminCount}A`} />
          <KpiCard icon={FileCheck} label="Active sheets" value={sheets?.length ?? 0} hint={`${byStatus.Approved + byStatus.Locked} approved`} accent="green" />
          <KpiCard icon={AlertTriangle} label="Open escalations" value={escalations?.length ?? 0} hint="awaiting action" accent="orange" />
          <KpiCard icon={TrendingUp} label="Completion" value={`${Math.round(((byStatus.Approved + byStatus.Locked) / Math.max(1, sheets?.length ?? 0)) * 100)}%`} hint="of submitted sheets approved" accent="gold" />
        </div>

        {/* Sheet pipeline funnel */}
        <Card>
          <CardContent className="p-5">
            <div className="text-sm font-semibold mb-4">Sheet pipeline</div>
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Draft', count: byStatus.Draft, color: 'bg-muted' },
                { label: 'Submitted', count: byStatus.Submitted, color: 'bg-blue-500/30' },
                { label: 'Returned', count: byStatus.Returned, color: 'bg-orange-500/30' },
                { label: 'Approved', count: byStatus.Approved, color: 'bg-emerald-500/30' },
                { label: 'Locked', count: byStatus.Locked, color: 'bg-primary/30' },
              ].map(stage => (
                <div key={stage.label}>
                  <div className={`h-2 rounded-full ${stage.color} mb-2`} />
                  <div className="font-serif text-2xl tabular-nums">{stage.count}</div>
                  <div className="text-xs text-muted-foreground">{stage.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Two-column: escalations + audit */}
        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="size-4 text-orange-400" />Live escalations</div>
                <Link href="/admin/escalations" className="text-xs text-primary hover:underline">Manage rules →</Link>
              </div>
              <div className="divide-y divide-border">
                {(escalations ?? []).length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">No active escalations.</div>
                ) : (
                  (escalations ?? []).map((e: any) => (
                    <div key={e.id} className="px-5 py-3 flex items-start gap-3">
                      <Pill variant={e.level === 'HR' ? 'red' : e.level === 'Manager' ? 'orange' : 'gray'}>{e.level}</Pill>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{e.rule?.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.subject?.full_name} · {e.reason}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{fmtRelative(e.triggered_at)}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-2"><ScrollText className="size-4 text-muted-foreground" />Recent audit events</div>
                <Link href="/admin/audit" className="text-xs text-primary hover:underline">Full log →</Link>
              </div>
              <div className="divide-y divide-border">
                {(recentAudits ?? []).length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">No activity yet.</div>
                ) : (
                  (recentAudits ?? []).map(a => (
                    <div key={a.id} className="px-5 py-3 flex items-start gap-3 text-sm">
                      <Pill variant="gray" className="font-mono">{a.action}</Pill>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground">
                          <span className="text-foreground">{a.actor_name}</span> on <span className="font-mono">{a.entity_type}</span>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{fmtRelative(a.occurred_at)}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick-jump */}
        <div className="grid md:grid-cols-4 gap-3">
          <QuickLink href="/admin/analytics" icon={BarChart3} title="Analytics" desc="QoQ trends, heatmaps, manager effectiveness" />
          <QuickLink href="/admin/escalations" icon={GitBranch} title="Escalations" desc="Configure rules · run sweep" />
          <QuickLink href="/admin/users" icon={Users} title="Entra sync" desc="Pull users · roles · hierarchy" />
          <QuickLink href="/admin/reports" icon={FileCheck} title="CSV export" desc="Achievement & completion" />
        </div>
      </div>
    </AppShell>
  );
}

function KpiCard({ icon: Icon, label, value, hint, accent }: {
  icon: any; label: string; value: string | number; hint?: string;
  accent?: 'green' | 'orange' | 'gold';
}) {
  const accentClass = accent === 'green' ? 'text-emerald-400'
    : accent === 'orange' ? 'text-orange-400'
    : accent === 'gold' ? 'text-primary' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="size-4 text-muted-foreground" />
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        </div>
        <div className={`font-serif text-3xl tabular-nums ${accentClass}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function QuickLink({ href, icon: Icon, title, desc }: { href: string; icon: any; title: string; desc: string }) {
  return (
    <Link href={href} className="block group">
      <Card className="hover:border-primary/30 transition h-full">
        <CardContent className="p-4">
          <Icon className="size-4 text-primary mb-2 group-hover:scale-110 transition-transform" />
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
