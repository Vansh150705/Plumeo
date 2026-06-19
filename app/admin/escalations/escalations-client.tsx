'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { AlertTriangle, Play, GitBranch, Clock, CheckCircle2 } from 'lucide-react';
import { runEscalationSweep } from '@/lib/actions';
import { fmtRelative } from '@/lib/utils';
import type { EscalationRule, EscalationEvent } from '@/lib/types';

export function EscalationsClient({
  rules, events,
}: {
  rules: EscalationRule[];
  events: (EscalationEvent & { rule: { name: string }; subject: { full_name: string; department: string } })[];
}) {
  const [pending, startTransition] = useTransition();
  const [lastSweep, setLastSweep] = useState<{ triggered: number; at: string } | null>(null);
  const router = useRouter();

  function handleSweep() {
    startTransition(async () => {
      const res = await runEscalationSweep();
      if (res.ok) {
        setLastSweep({ triggered: res.triggered ?? 0, at: new Date().toISOString() });
        router.refresh();
      }
    });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            Automation
          </div>
          <h1 className="font-serif text-4xl tracking-tight">Escalation engine</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Configurable rules detect lapses (sheet not submitted, approval pending, check-ins overdue),
            then route notifications up the org hierarchy after N days.
          </p>
        </div>
        <Button onClick={handleSweep} disabled={pending}>
          <Play className="size-3.5" />
          {pending ? 'Running…' : 'Run sweep now'}
        </Button>
      </div>

      {lastSweep && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-3 flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-400" />
            Sweep complete. {lastSweep.triggered} escalation{lastSweep.triggered === 1 ? '' : 's'} triggered.
            <span className="text-muted-foreground text-xs ml-auto">{fmtRelative(lastSweep.at)}</span>
          </CardContent>
        </Card>
      )}

      {/* Rules */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <GitBranch className="size-4 text-primary" />
            <div className="text-sm font-semibold">Active rules</div>
            <Pill variant="gold" className="ml-2">{rules.filter(r => r.is_active).length}</Pill>
          </div>
          <div className="divide-y divide-border">
            {rules.map(r => (
              <div key={r.id} className="px-5 py-4 flex items-center gap-4">
                <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                  <Clock className="size-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Trigger: <span className="font-mono">{r.trigger_type}</span> · After{' '}
                    <span className="font-mono text-foreground">{r.threshold_days}</span> days
                  </div>
                </div>
                <Pill variant={r.escalate_to === 'HR' ? 'red' : r.escalate_to === 'SkipLevel' ? 'orange' : r.escalate_to === 'Manager' ? 'blue' : 'gray'}>
                  → {r.escalate_to}
                </Pill>
                {r.is_active && <Pill variant="green">Active</Pill>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-orange-400" />
              <div className="text-sm font-semibold">Triggered events</div>
              <Pill variant="orange">{events.filter(e => !e.resolved_at).length} open</Pill>
            </div>
            <div className="text-xs text-muted-foreground">Latest 50</div>
          </div>
          <div className="divide-y divide-border">
            {events.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                No escalations triggered yet. Run a sweep to detect lapses.
              </div>
            ) : (
              events.map(e => (
                <div key={e.id} className="px-5 py-3 flex items-start gap-3">
                  <Avatar name={e.subject?.full_name ?? '?'} id={e.subject_id} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{e.rule?.name}</span>
                      <Pill variant={e.level === 'HR' ? 'red' : e.level === 'Manager' ? 'orange' : 'blue'}>→ {e.level}</Pill>
                      {e.resolved_at && <Pill variant="green">Resolved</Pill>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.subject?.full_name} · {e.subject?.department} · {e.reason}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{fmtRelative(e.triggered_at)}</div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
