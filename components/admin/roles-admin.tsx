'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAction } from '@/components/use-action';
import { del, patch, post } from '@/lib/api-client';

export function RolesAdmin({ roles, catalogue, held }: { roles: any[]; catalogue: Record<string, string>; held: string[] }) {
  const { run, busy, error } = useAction();
  const [dlg, setDlg] = useState<null | { role?: any }>(null);
  const [f, setF] = useState({ key: '', name: '', description: '', permissions: [] as string[] });
  const open = (role?: any) => { setDlg({ role }); setF(role ? { key: role.key, name: role.name, description: role.description ?? '', permissions: role.permissions } : { key: '', name: '', description: '', permissions: [] }); };
  const groups = Object.keys(catalogue).reduce<Record<string, string[]>>((m, p) => { const g = p.split('.')[0]; (m[g] ??= []).push(p); return m; }, {});
  async function save() {
    const r = await run(() => (dlg?.role ? patch(`/roles/${dlg.role.id}`, { name: f.name, description: f.description, permissions: f.permissions }) : post('/roles', f)), { success: 'Role saved.' });
    if (r) setDlg(null);
  }
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => open()}><Plus className="size-4" aria-hidden />New custom role</Button></div>
      <ul className="space-y-3">{roles.map((r) => (
        <li key={r.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium">{r.name} {r.is_system ? <Pill>Built in</Pill> : <Pill variant="gold">Custom</Pill>}</div><p className="text-sm text-muted-foreground">{r.description}</p><p className="mt-1 text-xs text-muted-foreground">{r.member_count} {r.member_count === 1 ? 'person' : 'people'}</p></div>
            {!r.is_system && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => open(r)}>Edit</Button><Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} disabled={busy} onClick={() => confirm(`Delete the role "${r.name}"? Everyone holding it loses these permissions.`) && run(() => del(`/roles/${r.id}`), { success: 'Role deleted.' })}><Trash2 className="size-4" aria-hidden /></Button></div>}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">{r.permissions.length === 0 ? <span className="text-xs text-muted-foreground">Baseline access: own goals and check-ins</span> : r.permissions.map((p: string) => <span key={p} title={catalogue[p]} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{p}</span>)}</div>
        </li>))}</ul>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}><DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{dlg?.role ? 'Edit role' : 'New custom role'}</DialogTitle><DialogDescription>You can only include permissions you hold yourself (line-management permissions excepted).</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        <div className="grid grid-cols-2 gap-3"><Field label="Name" htmlFor="rn"><Input id="rn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Key" htmlFor="rk" hint="lowercase_with_underscores"><Input id="rk" value={f.key} disabled={!!dlg?.role} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field></div>
        <Field label="Description" htmlFor="rd"><Textarea id="rd" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <fieldset className="space-y-3"><legend className="mb-1 text-xs font-medium">Permissions</legend>
          {Object.entries(groups).map(([g, ps]) => <div key={g}><div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g}</div><div className="space-y-1">{ps.map((p) => <label key={p} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={f.permissions.includes(p)} onChange={(e) => setF({ ...f, permissions: e.target.checked ? [...f.permissions, p] : f.permissions.filter((x) => x !== p) })} /><span><span className="font-mono text-xs">{p}</span> <span className="text-muted-foreground">— {catalogue[p]}{!held.includes(p) ? ' (you do not hold this)' : ''}</span></span></label>)}</div></div>)}</fieldset>
        <DialogFooter><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={busy || !f.name.trim() || (!dlg?.role && !f.key)} onClick={save}>Save role</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
