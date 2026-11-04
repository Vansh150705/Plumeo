'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Send, Undo2, Flag, Ban, ArrowRightLeft, FilePlus2, GitPullRequestArrow, MessageSquareWarning, X, Trash2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAction } from '@/components/use-action';
import { del, get, post, ApiError } from '@/lib/api-client';

/** A confirm-with-reason dialog used for sensitive actions. */
function ReasonDialog({ open, onOpenChange, title, description, label, cta, tone, minLength = 5, optional, onSubmit, busy }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; label: string; cta: string; tone?: 'danger'; minLength?: number; optional?: boolean; busy: boolean; onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const ok = optional || text.trim().length >= minLength;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <Field label={label} htmlFor="reason" hint={optional ? 'Optional' : `At least ${minLength} characters`}><Textarea id="reason" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant={tone === 'danger' ? 'destructive' : 'default'} disabled={!ok || busy} onClick={() => onSubmit(text.trim())}>{busy ? 'Working…' : cta}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GoalActions({ goal, permissions, hasKeyResults, canTemplate, canTransfer }: { goal: any; permissions: any; hasKeyResults: boolean; canTemplate: boolean; canTransfer: boolean }) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [dlg, setDlg] = useState<null | 'complete' | 'cancel' | 'transfer' | 'template' | 'delete' | 'amend'>(null);
  const close = () => setDlg(null);
  const p = permissions;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.edit && <Button asChild variant="outline"><Link href={`/app/goals/${goal.id}/edit`}><Pencil className="size-4" aria-hidden />Edit</Link></Button>}
      {p.submit && <Button disabled={busy} onClick={() => run(async () => { try { await post(`/goals/${goal.id}/submit`, { expectedVersion: goal.version }); } catch (e) { if (e instanceof ApiError && Array.isArray(e.details)) { router.push(`/app/goals/${goal.id}/edit`); throw new ApiError(`Not ready to submit: ${e.details.map((d: any) => d.message).join(' ')}`, 422, 'validation_failed'); } throw e; } }, { success: 'Submitted for approval.' })}><Send className="size-4" aria-hidden />Submit for approval</Button>}
      {p.withdraw && <Button variant="outline" disabled={busy} onClick={() => run(() => post(`/goals/${goal.id}/withdraw`), { success: 'Submission withdrawn — it is a draft again.' })}><Undo2 className="size-4" aria-hidden />Withdraw</Button>}
      {p.recordProgress && <a href="#key-results" className="inline-flex"><Button variant="outline" type="button"><TrendingUp className="size-4" aria-hidden />Update progress</Button></a>}
      {p.amend && <Button variant="outline" onClick={() => setDlg('amend')}><GitPullRequestArrow className="size-4" aria-hidden />Amend</Button>}
      {p.complete && <Button variant="outline" onClick={() => setDlg('complete')}><Flag className="size-4" aria-hidden />Mark complete</Button>}
      {canTransfer && p.transfer && <Button variant="outline" onClick={() => setDlg('transfer')}><ArrowRightLeft className="size-4" aria-hidden />Transfer owner</Button>}
      {canTemplate && <Button variant="ghost" onClick={() => setDlg('template')}><FilePlus2 className="size-4" aria-hidden />Save as template</Button>}
      {p.delete && <Button variant="ghost" className="text-destructive" onClick={() => setDlg('delete')}><Trash2 className="size-4" aria-hidden />Delete draft</Button>}
      {p.cancel && <Button variant="ghost" className="text-destructive" onClick={() => setDlg('cancel')}><Ban className="size-4" aria-hidden />Cancel goal</Button>}

      <ReasonDialog open={dlg === 'complete'} onOpenChange={close} busy={busy} title="Mark this goal complete?" description="Completed goals stay in the record and keep their history." label="Completion note" cta="Mark complete" optional
        onSubmit={(note) => run(() => post(`/goals/${goal.id}/complete`, { note }), { success: 'Goal completed.' }).then(close)} />
      <ReasonDialog open={dlg === 'cancel'} onOpenChange={close} busy={busy} tone="danger" title="Cancel this goal?" description="People aligned to it will be notified. This cannot be undone, but the history is kept." label="Reason" cta="Cancel goal"
        onSubmit={(reason) => run(() => post(`/goals/${goal.id}/cancel`, { reason }), { success: 'Goal cancelled.' }).then(close)} />
      <ReasonDialog open={dlg === 'delete'} onOpenChange={close} busy={busy} tone="danger" title="Delete this draft?" description="Only drafts can be deleted. The deletion is recorded in the audit trail." label="Type a short reason" cta="Delete draft" optional
        onSubmit={() => run(() => del(`/goals/${goal.id}`), { success: 'Draft deleted.', refresh: false }).then((r) => { close(); if (r) router.push('/app/goals'); })} />
      {dlg === 'transfer' && <TransferDialog goalId={goal.id} onClose={close} />}
      {dlg === 'template' && <TemplateDialog goalId={goal.id} defaultName={goal.title} onClose={close} />}
      {dlg === 'amend' && <AmendDialog goal={goal} onClose={close} />}
    </div>
  );
}

