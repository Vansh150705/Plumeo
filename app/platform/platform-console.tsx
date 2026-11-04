'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { useAction } from '@/components/use-action';
import { post } from '@/lib/api-client';
import { fmtDate } from '@/lib/utils';

export function PlatformConsole({ signedIn, name, orgs }: { signedIn: boolean; name: string; orgs: any[] }) {
  const router = useRouter(); const { run, busy, error } = useAction();
  const [c, setC] = useState({ email: '', password: '' });
  const [o, setO] = useState({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' });
  if (!signedIn) return (
    <div className="mx-auto grid min-h-screen max-w-sm place-items-center px-4"><form className="w-full space-y-4 rounded-2xl border border-border bg-card p-6" onSubmit={(e) => { e.preventDefault(); run(() => post('/platform/login', c), { refresh: true }); }}>
      <h1 className="font-display text-2xl">Platform sign-in</h1>{error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <Field label="Email" htmlFor="pe"><Input id="pe" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} autoComplete="username" /></Field>
      <Field label="Password" htmlFor="pp"><Input id="pp" type="password" value={c.password} onChange={(e) => setC({ ...c, password: e.target.value })} autoComplete="current-password" /></Field>
      <Button type="submit" className="w-full" disabled={busy}>Sign in</Button></form></div>
  );
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between"><div><h1 className="font-display text-2xl">Platform console</h1><p className="text-sm text-muted-foreground">Signed in as {name}. This console manages organisations only; it cannot read their goals or people.</p></div><Button variant="outline" onClick={async () => { await post('/platform/logout'); router.refresh(); }}>Sign out</Button></div>
      <div className="table-wrap mb-8"><table><caption className="sr-only">Organisations</caption><thead><tr><th scope="col">Organisation</th><th scope="col">Address</th><th scope="col">Active users</th><th scope="col">Created</th><th scope="col">Status</th><th /></tr></thead>
        <tbody>{orgs.map((x) => <tr key={x.id}><td className="font-medium">{x.name}</td><td className="font-mono text-xs">{x.slug}</td><td>{x.active_users}</td><td>{fmtDate(x.created_at)}</td><td><Pill variant={x.status === 'active' ? 'green' : 'orange'}>{x.status}</Pill></td>
          <td className="text-right"><Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm(x.status === 'active' ? `Suspend ${x.name}? Everyone is signed out immediately.` : `Reactivate ${x.name}?`) && run(() => post(`/platform/orgs/${x.id}/status`, { status: x.status === 'active' ? 'suspended' : 'active' }), { success: 'Updated.' })}>{x.status === 'active' ? 'Suspend' : 'Reactivate'}</Button></td></tr>)}</tbody></table></div>
      <form className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => post('/platform/orgs', { ...o, createFirstCycle: true }), { success: 'Organisation created.' }).then((r) => r && setO({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' })); }}>
        <h2 className="text-base font-semibold sm:col-span-2">Create an organisation</h2>
        <Field label="Name" htmlFor="on"><Input id="on" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} /></Field><Field label="Address (slug)" htmlFor="os"><Input id="os" value={o.slug} onChange={(e) => setO({ ...o, slug: e.target.value.toLowerCase() })} /></Field>
        <Field label="First administrator" htmlFor="oa"><Input id="oa" value={o.adminName} onChange={(e) => setO({ ...o, adminName: e.target.value })} /></Field><Field label="Administrator email" htmlFor="oe"><Input id="oe" type="email" value={o.adminEmail} onChange={(e) => setO({ ...o, adminEmail: e.target.value })} /></Field>
        <Field label="Temporary password (min. 12 characters)" htmlFor="op" className="sm:col-span-2"><Input id="op" type="password" autoComplete="new-password" value={o.adminPassword} onChange={(e) => setO({ ...o, adminPassword: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Create organisation</Button></div></form>
    </div>
  );
}
