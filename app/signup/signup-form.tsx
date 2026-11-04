'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { post, ApiError } from '@/lib/api-client';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value, ...(k === 'name' && !slugTouched ? { slug: slugify(e.target.value) } : {}) }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await post('/auth/signup', { ...f, createFirstCycle: true }); router.push('/app/admin/people?welcome=1'); router.refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create the workspace.'); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <Field label="Organisation name" htmlFor="name"><Input id="name" value={f.name} onChange={set('name')} required minLength={2} /></Field>
      <Field label="Workspace address" htmlFor="slug" hint="Lowercase letters, numbers and hyphens. People type this when signing in."><Input id="slug" value={f.slug} onChange={(e) => { setSlugTouched(true); setF((p) => ({ ...p, slug: slugify(e.target.value) })); }} required /></Field>
      <Field label="Your name" htmlFor="adminName"><Input id="adminName" value={f.adminName} onChange={set('adminName')} autoComplete="name" required /></Field>
      <Field label="Work email" htmlFor="adminEmail"><Input id="adminEmail" type="email" value={f.adminEmail} onChange={set('adminEmail')} autoComplete="username" required /></Field>
      <Field label="Password" htmlFor="adminPassword" hint="At least 12 characters."><Input id="adminPassword" type="password" value={f.adminPassword} onChange={set('adminPassword')} autoComplete="new-password" minLength={12} required /></Field>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</Button>
    </form>
  );
}
