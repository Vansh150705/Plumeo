'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { useAction } from '@/components/use-action';
import { api, del, patch, post, put } from '@/lib/api-client';
import { fmtDateTime } from '@/lib/utils';

export function ProfileForm({ name, title }: { name: string; title: string | null }) {
  const { run, busy } = useAction(); const [n, setN] = useState(name); const [t, setT] = useState(title ?? '');
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => patch('/me', { fullName: n.trim(), jobTitle: t.trim() || null }), { success: 'Profile updated.' }); }}>
      <Field label="Full name" htmlFor="pn"><Input id="pn" value={n} onChange={(e) => setN(e.target.value)} required /></Field>
      <Field label="Job title" htmlFor="pt"><Input id="pt" value={t} onChange={(e) => setT(e.target.value)} /></Field>
      <Button type="submit" disabled={busy || !n.trim()}>Save profile</Button>
    </form>
  );
}

export function PasswordForm() {
  const { run, busy } = useAction(); const [cur, setCur] = useState(''); const [nx, setNx] = useState(''); const [nx2, setNx2] = useState('');
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (nx !== nx2) return; run(() => post<{ otherSessionsRevoked: number }>('/auth/password', { current: cur, next: nx }), { success: 'Password changed. Other sessions were signed out.' }).then((r) => { if (r) { setCur(''); setNx(''); setNx2(''); } }); }}>
      <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
      <Field label="New password" htmlFor="np" hint="At least 12 characters."><Input id="np" type="password" value={nx} onChange={(e) => setNx(e.target.value)} autoComplete="new-password" minLength={12} required /></Field>
      <Field label="Confirm new password" htmlFor="np2" error={nx2 && nx !== nx2 ? 'Passwords do not match' : null}><Input id="np2" type="password" value={nx2} onChange={(e) => setNx2(e.target.value)} autoComplete="new-password" required /></Field>
      <Button type="submit" disabled={busy || !cur || nx.length < 12 || nx !== nx2}>Change password</Button>
    </form>
  );
}

export function SessionList({ sessions }: { sessions: any[] }) {
  const { run, busy } = useAction(); const router = useRouter();
  return (
    <ul className="divide-y divide-border">{sessions.map((s) => (
      <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <div><div className="font-medium">{(s.user_agent ?? 'Unknown device').slice(0, 70)} {s.current && <Pill variant="green">This device</Pill>}</div><div className="text-xs text-muted-foreground">{s.auth_method === 'oidc' ? 'Single sign-on' : 'Password'} · {s.ip ?? 'unknown address'} · last active {fmtDateTime(s.last_seen_at)}</div></div>
        {!s.current && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => del(`/auth/sessions/${s.id}`), { success: 'Session signed out.' })}>Sign out</Button>}
      </li>))}{sessions.length === 0 && <li className="py-3 text-sm text-muted-foreground">No active sessions.</li>}</ul>
  );
}

const LABELS: Record<string, [string, string]> = { approvals: ['Approvals', 'Requests waiting for you and delegation changes'], goals: ['Goals', 'Approval outcomes, amendments and ownership changes'], checkins: ['Check-ins', 'Reminders for due and overdue check-ins'], feedback: ['Feedback', 'Manager feedback on your check-ins'], org: ['Organisation', 'Important updates from your administrators'] };
export function PreferencesForm({ prefs }: { prefs: { category: string; in_app: boolean; email: boolean; emailAvailable: boolean }[] }) {
  const { run, busy } = useAction(); const [p, setP] = useState(prefs);
  const set = (c: string, k: 'in_app' | 'email', v: boolean) => setP((a) => a.map((x) => (x.category === c ? { ...x, [k]: v } : x)));
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => put('/notification-preferences', p.map(({ category, in_app, email }) => ({ category, in_app, email }))), { success: 'Preferences saved.' }); }}>
      <table className="w-full text-sm"><caption className="sr-only">Notification preferences</caption><thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="pb-2 font-medium">Category</th><th scope="col" className="pb-2 text-center font-medium">In app</th><th scope="col" className="pb-2 text-center font-medium">Email</th></tr></thead>
        <tbody className="divide-y divide-border">{p.map((x) => (
          <tr key={x.category}><th scope="row" className="py-3 pr-4 text-left font-normal"><div className="font-medium">{LABELS[x.category]?.[0]}</div><div className="text-xs text-muted-foreground">{LABELS[x.category]?.[1]}</div></th>
            <td className="text-center"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" aria-label={`${LABELS[x.category]?.[0]} in app`} checked={x.in_app} onChange={(e) => set(x.category, 'in_app', e.target.checked)} /></td>
            <td className="text-center"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" aria-label={`${LABELS[x.category]?.[0]} email`} checked={x.email && x.emailAvailable} disabled={!x.emailAvailable} onChange={(e) => set(x.category, 'email', e.target.checked)} /></td></tr>))}</tbody></table>
      {!prefs[0]?.emailAvailable && <p className="mt-3 text-xs text-muted-foreground">Email delivery is not configured on this server, so notifications are in-app only.</p>}
      <Button className="mt-4" type="submit" disabled={busy}>Save preferences</Button>
    </form>
  );
}
export { api };
