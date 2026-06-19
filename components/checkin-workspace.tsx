'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { Pill, ProgressPill, StatusPill } from '@/components/ui/pill';
import { Save, Lock, MessageSquare, CheckCircle2, AlertTriangle, Calendar } from 'lucide-react';
import { upsertCheckIn, managerCheckIn } from '@/lib/actions';
import { computeScore, formatTarget, uomLabel } from '@/lib/goals';
import type { Goal, CheckIn, CheckInQuarter, Cycle, GoalProgress, SheetStatus, UserRole } from '@/lib/types';
import { cn, fmtDate, fmtDateTime } from '@/lib/utils';

const QUARTERS: CheckInQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

export function CheckInWorkspace({
  goals,
  checkIns: initialCheckIns,
  currentQuarter,
  cycle,
  sheetStatus,
  viewerRole,
  employeeName,
}: {
  goals: Goal[];
  checkIns: CheckIn[];
  currentQuarter: CheckInQuarter;
  cycle: Cycle;
  sheetStatus: SheetStatus;
  viewerRole: UserRole;
  employeeName?: string;
}) {
  const [quarter, setQuarter] = useState<CheckInQuarter>(currentQuarter);
  const [checkIns, setCheckIns] = useState<CheckIn[]>(initialCheckIns);

  const sheetUnlocked = sheetStatus !== 'Approved' && sheetStatus !== 'Locked';

  function getCheckIn(goalId: string, q: CheckInQuarter) {
    return checkIns.find(c => c.goal_id === goalId && c.quarter === q);
  }

  function upsertLocal(c: CheckIn) {
    setCheckIns(prev => {
      const idx = prev.findIndex(p => p.id === c.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = c; return next; }
      return [...prev, c];
    });
  }

  // Sheet-level score for selected quarter
  const sheetScore = (() => {
    let weightedSum = 0, weightedTotal = 0, scored = 0;
    for (const g of goals) {
      const ci = getCheckIn(g.id, quarter);
      if (!ci) continue;
      const s = computeScore(g, ci);
      if (s == null) continue;
      weightedSum += s * g.weightage;
      weightedTotal += g.weightage;
      scored++;
    }
    if (weightedTotal === 0) return { score: null, coverage: 0, scoredCount: 0 };
    return { score: weightedSum / weightedTotal, coverage: weightedTotal, scoredCount: scored };
  })();

  // Helper: lookup cycle quarter dates for header banner
  const quarterDates: Record<CheckInQuarter, { open: string; close: string }> = {
    Q1: { open: cycle.q1_open, close: cycle.q1_close },
    Q2: { open: cycle.q2_open, close: cycle.q2_close },
    Q3: { open: cycle.q3_open, close: cycle.q3_close },
    Q4: { open: cycle.q4_open, close: cycle.q4_close },
  };

  if (!sheetUnlocked && goals.length === 0) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          No goals to check in on yet.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            {employeeName ? `${employeeName} · ` : ''}Quarterly check-ins
          </div>
          <h1 className="font-serif text-4xl tracking-tight">{cycle.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={sheetStatus} />
          {sheetStatus === 'Approved' || sheetStatus === 'Locked' ? (
            <Pill variant="gold"><Lock className="size-3" /> Goals locked · capture only</Pill>
          ) : null}
        </div>
      </div>

      {/* Quarter selector */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-4 gap-1">
            {QUARTERS.map(q => {
              const active = q === quarter;
              const isCurrent = q === currentQuarter;
              return (
                <button
                  key={q}
                  onClick={() => setQuarter(q)}
                  className={cn(
                    'relative px-4 py-3 rounded-lg text-sm font-medium transition-all',
                    active
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'text-muted-foreground hover:bg-accent border border-transparent',
                  )}
                >
                  <div className="text-base">{q}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {fmtDate(quarterDates[q].open)} – {fmtDate(quarterDates[q].close)}
                  </div>
                  {isCurrent && (
                    <span className="absolute top-2 right-2 size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quarter summary card */}
      <div className="grid md:grid-cols-3 gap-3">
        <SummaryCard
          label="Goals scored"
          value={`${sheetScore.scoredCount} / ${goals.length}`}
          hint={`${quarter} achievement captured`}
        />
        <SummaryCard
          label="Coverage"
          value={`${sheetScore.coverage}%`}
          hint="Total weightage with check-ins"
        />
        <SummaryCard
          label={`${quarter} weighted score`}
          value={sheetScore.score == null ? '·' : `${Math.round(sheetScore.score)}`}
          hint="Across scored goals"
          highlight={sheetScore.score != null && sheetScore.score >= 90}
        />
      </div>

      {/* Goal rows */}
      <div className="space-y-3">
        {goals.map(goal => (
          <CheckInRow
            key={goal.id}
            goal={goal}
            checkIn={getCheckIn(goal.id, quarter)}
            quarter={quarter}
            viewerRole={viewerRole}
            onSaved={upsertLocal}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, hint, highlight,
}: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className={cn('font-serif text-3xl mt-1 tabular-nums', highlight && 'text-primary')}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// one row per goal; copes with all four unit-of-measure types
// =============================================================================
function CheckInRow({
  goal, checkIn, quarter, viewerRole, onSaved,
}: {
  goal: Goal;
  checkIn: CheckIn | undefined;
  quarter: CheckInQuarter;
  viewerRole: UserRole;
  onSaved: (c: CheckIn) => void;
}) {
  const [actualNumeric, setActualNumeric] = useState<string>(checkIn?.actual_numeric != null ? String(checkIn.actual_numeric) : '');
  const [actualDate, setActualDate] = useState<string>(checkIn?.actual_date ?? '');
  const [zeroAchieved, setZeroAchieved] = useState<boolean | null>(checkIn?.zero_achieved ?? null);
  const [status, setStatus] = useState<GoalProgress>(checkIn?.progress_status ?? 'NotStarted');
  const [empComment, setEmpComment] = useState<string>(checkIn?.employee_comment ?? '');
  const [mgrComment, setMgrComment] = useState<string>(checkIn?.manager_comment ?? '');
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isEmployee = viewerRole === 'Employee';
  const isManager = viewerRole === 'Manager' || viewerRole === 'Admin';

  // Live preview score
  const previewScore = computeScore(goal, {
    actual_numeric: actualNumeric === '' ? null : Number(actualNumeric),
    actual_date: actualDate || null,
    zero_achieved: zeroAchieved,
  });

  const isShared = !!goal.shared_origin_id;

  function handleSave() {
    startTransition(async () => {
      const res = await upsertCheckIn({
        goal_id: goal.id,
        quarter,
        actual_numeric: actualNumeric === '' ? null : Number(actualNumeric),
        actual_date: actualDate || null,
        zero_achieved: zeroAchieved,
        progress_status: status,
        employee_comment: empComment || null,
      });
      if (res.ok && res.check_in) {
        onSaved(res.check_in);
        setSavedAt(new Date().toISOString());
      }
    });
  }

  function handleManagerSave() {
    if (!checkIn) return;
    startTransition(async () => {
      await managerCheckIn(checkIn.id, mgrComment);
      setSavedAt(new Date().toISOString());
    });
  }

  return (
    <Card className={cn('hover:border-primary/20 transition', isShared && 'border-purple-500/20')}>
      <CardContent className="p-5">
        {/* Header row */}
        <div className="flex items-start gap-4 mb-4">
          <div className="shrink-0">
            <div className="size-12 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
              <span className="font-serif text-2xl text-primary tabular-nums">{goal.weightage}</span>
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-1 uppercase tracking-wider">weight</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Pill variant="gray">{goal.thrust_area}</Pill>
              <Pill variant="blue">{uomLabel(goal.uom, goal.direction)}</Pill>
              {isShared && <Pill variant="purple">Shared goal</Pill>}
              <ProgressPill status={status} />
            </div>
            <div className="text-base font-medium">{goal.title}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Target: <span className="text-foreground font-medium">{formatTarget(goal)}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{quarter} score</div>
            <div className={cn(
              'font-serif text-3xl tabular-nums',
              previewScore == null ? 'text-muted-foreground' : previewScore >= 80 ? 'text-emerald-400' : previewScore >= 50 ? 'text-primary' : 'text-orange-400',
            )}>
              {previewScore == null ? '·' : Math.round(previewScore)}
            </div>
          </div>
        </div>

        {/* Capture row */}
        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 mb-3">
          {/* Actual input by UoM */}
          {goal.uom === 'Zero' ? (
            <div>
              <Label>Zero achieved this quarter?</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setZeroAchieved(true)}
                  disabled={!isEmployee}
                  className={cn(
                    'h-9 rounded-lg border text-sm font-medium transition',
                    zeroAchieved === true
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  Yes, 0 incidents
                </button>
                <button
                  onClick={() => setZeroAchieved(false)}
                  disabled={!isEmployee}
                  className={cn(
                    'h-9 rounded-lg border text-sm font-medium transition',
                    zeroAchieved === false
                      ? 'bg-red-500/15 text-red-400 border-red-500/30'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  No
                </button>
              </div>
            </div>
          ) : goal.uom === 'Timeline' ? (
            <div>
              <Label>Actual completion date</Label>
              <Input
                type="date"
                value={actualDate}
                onChange={e => setActualDate(e.target.value)}
                disabled={!isEmployee}
              />
            </div>
          ) : (
            <div>
              <Label>Achievement (Actual)</Label>
              <div className="relative">
                <Input
                  type="number"
                  value={actualNumeric}
                  onChange={e => setActualNumeric(e.target.value)}
                  placeholder={goal.uom === 'Percentage' ? 'e.g. 82' : 'e.g. 3850000'}
                  disabled={!isEmployee}
                />
                {goal.uom === 'Percentage' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                )}
              </div>
            </div>
          )}

          <div>
            <Label>Status</Label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as GoalProgress)}
              disabled={!isEmployee}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="NotStarted">Not started</option>
              <option value="OnTrack">On track</option>
              <option value="AtRisk">At risk</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          {isEmployee && (
            <div className="flex items-end">
              <Button onClick={handleSave} disabled={pending}>
                <Save className="size-3.5" />
                {pending ? 'Saving…' : 'Save check-in'}
              </Button>
            </div>
          )}
        </div>

        {/* Employee comment */}
        <div className="mb-3">
          <Label>Your comment {!isEmployee && '(employee)'}</Label>
          <Textarea
            value={empComment}
            onChange={e => setEmpComment(e.target.value)}
            placeholder="Context, blockers, asks…"
            disabled={!isEmployee}
            rows={2}
          />
        </div>

        {/* manager comment: everyone can see it, only managers and admins can edit */}
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="size-3.5 text-primary" />
            <span className="text-xs font-medium">Manager check-in</span>
            {checkIn?.manager_checked_at && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                Reviewed {fmtDateTime(checkIn.manager_checked_at)}
              </span>
            )}
          </div>
          {isManager ? (
            <>
              <Textarea
                value={mgrComment}
                onChange={e => setMgrComment(e.target.value)}
                placeholder="Coaching note, course-correction, recognition…"
                rows={2}
                className="mb-2"
              />
              <Button size="sm" variant="secondary" onClick={handleManagerSave} disabled={pending || !checkIn}>
                <Save className="size-3" /> Save manager note
              </Button>
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              {checkIn?.manager_comment || 'No manager note yet.'}
            </div>
          )}
        </div>

        {savedAt && (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="size-3" /> Saved {fmtDateTime(savedAt)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
