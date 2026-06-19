'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { StatusPill, Pill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Lock, Save, AlertCircle, CheckCircle2, Send, Pencil, Info } from 'lucide-react';
import { upsertGoal, deleteGoal, submitSheet } from '@/lib/actions';
import { validateSheet, totalWeightage, MAX_GOALS_PER_SHEET, REQUIRED_TOTAL_WEIGHTAGE, MIN_WEIGHTAGE, formatTarget, uomLabel } from '@/lib/goals';
import type { Goal, GoalSheet, Cycle } from '@/lib/types';
import { cn, fmtDate } from '@/lib/utils';

export function GoalSheetEditor({
  sheet,
  goals: initialGoals,
  cycle,
  thrustAreas,
  readOnly,
}: {
  sheet: GoalSheet;
  goals: Goal[];
  cycle: Cycle;
  thrustAreas: string[];
  readOnly: boolean;
}) {
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const issues = useMemo(() => validateSheet(goals), [goals]);
  const total = totalWeightage(goals);
  const canSubmit = issues.length === 0;
  const locked = readOnly || sheet.status === 'Approved' || sheet.status === 'Locked';
  const remainingPct = REQUIRED_TOTAL_WEIGHTAGE - total;

  async function handleUpsert(g: Partial<Goal>) {
    const res = await upsertGoal({ ...g, sheet_id: sheet.id });
    if (res.ok && res.goal) {
      setGoals(prev => {
        const idx = prev.findIndex(p => p.id === res.goal!.id);
        if (idx >= 0) {
          const next = [...prev]; next[idx] = res.goal!; return next;
        }
        return [...prev, res.goal!];
      });
    }
    setEditingId(null);
    setAddingNew(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this goal?')) return;
    const res = await deleteGoal(id);
    if (res.ok) setGoals(prev => prev.filter(g => g.id !== id));
  }

  async function handleSubmit() {
    startTransition(async () => {
      const res = await submitSheet(sheet.id);
      if (!res.ok) {
        alert('Submission failed:\n\n' + (res.issues?.map(i => '• ' + i.message).join('\n') ?? 'Unknown error'));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Goal sheet</div>
          <h1 className="font-serif text-4xl tracking-tight">{cycle.name}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            Window: {fmtDate(cycle.goal_window_start)} → {fmtDate(cycle.goal_window_end)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={sheet.status} />
          {sheet.locked_at && (
            <Pill variant="gold"><Lock className="size-3" /> Locked {fmtDate(sheet.locked_at)}</Pill>
          )}
        </div>
      </div>

      {/* Return-comment alert */}
      {sheet.status === 'Returned' && sheet.return_comment && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-4 flex gap-3">
            <AlertCircle className="size-4 text-orange-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium mb-1">Returned for rework</div>
              <div className="text-sm text-muted-foreground">{sheet.return_comment}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weightage dial + summary */}
      <Card>
        <CardContent className="p-6">
          <div className="grid md:grid-cols-[200px_1fr] gap-6 items-center">
            <WeightageDial total={total} />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Sheet summary</div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl font-serif">{goals.length}<span className="text-muted-foreground text-base"> / {MAX_GOALS_PER_SHEET}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">Goals defined</div>
                </div>
                <div>
                  <div className="text-2xl font-serif">{total}<span className="text-muted-foreground text-base">%</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">Total weightage</div>
                </div>
                <div>
                  <div className={cn('text-2xl font-serif', remainingPct === 0 ? 'text-primary' : 'text-muted-foreground')}>
                    {remainingPct > 0 ? `+${remainingPct}` : remainingPct}
                    <span className="text-base">%</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Remaining</div>
                </div>
              </div>
              {issues.length > 0 && (
                <div className="mt-4 space-y-1">
                  {issues.slice(0, 4).map((iss, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-orange-400">
                      <AlertCircle className="size-3 mt-0.5 shrink-0" />
                      <span>{iss.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {issues.length === 0 && goals.length > 0 && (
                <div className="mt-4 flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  All checks passed. Ready to submit.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Goals list */}
      <div className="space-y-3">
        {goals.length === 0 && !addingNew && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <div className="font-serif text-2xl mb-2">No goals yet</div>
              <div className="text-sm text-muted-foreground mb-4">
                Start by adding your first goal for this cycle.
              </div>
              <Button onClick={() => setAddingNew(true)} disabled={locked}>
                <Plus className="size-4" /> Add first goal
              </Button>
            </CardContent>
          </Card>
        )}

        {goals.map(goal => (
          <GoalRow
            key={goal.id}
            goal={goal}
            editing={editingId === goal.id}
            locked={locked}
            thrustAreas={thrustAreas}
            onEdit={() => setEditingId(goal.id)}
            onCancel={() => setEditingId(null)}
            onSave={handleUpsert}
            onDelete={() => handleDelete(goal.id)}
            otherWeightage={total - goal.weightage}
          />
        ))}

        {addingNew && (
          <GoalRow
            goal={null}
            editing
            locked={locked}
            thrustAreas={thrustAreas}
            onEdit={() => {}}
            onCancel={() => setAddingNew(false)}
            onSave={handleUpsert}
            onDelete={() => {}}
            otherWeightage={total}
          />
        )}

        {!addingNew && goals.length > 0 && goals.length < MAX_GOALS_PER_SHEET && !locked && (
          <button
            onClick={() => setAddingNew(true)}
            className="w-full p-4 rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-accent/50 transition flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" /> Add another goal ({MAX_GOALS_PER_SHEET - goals.length} remaining)
          </button>
        )}
      </div>

      {/* Submit footer */}
      {!locked && goals.length > 0 && (
        <div className="sticky bottom-4 z-20">
          <Card className="border-primary/20 bg-card/95 backdrop-blur-sm shadow-2xl">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-sm">
                {canSubmit ? (
                  <>
                    <div className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-muted-foreground">Ready to send to your manager</span>
                  </>
                ) : (
                  <>
                    <div className="size-2 rounded-full bg-orange-400" />
                    <span className="text-muted-foreground">
                      Fix {issues.length} issue{issues.length === 1 ? '' : 's'} before submitting
                    </span>
                  </>
                )}
              </div>
              <Button onClick={handleSubmit} disabled={!canSubmit || pending} size="lg">
                <Send className="size-4" />
                {pending ? 'Submitting…' : 'Submit for approval'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// the weightage dial: an animated SVG donut
// =============================================================================
function WeightageDial({ total }: { total: number }) {
  const pct = Math.min(total, 100);
  const overshoot = total > 100;
  const circumference = 2 * Math.PI * 56;
  const offset = circumference - (pct / 100) * circumference;
  const color = total === 100 ? 'rgb(74 222 128)' : overshoot ? 'rgb(248 113 113)' : 'rgb(240 180 41)';

  return (
    <div className="relative size-40 mx-auto">
      <svg className="size-40 -rotate-90" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="56" stroke="hsl(var(--muted))" strokeWidth="10" fill="none" />
        <circle
          cx="64" cy="64" r="56"
          stroke={color} strokeWidth="10" fill="none" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-serif text-4xl tabular-nums" style={{ color }}>{total}%</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Weightage</div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// one goal row, with a collapsed view state and an expanded edit state
// =============================================================================
function GoalRow({
  goal, editing, locked, thrustAreas, otherWeightage,
  onEdit, onCancel, onSave, onDelete,
}: {
  goal: Goal | null;
  editing: boolean;
  locked: boolean;
  thrustAreas: string[];
  otherWeightage: number;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (g: Partial<Goal>) => void | Promise<void>;
  onDelete: () => void;
}) {
  // Edit-state local form
  const [form, setForm] = useState<Partial<Goal>>(
    goal ?? {
      thrust_area: thrustAreas[0] ?? '',
      title: '', description: '', uom: 'Numeric', direction: 'min',
      target_numeric: 0, target_date: null, weightage: Math.max(MIN_WEIGHTAGE, 100 - otherWeightage),
    } as Partial<Goal>,
  );

  const isSharedClone = !!goal?.shared_origin_id;
  const cantEditCore = locked || isSharedClone;

  if (!editing && goal) {
    return (
      <Card className={cn('hover:border-primary/30 transition group', isSharedClone && 'border-purple-500/30')}>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <div className="size-12 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                <span className="font-serif text-2xl text-primary tabular-nums">{goal.weightage}</span>
              </div>
              <div className="text-[10px] text-center text-muted-foreground mt-1 uppercase tracking-wider">weight</div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Pill variant="gray">{goal.thrust_area}</Pill>
                <Pill variant="blue">{uomLabel(goal.uom, goal.direction)}</Pill>
                {isSharedClone && <Pill variant="purple">Shared</Pill>}
                {goal.is_shared_origin && <Pill variant="gold">Owner</Pill>}
              </div>
              <div className="text-base font-medium leading-snug mb-1">{goal.title}</div>
              {goal.description && (
                <div className="text-sm text-muted-foreground line-clamp-2">{goal.description}</div>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span>Target: <span className="text-foreground font-medium">{formatTarget(goal)}</span></span>
              </div>
            </div>

            {!locked && (
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="size-3.5" /></Button>
                {!isSharedClone && (
                  <Button variant="ghost" size="icon" onClick={onDelete}><Trash2 className="size-3.5 text-red-400" /></Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Editing
  return (
    <Card className="border-primary/30 shadow-lg shadow-primary/5 animate-fade-in">
      <CardContent className="p-5">
        {isSharedClone && (
          <div className="mb-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 flex gap-2 text-xs">
            <Info className="size-4 text-purple-400 shrink-0" />
            <span className="text-muted-foreground">
              This is a shared goal pushed by your manager. You can only adjust its <span className="text-foreground font-medium">weightage</span>;
              title and target are read-only.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <Label>Thrust area</Label>
            <select
              value={form.thrust_area ?? ''}
              onChange={e => setForm({ ...form, thrust_area: e.target.value })}
              disabled={cantEditCore}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              {thrustAreas.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Goal title</Label>
            <Input
              value={form.title ?? ''}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Achieve ₹4 Cr ARR by Q4"
              disabled={cantEditCore}
            />
          </div>
          <div>
            <Label>Weightage (%)</Label>
            <Input
              type="number"
              min={MIN_WEIGHTAGE} max={100 - otherWeightage}
              value={form.weightage ?? 0}
              onChange={e => setForm({ ...form, weightage: Number(e.target.value) })}
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              {otherWeightage}% used by other goals
            </div>
          </div>
        </div>

        <div className="mb-3">
          <Label>Description</Label>
          <Textarea
            value={form.description ?? ''}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Context, success criteria, dependencies…"
            disabled={cantEditCore}
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <Label>UoM type</Label>
            <select
              value={`${form.uom}|${form.direction}`}
              onChange={e => {
                const [uom, direction] = e.target.value.split('|') as [Goal['uom'], Goal['direction']];
                setForm({ ...form, uom, direction });
              }}
              disabled={cantEditCore}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="Numeric|min">Numeric (higher is better)</option>
              <option value="Numeric|max">Numeric (lower is better)</option>
              <option value="Percentage|min">Percentage (higher is better)</option>
              <option value="Percentage|max">Percentage (lower is better)</option>
              <option value="Timeline|timeline">Timeline (date based)</option>
              <option value="Zero|zero">Zero-based (0 = success)</option>
            </select>
          </div>
          {form.uom === 'Timeline' ? (
            <div>
              <Label>Deadline</Label>
              <Input
                type="date"
                value={form.target_date ?? ''}
                onChange={e => setForm({ ...form, target_date: e.target.value })}
                disabled={cantEditCore}
              />
            </div>
          ) : form.uom === 'Zero' ? (
            <div>
              <Label>Target</Label>
              <Input value="0" disabled />
              <div className="text-[10px] text-muted-foreground mt-1">Zero = success</div>
            </div>
          ) : (
            <div>
              <Label>Target value</Label>
              <Input
                type="number"
                value={form.target_numeric ?? ''}
                onChange={e => setForm({ ...form, target_numeric: Number(e.target.value) })}
                placeholder={form.uom === 'Percentage' ? 'e.g. 85' : 'e.g. 4200000'}
                disabled={cantEditCore}
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onSave(form)}>
            <Save className="size-3.5" />
            {goal ? 'Save changes' : 'Add goal'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
