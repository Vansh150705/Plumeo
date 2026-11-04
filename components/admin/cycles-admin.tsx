'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAction } from '@/components/use-action';
import { patch, post } from '@/lib/api-client';
import { fmtDate } from '@/lib/utils';

const PHASE: Record<string, [any, string]> = { upcoming: ['gray', 'Upcoming'], open: ['green', 'Open for check-ins'], overdue: ['red', 'Past due'] };

export function CyclesAdmin({ cycles }: { cycles: any[] }) {
  const { run, busy, error } = useAction();
  const y = new Date().getUTCFullYear();
  const [dlg, setDlg] = useState(false); const [edit, setEdit] = useState<any>(null);
  const [f, setF] = useState({ name: `FY ${y + 1}`, startsOn: `${y + 1}-01-01`, endsOn: `${y + 1}-12-31`, cadence: 'quarterly', opens: '', closes: '', activate: false, openDays: '14', dueDays: '14' });
  const [custom, setCustom] = useState<{ name: string; startsOn: string; endsOn: string; opensOn: string; dueOn: string }[]>([{ name: 'H1', startsOn: `${y + 1}-01-01`, endsOn: `${y + 1}-06-30`, opensOn: `${y + 1}-06-15`, dueOn: `${y + 1}-07-15` }]);
  async function create() {
    const body: any = { name: f.name.trim(), startsOn: f.startsOn, endsOn: f.endsOn, cadence: f.cadence, activate: f.activate, openDaysBeforeEnd: Number(f.openDays), dueDaysAfterEnd: Number(f.dueDays), ...(f.opens ? { goalSettingOpensOn: f.opens } : {}), ...(f.closes ? { goalSettingClosesOn: f.closes } : {}) };
    if (f.cadence === 'custom') body.periods = custom;
    const r = await run(() => post('/cycles', body), { success: 'Cycle created.' }); if (r) setDlg(false);
  }
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg(true)}><Plus className="size-4" aria-hidden />New cycle</Button></div>
      <ul className="space-y-4">{cycles.map((c) => (
        <li key={c.id} className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div><div className="font-medium">{c.name} <Pill variant={c.status === 'active' ? 'green' : c.status === 'closed' ? 'gray' : 'blue'}>{c.status}</Pill></div><div className="text-xs text-muted-foreground">{fmtDate(c.starts_on)} – {fmtDate(c.ends_on)}{c.goal_setting_closes_on ? ` · goal setting closes ${fmtDate(c.goal_setting_closes_on)}` : ''}</div></div>
            <div className="flex gap-2">{c.status === 'planning' && <Button size="sm" disabled={busy} onClick={() => run(() => patch(`/cycles/${c.id}`, { status: 'active' }), { success: 'Cycle activated.' })}>Activate</Button>}{c.status === 'active' && <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm(`Close ${c.name}? Goals can no longer be created or submitted in it.`) && run(() => patch(`/cycles/${c.id}`, { status: 'closed' }), { success: 'Cycle closed.' })}>Close cycle</Button>}</div>
          </div>
          <div className="table-wrap rounded-none border-0"><table><caption className="sr-only">Review periods of {c.name}</caption><thead><tr><th scope="col">Period</th><th scope="col">Covers</th><th scope="col">Check-ins open</th><th scope="col">Due</th><th scope="col">Phase</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>{c.periods.map((p: any) => <tr key={p.id}><td className="font-medium">{p.name}</td><td className="text-muted-foreground">{fmtDate(p.starts_on)} – {fmtDate(p.ends_on)}</td><td>{fmtDate(p.opens_on)}</td><td>{fmtDate(p.due_on)}</td><td><Pill variant={PHASE[p.phase]?.[0]}>{PHASE[p.phase]?.[1]}</Pill></td><td className="text-right">{c.status !== 'closed' && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, opens_on: p.opens_on, due_on: p.due_on })}>Adjust dates</Button>}</td></tr>)}</tbody></table></div>
        </li>))}</ul>

      <Dialog open={dlg} onOpenChange={setDlg}><DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New goal cycle</DialogTitle><DialogDescription>A cycle holds a set of goals. Review periods define when check-ins open and when they are due.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        <Field label="Name" htmlFor="cn"><Input id="cn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Starts" htmlFor="cs"><Input id="cs" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field><Field label="Ends" htmlFor="ce"><Input id="ce" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
          <Field label="Goal setting opens" htmlFor="co" hint="Optional"><Input id="co" type="date" value={f.opens} onChange={(e) => setF({ ...f, opens: e.target.value })} /></Field><Field label="Goal setting closes" htmlFor="cc" hint="Optional"><Input id="cc" type="date" value={f.closes} onChange={(e) => setF({ ...f, closes: e.target.value })} /></Field></div>
        <Field label="Review cadence" htmlFor="cad"><Select id="cad" value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })}><option value="quarterly">Quarterly (every three months)</option><option value="custom">Custom periods</option></Select></Field>
        {f.cadence === 'quarterly' ? <div className="grid grid-cols-2 gap-3"><Field label="Check-ins open (days before period end)" htmlFor="od"><Input id="od" type="number" min={0} max={60} value={f.openDays} onChange={(e) => setF({ ...f, openDays: e.target.value })} /></Field><Field label="Due (days after period end)" htmlFor="dd"><Input id="dd" type="number" min={0} max={60} value={f.dueDays} onChange={(e) => setF({ ...f, dueDays: e.target.value })} /></Field></div> : (
          <div className="space-y-3">{custom.map((p, i) => <fieldset key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3"><legend className="px-1 text-xs text-muted-foreground">Period {i + 1}</legend><Input aria-label="Name" className="col-span-2" value={p.name} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />{(['startsOn', 'endsOn', 'opensOn', 'dueOn'] as const).map((k) => <Field key={k} label={{ startsOn: 'Starts', endsOn: 'Ends', opensOn: 'Check-ins open', dueOn: 'Due' }[k]} htmlFor={`${k}${i}`}><Input id={`${k}${i}`} type="date" value={p[k]} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></Field>)}</fieldset>)}
            <Button type="button" variant="outline" size="sm" onClick={() => setCustom([...custom, { name: `Period ${custom.length + 1}`, startsOn: f.startsOn, endsOn: f.endsOn, opensOn: f.startsOn, dueOn: f.endsOn }])}>Add period</Button></div>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={f.activate} onChange={(e) => setF({ ...f, activate: e.target.checked })} />Activate immediately</label>
        <DialogFooter><Button variant="ghost" onClick={() => setDlg(false)}>Cancel</Button><Button disabled={busy || f.name.trim().length < 2} onClick={create}>Create cycle</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}><DialogContent>
        <DialogHeader><DialogTitle>Adjust {edit?.name}</DialogTitle><DialogDescription>Moving dates changes reminder timing and what counts as overdue. Past submissions are not affected.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3"><Field label="Check-ins open" htmlFor="eo"><Input id="eo" type="date" value={edit?.opens_on ?? ''} onChange={(e) => setEdit({ ...edit, opens_on: e.target.value })} /></Field><Field label="Due" htmlFor="ed"><Input id="ed" type="date" value={edit?.due_on ?? ''} onChange={(e) => setEdit({ ...edit, due_on: e.target.value })} /></Field></div>
        <DialogFooter><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={busy} onClick={() => run(() => patch(`/periods/${edit.id}`, { opensOn: edit.opens_on, dueOn: edit.due_on }), { success: 'Dates updated.' }).then(() => setEdit(null))}>Save</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