function TransferDialog({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const { run, busy } = useAction();
  const [q, setQ] = useState(''); const [people, setPeople] = useState<any[]>([]); const [pick, setPick] = useState<any>(null); const [reason, setReason] = useState('');
  async function search(v: string) { setQ(v); if (v.length >= 2) setPeople(await get<any[]>(`/users?q=${encodeURIComponent(v)}&limit=6`).catch(() => [])); else setPeople([]); }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Transfer ownership</DialogTitle><DialogDescription>The previous owner, the new owner and the reason are recorded in the audit trail and version history.</DialogDescription></DialogHeader>
        <Field label="New owner" htmlFor="owner">{pick ? <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">{pick.full_name}<button onClick={() => setPick(null)} aria-label="Clear"><X className="size-4" /></button></div> : <><Input id="owner" value={q} onChange={(e) => search(e.target.value)} placeholder="Search people…" />
          {people.length > 0 && <ul className="mt-1 rounded-lg border border-border">{people.map((x) => <li key={x.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setPick(x); setPeople([]); }}>{x.full_name}</button></li>)}</ul>}</>}</Field>
        <Field label="Reason" htmlFor="why"><Textarea id="why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!pick || reason.trim().length < 5 || busy} onClick={() => run(() => post(`/goals/${goalId}/transfer`, { newOwnerId: pick.id, reason: reason.trim() }), { success: 'Ownership transferred.' }).then(onClose)}>Transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ goalId, defaultName, onClose }: { goalId: string; defaultName: string; onClose: () => void }) {
  const { run, busy } = useAction(); const [name, setName] = useState(defaultName);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogHeader><DialogTitle>Save to the goal library</DialogTitle><DialogDescription>Others can start new goals from this structure (title, outcome and key-result shape — no progress or people).</DialogDescription></DialogHeader>
        <Field label="Template name" htmlFor="tn"><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={name.trim().length < 2 || busy} onClick={() => run(() => post('/templates/from-goal', { goalId, name: name.trim() }), { success: 'Saved to the library.', refresh: false }).then(onClose)}>Save</Button></DialogFooter></DialogContent>
    </Dialog>
  );
}

