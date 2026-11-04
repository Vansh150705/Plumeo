'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAction } from '@/components/use-action';
import { put } from '@/lib/api-client';
import type { OrgPolicy } from '@/lib/policy';

const KINDS = [['target', 'Targets or key results'], ['deadline', 'Dates'], ['owner', 'Ownership'], ['scope', 'Title, description, outcome or alignment']] as const;

export function PolicyForm({ initial, version }: { initial: OrgPolicy; version: number }) {
  const { run, busy, error } = useAction();
  const [p, setP] = useState<OrgPolicy>(initial); const [v, setV] = useState(version);
  const num = (fn: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => fn(Number(e.target.value));
  const set = (fn: (d: OrgPolicy) => void) => setP((cur) => { const d = structuredClone(cur); fn(d); return d; });
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => put<{ version: number }>('/policy', { policy: p, expectedVersion: v }), { success: 'Policies saved and recorded in the audit trail.' }).then((r) => r && setV(r.version)); }}>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}
      <Card><CardHeader className="pb-3"><CardTitle>Approvals</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">How many managers must approve a goal, counted up the reporting line (capped by the managers who exist). Company goals are always approved by the approver pool (HR / administrators), never by the author.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['company', 'department', 'team', 'individual'] as const).map((k) => <Field key={k} label={`${k[0].toUpperCase() + k.slice(1)} goals`} htmlFor={`l-${k}`}><Input id={`l-${k}`} type="number" min={1} max={3} value={p.approval.levels[k]} onChange={num((n) => set((d) => { d.approval.levels[k] = n; }))} /></Field>)}</div>
        <div className="grid grid-cols-2 gap-3"><Field label="Respond within (days)" htmlFor="sla" hint="After this, approvers are reminded"><Input id="sla" type="number" min={1} max={60} value={p.approval.slaDays} onChange={num((n) => set((d) => { d.approval.slaDays = n; }))} /></Field><Field label="Repeat reminder every (days)" htmlFor="rem"><Input id="rem" type="number" min={1} max={30} value={p.approval.reminderEveryDays} onChange={num((n) => set((d) => { d.approval.reminderEveryDays = n; }))} /></Field></div></CardContent></Card>

      <Card><CardHeader className="pb-3"><CardTitle>Amendments to approved goals</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Changes of these kinds must be re-approved. Other changes (priority, weight) apply immediately but are always recorded.</p>
        {KINDS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={p.amendments.requireApprovalFor.includes(k)} onChange={(e) => set((d) => { d.amendments.requireApprovalFor = e.target.checked ? [...d.amendments.requireApprovalFor, k] : d.amendments.requireApprovalFor.filter((x) => x !== k); })} />{l}</label>)}
        <Field label="Deadline moves of up to this many days don't need approval" htmlFor="free"><Input id="free" className="max-w-32" type="number" min={0} max={90} value={p.amendments.deadlineShiftFreeDays} onChange={num((n) => set((d) => { d.amendments.deadlineShiftFreeDays = n; }))} /></Field></CardContent></Card>

      <Card><CardHeader className="pb-3"><CardTitle>Goal quality</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum key results" htmlFor="mink"><Input id="mink" type="number" min={0} max={10} value={p.goals.minKeyResults} onChange={num((n) => set((d) => { d.goals.minKeyResults = n; }))} /></Field>
        <Field label="Maximum key results" htmlFor="maxk"><Input id="maxk" type="number" min={1} max={20} value={p.goals.maxKeyResults} onChange={num((n) => set((d) => { d.goals.maxKeyResults = n; }))} /></Field>
        <Field label="Open individual goals per person" htmlFor="maxg"><Input id="maxg" type="number" min={1} max={100} value={p.goals.maxActiveIndividualGoals} onChange={num((n) => set((d) => { d.goals.maxActiveIndividualGoals = n; }))} /></Field>
        <Field label="Minimum title length" htmlFor="mint"><Input id="mint" type="number" min={3} max={100} value={p.goals.minTitleLength} onChange={num((n) => set((d) => { d.goals.minTitleLength = n; }))} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={p.goals.requireOutcome} onChange={(e) => set((d) => { d.goals.requireOutcome = e.target.checked; })} />Require an expected outcome</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={p.goals.enforceGoalSettingWindow} onChange={(e) => set((d) => { d.goals.enforceGoalSettingWindow = e.target.checked; })} />Only allow submission inside the cycle&apos;s goal-setting window</label></CardContent></Card>

      <Card><CardHeader className="pb-3"><CardTitle>Check-ins</CardTitle></CardHeader><CardContent className="space-y-4">
        <Field label="Remind people this many days before the due date" htmlFor="rd" hint="Comma-separated, e.g. 3, 1, 0"><Input id="rd" defaultValue={p.checkins.reminderDaysBefore.join(', ')} onBlur={(e) => set((d) => { d.checkins.reminderDaysBefore = e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 30).slice(0, 5); })} /></Field>
        <Field label="Repeat overdue reminders every (days)" htmlFor="od"><Input id="od" className="max-w-32" type="number" min={1} max={30} value={p.checkins.overdueReminderEveryDays} onChange={num((n) => set((d) => { d.checkins.overdueReminderEveryDays = n; }))} /></Field>
        <div><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Additional check-in questions</span><Button type="button" size="sm" variant="ghost" disabled={p.checkins.customQuestions.length >= 6} onClick={() => set((d) => { d.checkins.customQuestions.push({ id: `q${d.checkins.customQuestions.length + 1}_${Math.random().toString(36).slice(2, 5)}`, label: '', required: false }); })}><Plus className="size-4" aria-hidden />Add question</Button></div>
          {p.checkins.customQuestions.map((q, i) => <div key={q.id} className="mb-2 flex items-center gap-2"><Input aria-label={`Question ${i + 1}`} placeholder="e.g. What support do you need from leadership?" value={q.label} onChange={(e) => set((d) => { d.checkins.customQuestions[i].label = e.target.value; })} /><label className="flex items-center gap-1 whitespace-nowrap text-xs"><input type="checkbox" className="accent-[hsl(var(--primary))]" checked={q.required} onChange={(e) => set((d) => { d.checkins.customQuestions[i].required = e.target.checked; })} />Required</label><Button type="button" size="icon" variant="ghost" aria-label="Remove question" onClick={() => set((d) => { d.checkins.customQuestions.splice(i, 1); })}><Trash2 className="size-4" aria-hidden /></Button></div>)}</div></CardContent></Card>

      <Card><CardHeader className="pb-3"><CardTitle>Risk signals</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Flag as stalled after (days without activity)" htmlFor="st"><Input id="st" type="number" min={7} max={180} value={p.risk.stalledAfterDays} onChange={num((n) => set((d) => { d.risk.stalledAfterDays = n; }))} /></Field>
        <Field label="At risk when progress trails the plan by more than (points)" htmlFor="tol"><Input id="tol" type="number" min={5} max={50} value={p.risk.atRiskTolerancePoints} onChange={num((n) => set((d) => { d.risk.atRiskTolerancePoints = n; }))} /></Field></CardContent></Card>

      <Card><CardHeader className="pb-3"><CardTitle>Security &amp; AI</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Sign out after inactivity (minutes)" htmlFor="idle"><Input id="idle" type="number" min={15} max={1440} value={p.security.sessionIdleMinutes} onChange={num((n) => set((d) => { d.security.sessionIdleMinutes = n; }))} /></Field>
        <Field label="Maximum session length (hours)" htmlFor="max"><Input id="max" type="number" min={1} max={720} value={p.security.sessionMaxHours} onChange={num((n) => set((d) => { d.security.sessionMaxHours = n; }))} /></Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={p.ai.enabled} onChange={(e) => set((d) => { d.ai.enabled = e.target.checked; })} /><span>Enable AI writing assistance<span className="block text-xs text-muted-foreground">Suggests clearer goal wording and drafts feedback. Suggestions are always editable and never approve, rate or decide anything. Only goal text is sent to the AI provider — no names or email addresses. Requires the server to have an AI key configured.</span></span></label></CardContent></Card>
      <div className="sticky bottom-4 flex justify-end"><Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving…' : 'Save policies'}</Button></div>
    </form>
  );
}
