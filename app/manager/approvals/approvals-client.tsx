'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Pill, StatusPill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle2, RotateCcw, AlertCircle, Send, Lock } from 'lucide-react';
import { approveSheet, returnSheet, upsertGoal } from '@/lib/actions';
import { validateSheet, totalWeightage, formatTarget, uomLabel, MIN_WEIGHTAGE, MAX_GOALS_PER_SHEET } from '@/lib/goals';
import type { Goal, GoalSheet, Cycle, AppUser } from '@/lib/types';
import { fmtDate, fmtRelative, cn } from '@/lib/utils';

type SheetWithGoals = GoalSheet & { goals: Goal[]; employee: AppUser };

export function ApprovalsClient({
  sheets, cycle, thrustAreas,
}: {
  sheets: SheetWithGoals[];
  cycle: Cycle;
  thrustAreas: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    sheets.find(s => s.status === 'Submitted')?.id ?? sheets[0]?.id ?? null,
  );
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [pending, startTransition] = useTransition();
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Goal>>({});
  const router = useRouter();

  const selected = sheets.find(s => s.id === selectedId);

  // Sort: Submitted first, then others
  const sortedSheets = [...sheets].sort((a, b) => {
    const order: Record<string, number> = { Submitted: 0, Returned: 1, Draft: 2, Approved: 3, Locked: 4 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  function handleApprove() {
    if (!selected) return;
    if (!confirm(`Approve ${selected.employee.full_name}'s goal sheet? This will lock it for the cycle.`)) return;
    startTransition(async () => {
      await approveSheet(selected.id);
      router.refresh();
    });
  }

  function handleReturn() {
    if (!selected || !returnComment.trim()) return;
    startTransition(async () => {
      await returnSheet(selected.id, returnComment);
      setReturnOpen(false);
      setReturnComment('');
      router.refresh();
    });
  }

  function startEdit(goal: Goal) {
    setEditingGoalId(goal.id);
    setEditForm(goal);
  }

  function saveEdit() {
    if (!editingGoalId) return;
    startTransition(async () => {
      await upsertGoal({ ...editForm, id: editingGoalId, sheet_id: selected!.id });
      setEditingGoalId(null);
      router.refresh();
    });
  }

  const selectedIssues = selected ? validateSheet(selected.goals) : [];
  const selectedTotal = selected ? totalWeightage(selected.goals) : 0;
  const submittedCount = sheets.filter(s => s.status === 'Submitted').length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="w-80 shrink-0 border-r border-border bg-card/50 overflow-y-auto">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Approvals queue</div>
          <div className="font-serif text-xl">
            {submittedCount} pending <span className="text-muted-foreground text-sm">of {sheets.length}</span>
          </div>
        </div>
        <div className="divide-y divide-border">
          {sortedSheets.map(s => {
            const isSel = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={cn('w-full px-5 py-3 text-left hover:bg-accent transition flex items-center gap-3', isSel && 'bg-accent')}
              >
                <Avatar name={s.employee.full_name} id={s.employee.id} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.employee.full_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.goals.length} goal{s.goals.length === 1 ? '' : 's'} · {totalWeightage(s.goals)}%
                    {s.submitted_at && ` · ${fmtRelative(s.submitted_at)}`}
                  </div>
                </div>
                <StatusPill status={s.status} />
              </button>
            );
          })}
          {sheets.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No sheets to review yet.
            </div>
          )}
        </div>
      </aside>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Select a sheet to review.
          </div>
        ) : (
          <div className="p-8 max-w-4xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <Avatar name={selected.employee.full_name} id={selected.employee.id} size={56} />
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                    {selected.employee.department} · {selected.employee.upn}
                  </div>
                  <h1 className="font-serif text-3xl tracking-tight">{selected.employee.full_name}</h1>
                  <div className="text-sm text-muted-foreground mt-1">
                    {cycle.name} · {selected.submitted_at ? `Submitted ${fmtRelative(selected.submitted_at)}` : 'Not submitted yet'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={selected.status} />
                {selected.locked_at && <Pill variant="gold"><Lock className="size-3" /> Locked</Pill>}
              </div>
            </div>

            {/* Summary strip */}
            <Card>
              <CardContent className="p-4 grid grid-cols-3 gap-4">
                <Stat label="Goals" value={`${selected.goals.length} / ${MAX_GOALS_PER_SHEET}`} />
                <Stat label="Total weightage" value={`${selectedTotal}%`} highlight={selectedTotal === 100} />
                <Stat label="Validation" value={selectedIssues.length === 0 ? 'Clean' : `${selectedIssues.length} issue${selectedIssues.length === 1 ? '' : 's'}`} highlight={selectedIssues.length === 0} />
              </CardContent>
            </Card>

            {/* Returned reason */}
            {selected.status === 'Returned' && selected.return_comment && (
              <Card className="border-orange-500/30 bg-orange-500/5">
                <CardContent className="p-4 flex gap-3">
                  <AlertCircle className="size-4 text-orange-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium mb-1">You returned this sheet with:</div>
                    <div className="text-sm text-muted-foreground">{selected.return_comment}</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Goals */}
            <div className="space-y-2">
              {selected.goals.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No goals defined yet.</CardContent></Card>
              ) : (
                selected.goals.map(goal => (
                  <Card key={goal.id} className="group hover:border-primary/20">
                    <CardContent className="p-4">
                      {editingGoalId === goal.id ? (
                        <div className="space-y-3">
                          <div className="grid md:grid-cols-2 gap-3">
                            <div>
                              <Label>Title</Label>
                              <input
                                value={editForm.title ?? ''}
                                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                              />
                            </div>
                            <div>
                              <Label>Weightage (%)</Label>
                              <input
                                type="number"
                                value={editForm.weightage ?? 0}
                                onChange={e => setEditForm({ ...editForm, weightage: Number(e.target.value) })}
                                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <Label>Description</Label>
                            <Textarea
                              value={editForm.description ?? ''}
                              onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                              rows={2}
                            />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setEditingGoalId(null)}>Cancel</Button>
                            <Button size="sm" onClick={saveEdit} disabled={pending}>Save inline edit</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-4">
                          <div className="shrink-0">
                            <div className="size-11 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                              <span className="font-serif text-xl text-primary tabular-nums">{goal.weightage}</span>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <Pill variant="gray">{goal.thrust_area}</Pill>
                              <Pill variant="blue">{uomLabel(goal.uom, goal.direction)}</Pill>
                              {goal.shared_origin_id && <Pill variant="purple">Shared</Pill>}
                            </div>
                            <div className="text-base font-medium">{goal.title}</div>
                            {goal.description && (
                              <div className="text-sm text-muted-foreground mt-1">{goal.description}</div>
                            )}
                            <div className="text-xs text-muted-foreground mt-2">
                              Target: <span className="text-foreground">{formatTarget(goal)}</span>
                            </div>
                          </div>
                          {selected.status === 'Submitted' && (
                            <Button variant="ghost" size="sm" onClick={() => startEdit(goal)} className="opacity-0 group-hover:opacity-100 transition">
                              Inline edit
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {/* Actions */}
            {selected.status === 'Submitted' && (
              <Card className="sticky bottom-4 border-primary/20 bg-card/95 backdrop-blur-sm shadow-2xl">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Approve to lock this sheet for {cycle.name}, or return it with a comment.
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setReturnOpen(true)} disabled={pending}>
                      <RotateCcw className="size-3.5" /> Return for rework
                    </Button>
                    <Button onClick={handleApprove} disabled={pending}>
                      <CheckCircle2 className="size-3.5" /> Approve & lock
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Return modal */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return sheet for rework</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Comment to the employee (required)</Label>
            <Textarea
              value={returnComment}
              onChange={e => setReturnComment(e.target.value)}
              placeholder="What needs to change before this can be approved…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button onClick={handleReturn} disabled={!returnComment.trim() || pending}>
              <Send className="size-3.5" /> Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn('font-serif text-2xl mt-0.5', highlight && 'text-emerald-400')}>{value}</div>
    </div>
  );
}
