'use client';

import { useState } from 'react';
import { Copy, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAction } from '@/components/use-action';
import { del, get, patch, post } from '@/lib/api-client';
import { fmtDate } from '@/lib/utils';

interface Lookups { departments: { id: string; name: string }[]; teams: { id: string; name: string; department_id: string }[]; roles: { key: string; name: string }[] }
const STATUS_VARIANT: Record<string, any> = { active: 'green', invited: 'blue', suspended: 'orange', deactivated: 'gray', anonymized: 'gray' };

function ManagerPicker({ value, onChange, excludeId }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; excludeId?: string }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([]);
  if (value) return <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">{value.name}<button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>Clear</button></div>;
  return (<><Input aria-label="Search for a manager" placeholder="Search for a manager…" value={q} onChange={async (e) => { setQ(e.target.value); setRes(e.target.value.length >= 2 ? await get<any[]>(`/users?q=${encodeURIComponent(e.target.value)}&limit=6`).catch(() => []) : []); }} />
    {res.length > 0 && <ul className="mt-1 rounded-lg border border-border">{res.filter((u) => u.id !== excludeId).map((u) => <li key={u.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { onChange({ id: u.id, name: u.full_name }); setRes([]); setQ(''); }}>{u.full_name}<span className="ml-2 text-xs text-muted-foreground">{u.job_title}</span></button></li>)}</ul>}</>);
}