/** Controlled change of an approved goal: edits are proposed with a reason; significant ones need re-approval (per org policy). */
function AmendDialog({ goal, onClose }: { goal: any; onClose: () => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState({ title: goal.title, dueDate: goal.due_date ?? '', priority: goal.priority, reason: '' });
  const [target, setTarget] = useState<Record<string, string>>({});
  const [krs, setKrs] = useState<any[] | null>(null);
  useState(() => { get<any>(`/goals/${goal.id}`).then((d) => setKrs(d.keyResults)).catch(() => setKrs([])); });
  async function submit() {
    const changes: any = {};
    if (f.title.trim() !== goal.title) changes.title = f.title.trim();
    if (f.dueDate && f.dueDate !== goal.due_date) changes.dueDate = f.dueDate;
    if (f.priority !== goal.priority) changes.priority = f.priority;
    const edited = (krs ?? []).filter((k) => target[k.id] !== undefined && target[k.id] !== '' && Number(target[k.id]) !== Number(k.target_value));
    if (edited.length) changes.keyResults = (krs ?? []).map((k) => ({ id: k.id, title: k.title, metricType: k.metric_type, direction: k.direction, unit: k.unit, startValue: k.start_value, targetValue: target[k.id] !== undefined && target[k.id] !== '' ? Number(target[k.id]) : k.target_value, weight: k.weight }));
    const r = await run(() => post<any>(`/goals/${goal.id}/amendments`, { reason: f.reason.trim(), changes }), { silent: false });
    if (r) { (await import('sonner')).toast.success(r.requiresApproval ? 'Amendment sent for approval. The current version stays in force until it is approved.' : 'Amendment applied and recorded.'); onClose(); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Amend approved goal</DialogTitle><DialogDescription>Changes to targets, deadlines, scope or ownership may need re-approval, depending on your organisation&apos;s policy. The previous version is always kept.</DialogDescription></DialogHeader>
        <Field label="Title" htmlFor="at"><Input id="at" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Due date" htmlFor="ad"><Input id="ad" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Priority" htmlFor="ap"><Select id="ap" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['low', 'medium', 'high', 'critical'].map((x) => <option key={x}>{x}</option>)}</Select></Field></div>
        {krs?.map((k) => <Field key={k.id} label={`Target — ${k.title}`} htmlFor={`k${k.id}`} hint={`Currently ${k.target_value}${k.unit ? ' ' + k.unit : ''}`}><Input id={`k${k.id}`} type="number" step="any" placeholder={String(k.target_value)} value={target[k.id] ?? ''} onChange={(e) => setTarget({ ...target, [k.id]: e.target.value })} /></Field>)}
        <Field label="Why is this changing?" htmlFor="ar" hint="Required — shown to approvers and kept in the history."><Textarea id="ar" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || f.reason.trim().length < 5} onClick={submit}>{busy ? 'Sending…' : 'Propose amendment'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Approver panel: decide the pending request on this goal. */
export function DecisionPanel({ requestId, level, totalLevels, amendment }: { requestId: string; level: number; totalLevels: number; amendment?: boolean }) {
  const { run, busy } = useAction();
  const [mode, setMode] = useState<null | 'reject' | 'request_changes' | 'approve'>(null);
  const decide = (decision: string, comment: string) => run(() => post(`/approvals/${requestId}/decision`, { decision, comment: comment || undefined }), { success: decision === 'approve' ? 'Approved.' : 'Decision recorded.' }).then(() => setMode(null));
  return (
    <div className="rounded-xl border border-[hsl(var(--gold))]/40 bg-[hsl(var(--gold))]/5 p-4">
      <div className="mb-3 text-sm font-medium">{amendment ? 'An amendment needs your decision' : 'Your decision is needed'}{totalLevels > 1 ? ` · level ${level} of ${totalLevels}` : ''}</div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => setMode('approve')}><Check className="size-4" aria-hidden />Approve</Button>
        <Button variant="outline" disabled={busy} onClick={() => setMode('request_changes')}><MessageSquareWarning className="size-4" aria-hidden />Request changes</Button>
        <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => setMode('reject')}><X className="size-4" aria-hidden />Reject</Button>
      </div>
      <ReasonDialog open={mode === 'approve'} onOpenChange={() => setMode(null)} busy={busy} title="Approve this goal?" description="Approval is recorded with your name and time." label="Comment" cta="Approve" optional onSubmit={(c) => decide('approve', c)} />
      <ReasonDialog open={mode === 'request_changes'} onOpenChange={() => setMode(null)} busy={busy} title="Request changes" description="The owner can edit and resubmit." label="What should change?" cta="Request changes" onSubmit={(c) => decide('request_changes', c)} />
      <ReasonDialog open={mode === 'reject'} onOpenChange={() => setMode(null)} busy={busy} tone="danger" title="Reject this goal?" description="Explain why so the owner knows what to do next." label="Reason" cta="Reject" onSubmit={(c) => decide('reject', c)} />
    </div>
  );
}

/** Inline key-result progress recording for owners and collaborators. */
export function KeyResultProgress({ goalId, krs, editable }: { goalId: string; krs: any[]; editable: boolean }) {
  const { run, busy } = useAction();
  const [vals, setVals] = useState<Record<string, string>>({}); const [notes, setNotes] = useState<Record<string, string>>({});
  const changed = krs.filter((k) => vals[k.id] !== undefined && vals[k.id] !== '' && Number(vals[k.id]) !== Number(k.current_value));
  return (
    <div>
      <ul className="divide-y divide-border">
        {krs.map((k) => (
          <li key={k.id} className="py-3">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm font-medium">{k.title}</span>
              <span className="text-xs text-muted-foreground">{k.metric_type === 'boolean' ? (k.current_value === 1 ? 'Done' : 'Not done') : `${k.current_value ?? '—'} of ${k.target_value}${k.unit ? ' ' + k.unit : ''} · from ${k.start_value}`}</span></div>
            <div role="progressbar" aria-valuenow={Math.round(k.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={k.title} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[hsl(var(--gold))]" style={{ width: `${k.progress}%` }} /></div>
            {editable && (
              <div className="mt-2 flex flex-wrap gap-2">
                {k.metric_type === 'boolean'
                  ? <Select aria-label={`Status of ${k.title}`} className="w-40" value={vals[k.id] ?? String(k.current_value ?? 0)} onChange={(e) => setVals({ ...vals, [k.id]: e.target.value })}><option value="0">Not done</option><option value="1">Done</option></Select>
                  : <Input aria-label={`New value for ${k.title}`} className="w-32" type="number" step="any" placeholder="New value" value={vals[k.id] ?? ''} onChange={(e) => setVals({ ...vals, [k.id]: e.target.value })} />}
                <Input aria-label={`Note for ${k.title}`} className="min-w-40 flex-1" placeholder="Note (optional)" maxLength={1000} value={notes[k.id] ?? ''} onChange={(e) => setNotes({ ...notes, [k.id]: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {editable && <div className="mt-3 flex justify-end"><Button disabled={busy || changed.length === 0} onClick={() => run(() => post(`/goals/${goalId}/progress`, { updates: changed.map((k) => ({ keyResultId: k.id, value: Number(vals[k.id]), note: notes[k.id] || undefined })) }), { success: 'Progress recorded.' }).then(() => { setVals({}); setNotes({}); })}>{busy ? 'Saving…' : `Record ${changed.length || ''} update${changed.length === 1 ? '' : 's'}`}</Button></div>}
    </div>
  );
}
