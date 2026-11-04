'use client';

import { useState } from 'react';
import { Archive, Building2, Pencil, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAction } from '@/components/use-action';
import { del, get, patch, post } from '@/lib/api-client';

type Dept = { id: string; name: string; kind: string; parent_id: string | null; head_user_id: string | null; head_name: string | null; member_count: number };
type Team = { id: string; name: string; department_id: string; parent_team_id: string | null; lead_user_id: string | null; lead_name: string | null; member_count: number };

function PersonPick({ value, onChange, label }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; label: string }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([]);
  if (value) return <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">{value.name}<button type="button" className="text-xs text-muted-foreground" onClick={() => onChange(null)}>Clear</button></div>;
  return (<><Input aria-label={label} placeholder="Search people…" value={q} onChange={async (e) => { setQ(e.target.value); setRes(e.target.value.length >= 2 ? await get<any[]>(`/users?q=${encodeURIComponent(e.target.value)}&status=active&limit=6`).catch(() => []) : []); }} />
    {res.length > 0 && <ul className="mt-1 rounded-lg border border-border">{res.map((u) => <li key={u.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { onChange({ id: u.id, name: u.full_name }); setRes([]); setQ(''); }}>{u.full_name}</button></li>)}</ul>}</>);
}

export function StructureAdmin({ departments, teams, canManage }: { departments: Dept[]; teams: Team[]; canManage: boolean }) {
  const { run, busy, error } = useAction();
  const [dlg, setDlg] = useState<null | { type: 'dept' | 'team'; item?: any; parent?: string }>(null);
  const [f, setF] = useState<any>({}); const [head, setHead] = useState<{ id: string; name: string } | null>(null);
  const open = (type: 'dept' | 'team', item?: any, parent?: string) => {
    setDlg({ type, item, parent });
    setF(item ? { name: item.name, parentId: item.parent_id ?? '', kind: item.kind ?? 'department', departmentId: item.department_id, parentTeamId: item.parent_team_id ?? '' } : { name: '', parentId: parent ?? '', kind: parent ? 'department' : 'business_unit', departmentId: parent ?? departments[0]?.id ?? '', parentTeamId: '' });
    setHead(item ? ((item.head_user_id ?? item.lead_user_id) ? { id: item.head_user_id ?? item.lead_user_id, name: item.head_name ?? item.lead_name } : null) : null);
  };
  async function save() {
    if (!dlg) return;
    const isDept = dlg.type === 'dept';
    const body = isDept ? { name: f.name.trim(), kind: f.kind, parentId: f.parentId || null, headUserId: head?.id ?? null } : { name: f.name.trim(), departmentId: f.departmentId, parentTeamId: f.parentTeamId || null, leadUserId: head?.id ?? null };
    const path = isDept ? '/departments' : '/teams';
    const r = await run(() => (dlg.item ? patch(`${path}/${dlg.item.id}`, body) : post(path, body)), { success: 'Saved.' });
    if (r) setDlg(null);
  }
  const children = (parent: string | null) => departments.filter((d) => d.parent_id === parent);
  const DeptRow = ({ d, depth }: { d: Dept; depth: number }) => (
    <li>
      <div className="rounded-xl border border-border bg-card" style={{ marginLeft: Math.min(depth, 5) * 20 }}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Building2 className="size-4 text-[hsl(var(--gold))]" aria-hidden />
          <div className="min-w-0 flex-1"><div className="font-medium">{d.name} {d.kind === 'business_unit' && <Pill variant="purple">Business unit</Pill>}</div><div className="text-xs text-muted-foreground">{d.head_name ? `Led by ${d.head_name}` : 'No head assigned'} · {d.member_count} people</div></div>
          {canManage && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => open('dept', undefined, d.id)}><Plus className="size-4" aria-hidden />Sub-unit</Button><Button size="sm" variant="ghost" onClick={() => open('team', undefined, d.id)}><Users className="size-4" aria-hidden />Team</Button><Button size="icon" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => open('dept', d)}><Pencil className="size-4" aria-hidden /></Button><Button size="icon" variant="ghost" aria-label={`Archive ${d.name}`} disabled={busy} onClick={() => run(() => del(`/departments/${d.id}`), { success: 'Archived.' })}><Archive className="size-4" aria-hidden /></Button></div>}
        </div>
        {teams.filter((t) => t.department_id === d.id).length > 0 && <ul className="space-y-1 border-t border-border px-4 py-2">{teams.filter((t) => t.department_id === d.id).map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-1 text-sm" style={{ paddingLeft: t.parent_team_id ? 20 : 0 }}><Users className="size-3.5 text-muted-foreground" aria-hidden /><span className="flex-1">{t.name}<span className="ml-2 text-xs text-muted-foreground">{t.lead_name ? `lead ${t.lead_name} · ` : ''}{t.member_count} people</span></span>
            {canManage && <><Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => open('team', t)}><Pencil className="size-3.5" aria-hidden /></Button><Button size="icon" variant="ghost" aria-label={`Archive ${t.name}`} onClick={() => run(() => del(`/teams/${t.id}`), { success: 'Archived.' })}><Archive className="size-3.5" aria-hidden /></Button></>}</li>))}</ul>}
      </div>
      {children(d.id).length > 0 && <ul className="mt-2 space-y-2">{children(d.id).map((c) => <DeptRow key={c.id} d={c} depth={depth + 1} />)}</ul>}
    </li>
  );
  return (
    <div>
      {canManage && <div className="mb-4 flex justify-end"><Button onClick={() => open('dept')}><Plus className="size-4" aria-hidden />Add business unit or department</Button></div>}
      <ul className="space-y-2">{children(null).map((d) => <DeptRow key={d.id} d={d} depth={0} />)}</ul>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}><DialogContent>
        <DialogHeader><DialogTitle>{dlg?.item ? 'Edit' : 'New'} {dlg?.type === 'team' ? 'team' : 'department'}</DialogTitle></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        <Field label="Name" htmlFor="sn"><Input id="sn" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        {dlg?.type === 'dept' ? (<>
          <Field label="Type" htmlFor="sk"><Select id="sk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="business_unit">Business unit</option><option value="department">Department</option></Select></Field>
          <Field label="Sits under" htmlFor="sp"><Select id="sp" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Top level</option>{departments.filter((d) => d.id !== dlg.item?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </>) : (<>
          <Field label="Department" htmlFor="sd"><Select id="sd" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Parent team (for sub-teams)" htmlFor="st"><Select id="st" value={f.parentTeamId} onChange={(e) => setF({ ...f, parentTeamId: e.target.value })}><option value="">None</option>{teams.filter((t) => t.id !== dlg?.item?.id && t.department_id === f.departmentId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </>)}
        <Field label={dlg?.type === 'team' ? 'Team lead' : 'Department head'} htmlFor="sh" hint="They automatically get the matching manager rights."><PersonPick value={head} onChange={setHead} label={dlg?.type === 'team' ? 'Team lead' : 'Department head'} /></Field>
        <DialogFooter><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={busy || !f.name?.trim()} onClick={save}>Save</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
