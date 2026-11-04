'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { post, ApiError } from '@/lib/api-client';

export function AcceptForm({ token }: { token: string }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!token) return <p className="text-sm text-muted-foreground">This link is missing its token. Open the link from your invitation email again.</p>;
  if (done) return <div className="space-y-4"><p className="text-sm">Your password is set. You can sign in now.</p><Button asChild className="w-full"><Link href={`/login?org=${encodeURIComponent(done)}`}>Go to sign in</Link></Button></div>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (pw !== pw2) return setError('The passwords do not match.');
    setBusy(true);
    try { const r = await post<{ orgSlug: string }>('/auth/accept-invite', { token, password: pw }); setDone(r.orgSlug ?? ''); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not set the password.'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <Field label="New password" htmlFor="pw" hint="At least 12 characters."><Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={12} required /></Field>
      <Field label="Confirm password" htmlFor="pw2"><Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></Field>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</Button>
    </form>
  );
}
