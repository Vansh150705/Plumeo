'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { CheckCircle2, Share2 } from 'lucide-react';
import { pushSharedGoal } from '@/lib/actions';
import { formatTarget, uomLabel } from '@/lib/goals';
import type { Goal, AppUser } from '@/lib/types';
import { cn } from '@/lib/utils';

export function SharedGoalsClient({ myGoals, reports }: { myGoals: Goal[]; reports: AppUser[] }) {
  const [pickedGoalId, setPickedGoalId] = useState<string | null>(myGoals[0]?.id ?? null);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [weightage, setWeightage] = useState(20);
  const [pending, startTransition] = useTransition();
  const [pushed, setPushed] = useState<{ count: number } | null>(null);
  const router = useRouter();

  function toggle(id: string) {
    setSelectedRecipients(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedRecipients(new Set(reports.map(r => r.id)));
  }

  function handlePush() {
    if (!pickedGoalId || selectedRecipients.size === 0) return;
    startTransition(async () => {
      const res = await pushSharedGoal({
        origin_goal_id: pickedGoalId,
        recipient_employee_ids: Array.from(selectedRecipients),
        default_weightage: weightage,
      });
      if (res.ok) {
        setPushed({ count: selectedRecipients.size });
        setSelectedRecipients(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Cascade departmental KPIs</div>
        <h1 className="font-serif text-4xl tracking-tight">Shared goals</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Push a goal from your own sheet to one or more direct reports in a single action.
          Recipients can adjust weightage only; title and target stay synced with your master copy.
        </p>
      </div>

      {pushed && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-400" />
            <div className="text-sm">
              Goal pushed to <span className="font-semibold">{pushed.count}</span> report{pushed.count === 1 ? '' : 's'}.
              Each has been notified in-app.
            </div>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPushed(null)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5">
        {/* step 1: pick a goal */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="size-6 rounded-full bg-primary/15 text-primary grid place-items-center text-[11px] font-semibold">1</div>
              <div className="text-sm font-medium">Pick a goal from your sheet</div>
            </div>
            {myGoals.length === 0 ? (
              <div className="text-sm text-muted-foreground p-6 text-center border border-dashed border-border rounded-lg">
                You don&apos;t have any goals on your own sheet yet. Add some first, then cascade them.
              </div>
            ) : (
              <div className="space-y-2">
                {myGoals.map(g => {
                  const picked = g.id === pickedGoalId;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setPickedGoalId(g.id)}
                      className={cn(
                        'w-full p-3 rounded-lg border text-left transition',
                        picked ? 'border-primary/40 bg-primary/5' : 'border-border bg-background hover:bg-accent',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Pill variant="gray">{g.thrust_area}</Pill>
                        <Pill variant="blue">{uomLabel(g.uom, g.direction)}</Pill>
                        <span className="ml-auto text-xs text-muted-foreground">Master weight: {g.weightage}%</span>
                      </div>
                      <div className="text-sm font-medium">{g.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Target: {formatTarget(g)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* step 2: choose recipients */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="size-6 rounded-full bg-primary/15 text-primary grid place-items-center text-[11px] font-semibold">2</div>
                <div className="text-sm font-medium">Select recipients</div>
              </div>
              <button onClick={selectAll} className="text-xs text-primary hover:underline">Select all</button>
            </div>
            <div className="space-y-1.5">
              {reports.map(r => {
                const sel = selectedRecipients.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => toggle(r.id)}
                    className={cn(
                      'w-full flex items-center gap-3 p-2.5 rounded-lg border transition text-left',
                      sel ? 'border-primary/40 bg-primary/5' : 'border-border bg-background hover:bg-accent',
                    )}
                  >
                    <div className={cn(
                      'size-4 rounded border grid place-items-center transition',
                      sel ? 'bg-primary border-primary' : 'border-border',
                    )}>
                      {sel && <CheckCircle2 className="size-3 text-primary-foreground" />}
                    </div>
                    <Avatar name={r.full_name} id={r.id} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.full_name}</div>
                      <div className="text-xs text-muted-foreground">{r.department}</div>
                    </div>
                  </button>
                );
              })}
              {reports.length === 0 && (
                <div className="text-sm text-muted-foreground p-6 text-center border border-dashed border-border rounded-lg">
                  No direct reports in the demo directory.
                </div>
              )}
            </div>

            {/* step 3: set each recipient's weightage */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <div className="size-6 rounded-full bg-primary/15 text-primary grid place-items-center text-[11px] font-semibold">3</div>
                <div className="text-sm font-medium">Default weightage on each recipient</div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={10}
                  max={100}
                  value={weightage}
                  onChange={e => setWeightage(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">% (recipients can re-balance after receiving)</span>
              </div>
            </div>

            <Button
              className="w-full mt-5"
              size="lg"
              onClick={handlePush}
              disabled={!pickedGoalId || selectedRecipients.size === 0 || pending}
            >
              <Share2 className="size-4" />
              Push to {selectedRecipients.size} {selectedRecipients.size === 1 ? 'person' : 'people'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