function UserDialog({ user, lookups, onClose, onInvite }: { user?: any; lookups: Lookups; onClose: () => void; onInvite: (url: string, email: string) => void }) {
  const { run, busy, error } = useAction();
  const [f, setF] = useState({ email: user?.email ?? '', fullName: user?.full_name ?? '', jobTitle: user?.job_title ?? '', departmentId: user?.department_id ?? '', teamId: user?.team_id ?? '' });
  const [mgr, setMgr] = useState<{ id: string; name: string } | null>(user?.manager_id ? { id: user.manager_id, name: user.manager_name } : null);
  const [roles, setRoles] = useState<string[]>([]);
  const teams = lookups.teams.filter((t) => !f.departmentId || t.department_id === f.departmentId);
  async function save() {
    const body: any = { fullName: f.fullName.trim(), jobTitle: f.jobTitle.trim() || (user ? null : undefined), managerId: mgr?.id ?? null, departmentId: f.departmentId || null, teamId: f.teamId || null };
    if (user) { const r = await run(() => patch(`/users/${user.id}`, body), { success: 'Person updated.' }); if (r !== undefined) onClose(); return; }
    const r = await run(() => post<any>('/users', { ...body, jobTitle: body.jobTitle ?? undefined, email: f.email.trim().toLowerCase(), roles }));
    if (r) { onInvite(r.inviteUrl, f.email); onClose(); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{user ? 'Edit person' : 'Invite a person'}</DialogTitle><DialogDescription>{user ? 'Changing the manager moves any pending approvals with the reporting line.' : 'They receive a one-time link to set their password.'}</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        <Field label="Work email" htmlFor="ue"><Input id="ue" type="email" value={f.email} disabled={!!user} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Full name" htmlFor="un"><Input id="un" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field><Field label="Job title" htmlFor="ut"><Input id="ut" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></Field></div>
        <Field label="Manager" htmlFor="um"><ManagerPicker value={mgr} onChange={setMgr} excludeId={user?.id} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department" htmlFor="ud"><Select id="ud" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value, teamId: '' })}><option value="">None</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Team" htmlFor="ug"><Select id="ug" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">None</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </div>
        {!user && lookups.roles.length > 0 && <Field label="Additional roles" htmlFor="ur" hint="Everyone is an Employee. Managers are granted manager rights automatically when they get reports.">
          <div className="flex flex-wrap gap-2">{lookups.roles.filter((r) => r.key !== 'employee').map((r) => <label key={r.key} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"><input type="checkbox" className="accent-[hsl(var(--primary))]" checked={roles.includes(r.key)} onChange={(e) => setRoles(e.target.checked ? [...roles, r.key] : roles.filter((x) => x !== r.key))} />{r.name}</label>)}</div></Field>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.fullName.trim() || (!user && !f.email.includes('@'))} onClick={save}>{busy ? 'Saving…' : user ? 'Save' : 'Send invitation'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RolesDialog({ user, allRoles, onClose }: { user: any; allRoles: { key: string; name: string }[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [have, setHave] = useState<string[]>(user.roles ?? []);
  async function toggle(key: string, on: boolean) { const r = await run(() => (on ? post(`/users/${user.id}/roles`, { role: key }) : del(`/users/${user.id}/roles/${key}`)), { success: on ? 'Role granted.' : 'Role removed.' }); if (r) setHave(on ? [...have, key] : have.filter((x) => x !== key)); }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogHeader><DialogTitle>Roles for {user.full_name}</DialogTitle><DialogDescription>Changes apply immediately and are recorded in the audit trail. You can only grant permissions you hold yourself.</DialogDescription></DialogHeader>
        <ul className="space-y-2">{allRoles.map((r) => <li key={r.key}><label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" disabled={busy || r.key === 'employee'} checked={have.includes(r.key)} onChange={(e) => toggle(r.key, e.target.checked)} />{r.name}</label></li>)}</ul>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter></DialogContent>
    </Dialog>
  );
}

export function PeopleAdmin({ users, lookups, canManage, canRoles, canAnonymize, welcome }: { users: any[]; lookups: Lookups; canManage: boolean; canRoles: boolean; canAnonymize: boolean; welcome: boolean }) {
  const { run, busy } = useAction();
  const [dlg, setDlg] = useState<null | { kind: 'invite' } | { kind: 'edit'; user: any } | { kind: 'roles'; user: any }>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'deactivate' | 'anonymize'; user: any }>(null);
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success('Link copied.'); } catch { toast.error('Copy failed — select the text manually.'); } };
  return (
    <div>
      {welcome && <div role="status" className="mb-4 rounded-xl border border-[hsl(var(--gold))]/40 bg-[hsl(var(--gold))]/5 p-4 text-sm"><strong>Your workspace is ready.</strong> Next: set up <a className="underline" href="/app/admin/structure">departments and teams</a>, then invite your people here, and define company goals.</div>}
      {canManage && <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ kind: 'invite' })}><Plus className="size-4" aria-hidden />Invite person</Button></div>}
      <div className="table-wrap"><table><caption className="sr-only">People</caption>
        <thead><tr><th scope="col">Person</th><th scope="col">Department / team</th><th scope="col">Manager</th><th scope="col">Roles</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><div className="font-medium">{u.full_name}</div><div className="text-xs text-muted-foreground">{u.email}{u.scim_managed ? ' · SCIM' : ''}</div></td>
            <td className="text-muted-foreground">{[u.department_name, u.team_name].filter(Boolean).join(' · ') || '—'}</td>
            <td className="text-muted-foreground">{u.manager_name ?? '—'}</td>
            <td><div className="flex flex-wrap gap-1">{(u.roles ?? []).filter((r: string) => r !== 'employee').map((r: string) => <Pill key={r} variant="gold">{r.replace('_', ' ')}</Pill>)}</div></td>
            <td><Pill variant={STATUS_VARIANT[u.status]}>{u.status}</Pill>{u.last_login_at && <div className="mt-0.5 text-[11px] text-muted-foreground">seen {fmtDate(u.last_login_at)}</div>}</td>
            <td className="relative text-right">{canManage && u.status !== 'anonymized' && (<>
              <button className="rounded-md p-1.5 hover:bg-accent" aria-label={`Actions for ${u.full_name}`} aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}><MoreHorizontal className="size-4" aria-hidden /></button>
              {open === u.id && (<><button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setOpen(null)} />
                <div role="menu" className="absolute right-4 top-full z-40 w-52 overflow-hidden rounded-xl border border-border bg-card py-1 text-left text-sm shadow-xl">
                  <button role="menuitem" className="block w-full px-4 py-2 text-left hover:bg-accent" onClick={() => { setOpen(null); setDlg({ kind: 'edit', user: u }); }}>Edit</button>
                  {canRoles && <button role="menuitem" className="block w-full px-4 py-2 text-left hover:bg-accent" onClick={() => { setOpen(null); setDlg({ kind: 'roles', user: u }); }}>Manage roles</button>}
                  {['active', 'invited'].includes(u.status) && <button role="menuitem" className="block w-full px-4 py-2 text-left hover:bg-accent" onClick={async () => { setOpen(null); const r = await run(() => post<any>(`/users/${u.id}/reset-password`), { refresh: false }); if (r) setLink({ url: r.url, email: u.email }); }}>{u.status === 'invited' ? 'New invitation link' : 'Password reset link'}</button>}
                  {u.status === 'active' && <button role="menuitem" className="block w-full px-4 py-2 text-left hover:bg-accent" onClick={() => { setOpen(null); run(() => post(`/users/${u.id}/status`, { status: 'suspended' }), { success: 'Suspended.' }); }}>Suspend</button>}
                  {['suspended', 'deactivated'].includes(u.status) && <button role="menuitem" className="block w-full px-4 py-2 text-left hover:bg-accent" onClick={() => { setOpen(null); run(() => post(`/users/${u.id}/status`, { status: 'active' }), { success: 'Reactivated.' }); }}>Reactivate</button>}
                  {u.status !== 'deactivated' && <button role="menuitem" className="block w-full px-4 py-2 text-left text-destructive hover:bg-accent" onClick={() => { setOpen(null); setConfirm({ kind: 'deactivate', user: u }); }}>Deactivate…</button>}
                  {canAnonymize && u.status === 'deactivated' && <button role="menuitem" className="block w-full px-4 py-2 text-left text-destructive hover:bg-accent" onClick={() => { setOpen(null); setConfirm({ kind: 'anonymize', user: u }); }}>Anonymise personal data…</button>}
                </div></>)}</>)}</td>
          </tr>))}</tbody></table></div>

      {dlg?.kind === 'invite' && <UserDialog lookups={lookups} onClose={() => setDlg(null)} onInvite={(url, email) => setLink({ url, email })} />}
      {dlg?.kind === 'edit' && <UserDialog user={dlg.user} lookups={lookups} onClose={() => setDlg(null)} onInvite={() => {}} />}
      {dlg?.kind === 'roles' && <RolesDialog user={dlg.user} allRoles={lookups.roles} onClose={() => setDlg(null)} />}
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}><DialogContent><DialogHeader><DialogTitle>Share this link with {link?.email}</DialogTitle><DialogDescription>It works once and expires. If email is configured on this server it was also sent automatically. Treat it like a password.</DialogDescription></DialogHeader>
        <div className="flex gap-2"><Input readOnly value={link?.url ?? ''} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={() => link && copy(link.url)}><Copy className="size-4" aria-hidden /><span className="sr-only">Copy</span></Button></div>
        <DialogFooter><Button onClick={() => setLink(null)}>Done</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}><DialogContent>
        <DialogHeader><DialogTitle>{confirm?.kind === 'deactivate' ? `Deactivate ${confirm?.user.full_name}?` : `Anonymise ${confirm?.user.full_name}?`}</DialogTitle>
          <DialogDescription>{confirm?.kind === 'deactivate' ? 'They are signed out immediately. Their direct reports and pending approvals move to their manager. Their goals and history are kept.' : 'Their name, email and credentials are permanently removed. Goals and the audit trail keep working but refer to “Former employee”. This cannot be undone.'}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => confirm && run(() => (confirm.kind === 'deactivate' ? post(`/users/${confirm.user.id}/status`, { status: 'deactivated' }) : post(`/users/${confirm.user.id}/anonymize`)), { success: confirm.kind === 'deactivate' ? 'Deactivated.' : 'Anonymised.' }).then(() => setConfirm(null))}>{confirm?.kind === 'deactivate' ? 'Deactivate' : 'Anonymise permanently'}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
