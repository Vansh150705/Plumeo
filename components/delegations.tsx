'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { useAction } from '@/components/use-action';
import { del, get, post } from '@/lib/api-client';
import { fmtDateTime } from '@/lib/utils';

export function Delegations({ items, meId, canDelegate }: { items: any[]; meId: string; canDelegate: boolean }) {
  const { run, busy } = useAction();
  const [q, setQ] = useState(''); const [people, setPeople] = useState<any[]>([]); const [pick, setPick] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10); const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(today); const [to, setTo] = useState(week); const [reason, setReason] = useState('');
  async function search(v: string) { setQ(v); setPeople(v.length >= 2 ? await get<any[]>(`/users?q=${encodeURIComponent(v)}&limit=6`).catch(() => []) : []); }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Going on leave? Let a colleague approve on your behalf for a fixed period. Every decision they make is recorded as made on your behalf, and they can never approve their own goals.</p>
      {items.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border bg-card">{items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div><span className="font-medium">{d.delegator_id === meId ? `You → ${d.delegate_name}` : `${d.delegator_name} → you`}</span><div className="text-xs text-muted-foreground">{fmtDateTime(d.starts_at)} – {fmtDateTime(d.ends_at)}{d.reason ? ` · ${d.reason}` : ''}</div></div>
          <div className="flex items-center gap-2">{d.revoked_at ? <Pill>Revoked</Pill> : d.active ? <Pill variant="green">Active</Pill> : <Pill variant="gray">Scheduled / ended</Pill>}{!d.revoked_at && d.delegator_id === meId && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => del(`/delegations/${d.id}`), { success: 'Delegation revoked.' })}>Revoke</Button>}</div>
        </li>))}</ul>}
      {canDelegate && (
        <form className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!pick) return; run(() => post('/delegations', { delegateId: pick.id, startsAt: new Date(from + 'T00:00:00').toISOString(), endsAt: new Date(to + 'T23:59:59').toISOString(), reason: reason || undefined }), { success: 'Delegation created.' }).then(() => { setPick(null); setQ(''); }); }}>
          <Field label="Delegate to" htmlFor="dq" className="sm:col-span-2">{pick ? <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">{pick.full_name}<button type="button" onClick={() => setPick(null)} className="text-xs text-muted-foreground">Change</button></div> : <><Input id="dq" value={q} onChange={(e) => search(e.target.value)} placeholder="Search colleagues…" />{people.length > 0 && <ul className="mt-1 rounded-lg border border-border">{people.filter((x) => x.id !== meId).map((x) => <li key={x.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setPick(x); setPeople([]); }}>{x.full_name}<span className="ml-2 text-xs text-muted-foreground">{x.job_title}</span></button></li>)}</ul>}</>}</Field>
          <Field label="From" htmlFor="df"><Input id="df" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Until" htmlFor="dt"><Input id="dt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Reason (optional)" htmlFor="dr" className="sm:col-span-2"><Input id="dr" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={!pick || busy}>Create delegation</Button></div>
        </form>
      )}
    </div>
  );
}
