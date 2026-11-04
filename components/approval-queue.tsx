'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, MessageSquareWarning, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LevelPill, PriorityPill } from '@/components/status';
import { useAction } from '@/components/use-action';
import { post } from '@/lib/api-client';
import { fmtDate, fmtRelative } from '@/lib/utils';

export function ApprovalQueue({ items, scope }: { items: any[]; scope: 'mine' | 'all' }) {
  const { run, busy } = useAction();
  const [dlg, setDlg] = useState<{ item: any; decision: 'approve' | 'reject' | 'request_changes' } | null>(null);
  const [comment, setComment] = useState('');
  const need = dlg && dlg.decision !== 'approve';
  const submit = () => dlg && run(() => post(`/approvals/${dlg.item.id}/decision`, { decision: dlg.decision, comment: comment.trim() || undefined }), { success: dlg.decision === 'approve' ? 'Approved.' : 'Decision recorded.' }).then(() => { setDlg(null); setComment(''); });
  return (
    <>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2"><LevelPill level={it.goal_level} /><PriorityPill priority={it.priority} />{it.amendment_id && <Pill variant="purple">Amendment</Pill>}{it.overdue && <Pill variant="red">Overdue</Pill>}{it.reason === 'delegated' && <Pill variant="gold">Delegated to you</Pill>}{it.reason === 'oversight' && scope === 'all' && <Pill variant="gray">Oversight · {it.approver_name ?? 'approver pool'}</Pill>}{it.total_levels > 1 && <Pill variant="blue">Level {it.level} of {it.total_levels}</Pill>}</div>
                <Link href={`/app/goals/${it.goal_id}`} className="text-base font-medium hover:underline">{it.title}</Link>
                <p className="mt-0.5 text-sm text-muted-foreground">{it.owner_name}{it.owner_title ? ` · ${it.owner_title}` : ''} · submitted {fmtRelative(it.requested_at)}{it.due_at ? ` · respond by ${fmtDate(it.due_at)}` : ''}</p>
                {it.amendment_reason && <p className="mt-1 text-sm">Reason for change: <em>{it.amendment_reason}</em> ({(it.change_kinds ?? []).join(', ')})</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDlg({ item: it, decision: 'approve' })}><Check className="size-4" aria-hidden />Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setDlg({ item: it, decision: 'request_changes' })}><MessageSquareWarning className="size-4" aria-hidden />Changes</Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDlg({ item: it, decision: 'reject' })}><X className="size-4" aria-hidden />Reject</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!dlg} onOpenChange={(o) => { if (!o) { setDlg(null); setComment(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlg?.decision === 'approve' ? 'Approve' : dlg?.decision === 'reject' ? 'Reject' : 'Request changes to'} “{dlg?.item.title}”</DialogTitle><DialogDescription>{dlg?.decision === 'approve' ? 'Your name and the time are recorded with the decision.' : 'The owner sees this message, so be specific about what should change.'}</DialogDescription></DialogHeader>
          <Field label={need ? 'Message to the owner' : 'Comment (optional)'} htmlFor="cm" hint={need ? 'At least 5 characters' : undefined}><Textarea id="cm" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus /></Field>
          <DialogFooter><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button variant={dlg?.decision === 'reject' ? 'destructive' : 'default'} disabled={busy || (!!need && comment.trim().length < 5)} onClick={submit}>{busy ? 'Saving…' : 'Confirm'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
