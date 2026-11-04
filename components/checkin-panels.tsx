'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { useAction } from '@/components/use-action';
import { patch, post, put, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/utils';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export function ActionItemList({ items }: { items: any[] }) {
  const { run, busy } = useAction();
  return (
    <ul className="divide-y divide-border">{items.map((a) => (
      <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
        <input type="checkbox" aria-label={`Mark "${a.title}" done`} className="size-4 accent-[hsl(var(--primary))]" disabled={busy} checked={a.status === 'done'} onChange={(e) => run(() => patch(`/checkins/action-items/${a.id}`, { status: e.target.checked ? 'done' : 'open' }))} />
        <span className={`min-w-0 flex-1 ${a.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{a.title}</span>{a.due_date && <span className="text-xs text-muted-foreground">Due {fmtDate(a.due_date)}</span>}
      </li>))}</ul>
  );
}

/** The check-in form: measurable progress per key result + reflection, with autosaved drafts. */
export function CheckinForm({ goalId, periodId, krs, draft, questions, locked, aiEnabled }: { goalId: string; periodId: string; krs: any[]; draft: any; questions: { id: string; label: string; required: boolean }[]; locked: boolean; aiEnabled: boolean }) {
  const { run, busy } = useAction();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(krs.map((k) => [k.id, String(draft?.krValues?.find((v: any) => v.keyResultId === k.id)?.value ?? k.current_value ?? '')])));
  const [health, setHealth] = useState<string>(draft?.health ?? 'on_track');
  const [t, setT] = useState({ achievements: draft?.achievements ?? '', challenges: draft?.challenges ?? '', blockers: draft?.blockers ?? '', nextSteps: draft?.nextSteps ?? '', reflection: draft?.reflection ?? '' });
  const [answers, setAnswers] = useState<Record<string, string>>(draft?.answers ?? {});
  const body = () => ({ krValues: krs.filter((k) => vals[k.id] !== '').map((k) => ({ keyResultId: k.id, value: Number(vals[k.id]) })), health, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v.trim())), answers });
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => post(`/checkins/${goalId}/${periodId}/submit`, body(), { 'idempotency-key': crypto.randomUUID() }), { success: 'Check-in submitted.' }); }}>
      <fieldset disabled={locked || busy} className="space-y-6">
        <section aria-labelledby="kr-h"><h3 id="kr-h" className="mb-3 text-sm font-semibold">Where do the key results stand?</h3>
          <div className="space-y-3">{krs.map((k) => (
            <div key={k.id} className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto]">
              <div><div className="text-sm font-medium">{k.title}</div><div className="text-xs text-muted-foreground">{k.start_value} → {k.target_value}{k.unit ? ` ${k.unit}` : ''} · last recorded {k.current_value ?? 'nothing yet'}</div></div>
              {k.metric_type === 'boolean'
                ? <Select aria-label={k.title} className="w-36" value={vals[k.id]} onChange={(e) => setVals({ ...vals, [k.id]: e.target.value })}><option value="">Choose…</option><option value="0">Not done</option><option value="1">Done</option></Select>
                : <Input aria-label={`Current value for ${k.title}`} className="w-36" type="number" step="any" value={vals[k.id]} onChange={(e) => setVals({ ...vals, [k.id]: e.target.value })} required />}
            </div>))}</div></section>
        <Field label="Overall, how is this goal going?" htmlFor="health"><Select id="health" value={health} onChange={(e) => setHealth(e.target.value)}><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option><option value="completed">Completed</option></Select></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What went well?" htmlFor="ach"><Textarea id="ach" rows={3} value={t.achievements} onChange={(e) => setT({ ...t, achievements: e.target.value })} maxLength={4000} /></Field>
          <Field label="Challenges" htmlFor="chal"><Textarea id="chal" rows={3} value={t.challenges} onChange={(e) => setT({ ...t, challenges: e.target.value })} maxLength={4000} /></Field>
          <Field label="Blockers — what do you need help with?" htmlFor="blk"><Textarea id="blk" rows={3} value={t.blockers} onChange={(e) => setT({ ...t, blockers: e.target.value })} maxLength={4000} /></Field>
          <Field label="Next steps" htmlFor="nxt"><Textarea id="nxt" rows={3} value={t.nextSteps} onChange={(e) => setT({ ...t, nextSteps: e.target.value })} maxLength={4000} /></Field>
        </div>
        <Field label="Reflection (optional)" htmlFor="ref"><Textarea id="ref" rows={2} value={t.reflection} onChange={(e) => setT({ ...t, reflection: e.target.value })} maxLength={4000} /></Field>
        {questions.map((q) => <Field key={q.id} label={q.label + (q.required ? ' *' : '')} htmlFor={`q-${q.id}`}><Textarea id={`q-${q.id}`} rows={2} required={q.required} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} maxLength={4000} /></Field>)}
      </fieldset>
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit check-in'}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => put(`/checkins/${goalId}/${periodId}`, body()), { success: 'Draft saved.', refresh: false })}>Save draft</Button>
          <p className="basis-full text-xs text-muted-foreground">Once submitted, this check-in becomes part of the permanent record. If you need to correct it later, your manager can reopen it and the original stays visible.</p>
        </div>
      )}
      {aiEnabled && <span hidden><Sparkles /></span>}
    </form>
  );
}

/** Manager's review panel: written feedback, follow-up actions, or reopen for correction. */
export function ReviewPanel({ checkinId, goalId, periodId, status, aiEnabled }: { checkinId: string; goalId: string; periodId: string; status: string; aiEnabled: boolean }) {
  const { run, busy } = useAction();
  const [fb, setFb] = useState(''); const [items, setItems] = useState<{ title: string; dueDate: string }[]>([]); const [reopenReason, setReopenReason] = useState(''); const [reopening, setReopening] = useState(false);
  async function suggest() {
    try { const r = await post<any>('/ai/feedback', { goalId, periodId }); setFb(r.feedback); if (r.actions?.length) setItems(r.actions.map((a: string) => ({ title: a, dueDate: '' }))); toast.message('AI draft inserted — edit it before sending.'); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'AI assistance is unavailable.'); }
  }
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{status === 'reviewed' ? 'Add more feedback' : 'Your review'}</h3>{aiEnabled && <Button type="button" size="sm" variant="ghost" onClick={suggest}><Sparkles className="size-4" aria-hidden />Draft with AI</Button>}</div>
      <Field label="Feedback" htmlFor="fb"><Textarea id="fb" rows={3} value={fb} onChange={(e) => setFb(e.target.value)} maxLength={4000} /></Field>
      <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">Follow-up actions</span><Button type="button" size="sm" variant="ghost" onClick={() => setItems([...items, { title: '', dueDate: '' }])}><Plus className="size-4" aria-hidden />Add</Button></div>
        {items.map((it, i) => <div key={i} className="flex gap-2"><Input aria-label="Action" placeholder="What should happen next?" value={it.title} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /><Input aria-label="Due date" type="date" className="w-40" value={it.dueDate} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} /><Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button></div>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button disabled={busy || fb.trim().length < 3} onClick={() => run(() => post(`/checkins/${checkinId}/review`, { feedback: fb.trim(), actionItems: items.filter((i) => i.title.trim()).map((i) => ({ title: i.title.trim(), ...(i.dueDate ? { dueDate: i.dueDate } : {}) })) }), { success: 'Feedback sent.' }).then(() => { setFb(''); setItems([]); })}>Send feedback</Button>
        <Button variant="outline" onClick={() => setReopening((o) => !o)}>Ask for a correction…</Button>
      </div>
      {reopening && (
        <div className="space-y-2 rounded-lg bg-muted/50 p-3"><Field label="What needs correcting?" htmlFor="ro" hint="The original submission stays on record; the owner submits a new revision."><Textarea id="ro" rows={2} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} /></Field>
          <Button variant="outline" disabled={busy || reopenReason.trim().length < 5} onClick={() => run(() => post(`/checkins/${checkinId}/reopen`, { reason: reopenReason.trim() }), { success: 'Check-in reopened.' }).then(() => setReopening(false))}>Reopen check-in</Button></div>
      )}
    </div>
  );
}
