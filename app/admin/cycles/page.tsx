import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Calendar, Lock, Clock, CheckCircle2 } from 'lucide-react';
import { fmtDate } from '@/lib/utils';
import { activeQuarter, isGoalSettingWindowOpen } from '@/lib/goals';

export default async function CyclesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');
  const { data: cycles } = await supabase.from('cycles').select('*').order('fiscal_year', { ascending: false });

  return (
    <AppShell role="Admin">
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Configuration</div>
          <h1 className="font-serif text-4xl tracking-tight">Cycles</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Quarterly check-in windows enforced from this configuration. Phase 1 opens 1 May; Q1 in July; Q2 in October; Q3 in January; Q4 in March-April.
          </p>
        </div>

        <div className="space-y-3">
          {(cycles ?? []).map(c => {
            const aq = activeQuarter(c);
            const goalOpen = isGoalSettingWindowOpen(c);
            return (
              <Card key={c.id} className={c.is_active ? 'border-primary/30' : ''}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="font-serif text-2xl">{c.name}</h2>
                        {c.is_active && <Pill variant="green">Active</Pill>}
                        {goalOpen && <Pill variant="gold">Goal-setting open</Pill>}
                        {aq && <Pill variant="blue">{aq} check-in window</Pill>}
                      </div>
                      <div className="text-xs text-muted-foreground">FY {c.fiscal_year}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    <CycleWindow label="Goal setting" open={c.goal_window_start} close={c.goal_window_end} active={goalOpen} />
                    <CycleWindow label="Q1" open={c.q1_open} close={c.q1_close} active={aq === 'Q1'} />
                    <CycleWindow label="Q2" open={c.q2_open} close={c.q2_close} active={aq === 'Q2'} />
                    <CycleWindow label="Q3" open={c.q3_open} close={c.q3_close} active={aq === 'Q3'} />
                    <CycleWindow label="Q4" open={c.q4_open} close={c.q4_close} active={aq === 'Q4'} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function CycleWindow({ label, open, close, active }: { label: string; open: string; close: string; active?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="text-xs">
        <div className="font-medium">{fmtDate(open)}</div>
        <div className="text-muted-foreground">→ {fmtDate(close)}</div>
      </div>
    </div>
  );
}
