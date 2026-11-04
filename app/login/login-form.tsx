'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { post, ApiError } from '@/lib/api-client';

export function LoginForm({ defaultOrg, initialError }: { defaultOrg: string; initialError?: string }) {
  const router = useRouter();
  const [org, setOrg] = useState(defaultOrg);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!defaultOrg) try { setOrg(localStorage.getItem('plumeo-org') ?? ''); } catch { /* storage unavailable */ } }, [defaultOrg]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await post('/auth/login', { orgSlug: org.trim().toLowerCase(), email: email.trim(), password });
      try { localStorage.setItem('plumeo-org', org.trim().toLowerCase()); } catch { /* ignore */ }
      router.push('/app'); router.refresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in.'); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <Field label="Workspace" htmlFor="org" hint="The address your administrator gave you, e.g. acme">
        <Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" required autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Work email" htmlFor="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
      <Button type="submit" className="w-full" disabled={busy || !org || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      <div className="relative py-1 text-center text-xs text-muted-foreground"><span className="relative z-10 bg-card px-2">or</span><span className="absolute inset-x-0 top-1/2 border-t border-border" /></div>
      <Button type="button" variant="outline" className="w-full" disabled={!org} onClick={() => { window.location.href = `/api/v1/auth/sso/start?org=${encodeURIComponent(org.trim().toLowerCase())}`; }}>Sign in with single sign-on</Button>
    </form>
  );
}
