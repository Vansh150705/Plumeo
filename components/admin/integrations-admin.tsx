'use client';

import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAction } from '@/components/use-action';
import { del, patch, post, put } from '@/lib/api-client';
import { fmtDateTime } from '@/lib/utils';

const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success('Copied.'); } catch { toast.error('Copy failed.'); } };

export function SsoPanel({ idp, redirectUri }: { idp: any | null; redirectUri: string }) {
  const { run, busy, error } = useAction();
  const [f, setF] = useState({ issuer: idp?.issuer ?? '', clientId: idp?.client_id ?? '', clientSecret: '', domains: (idp?.allowed_domains ?? []).join(', '), jit: !!idp?.jit_provisioning, enforce: !!idp?.enforce_sso, enabled: idp?.enabled ?? true });
  const save = () => run(() => put('/integrations/sso', { issuer: f.issuer.trim(), clientId: f.clientId.trim(), ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}), allowedDomains: f.domains.split(',').map((d: string) => d.trim().toLowerCase()).filter(Boolean), jitProvisioning: f.jit, enforceSso: f.enforce, enabled: f.enabled }), { success: 'Single sign-on saved.' }).then(() => setF((s) => ({ ...s, clientSecret: '' })));
  return (
    <Card><CardHeader className="pb-3"><CardTitle>Single sign-on (OpenID Connect)</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Works with any OIDC provider (Microsoft Entra ID, Google Workspace, Okta…). Register Plumeo as a web application with the redirect URI below, using the authorization-code flow.</p>
      <Field label="Redirect URI" htmlFor="ru"><div className="flex gap-2"><Input id="ru" readOnly value={redirectUri} onFocus={(e) => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => copy(redirectUri)}><Copy className="size-4" aria-hidden /><span className="sr-only">Copy</span></Button></div></Field>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <Field label="Issuer URL" htmlFor="iss" hint="e.g. https://login.microsoftonline.com/<tenant-id>/v2.0"><Input id="iss" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Client ID" htmlFor="cid"><Input id="cid" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} /></Field><Field label="Client secret" htmlFor="cs" hint={idp ? 'Leave blank to keep the stored secret (stored encrypted)' : undefined}><Input id="cs" type="password" autoComplete="off" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} /></Field></div>
      <Field label="Allowed email domains" htmlFor="dom" hint="Comma-separated. Empty = any domain the provider vouches for."><Input id="dom" value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="example.com" /></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={f.jit} onChange={(e) => setF({ ...f, jit: e.target.checked })} /><span>Create accounts on first sign-in<span className="block text-xs text-muted-foreground">New people get the Employee role only. Without this, people must be added first (manually or via SCIM).</span></span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={f.enforce} onChange={(e) => setF({ ...f, enforce: e.target.checked })} /><span>Require single sign-on<span className="block text-xs text-muted-foreground">Disables password sign-in for everyone except organisation administrators (break-glass). Available once someone has signed in with SSO.</span></span></label>
      <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Enabled</label>
        <div className="flex gap-2">{idp && <Button variant="ghost" disabled={busy} onClick={() => confirm('Remove the SSO configuration?') && run(() => del('/integrations/sso'), { success: 'Removed.' })}>Remove</Button>}<Button disabled={busy || !f.issuer || !f.clientId || (!idp && !f.clientSecret)} onClick={save}>Save</Button></div></div>
    </CardContent></Card>
  );
}

export function ScimPanel({ tokens, baseUrl }: { tokens: any[]; baseUrl: string }) {
  const { run, busy } = useAction(); const [name, setName] = useState(''); const [fresh, setFresh] = useState<string | null>(null);
  return (
    <Card><CardHeader className="pb-3"><CardTitle>SCIM provisioning</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Let your identity provider create, update and deactivate people automatically (SCIM 2.0 Users, including manager and department). Groups are not supported yet.</p>
      <Field label="SCIM base URL" htmlFor="sb"><div className="flex gap-2"><Input id="sb" readOnly value={baseUrl} onFocus={(e) => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => copy(baseUrl)}><Copy className="size-4" aria-hidden /><span className="sr-only">Copy</span></Button></div></Field>
      {fresh && <div role="status" className="rounded-lg border border-[hsl(var(--gold))]/40 bg-[hsl(var(--gold))]/5 p-3 text-sm"><div className="mb-1 font-medium">Copy this token now — it is shown only once.</div><div className="flex gap-2"><Input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} aria-label="New SCIM token" /><Button variant="outline" onClick={() => copy(fresh)}>Copy</Button></div></div>}
      <ul className="divide-y divide-border">{tokens.map((t) => <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm"><div><span className="font-medium">{t.name}</span> {t.revoked_at ? <Pill>revoked</Pill> : <Pill variant="green">active</Pill>}<div className="text-xs text-muted-foreground">Created {fmtDateTime(t.created_at)} · {t.last_used_at ? `last used ${fmtDateTime(t.last_used_at)}` : 'never used'}</div></div>{!t.revoked_at && <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm('Revoke this token? The provisioning connection will stop working.') && run(() => del(`/integrations/scim-tokens/${t.id}`), { success: 'Revoked.' })}>Revoke</Button>}</li>)}</ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => post<{ token: string }>('/integrations/scim-tokens', { name }), { success: 'Token created.' }).then((r) => { if (r) { setFresh(r.token); setName(''); } }); }}><Input aria-label="Token name" placeholder="Token name, e.g. Entra provisioning" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" disabled={busy || name.trim().length < 2}>Create token</Button></form>
    </CardContent></Card>
  );
}

export function WebhooksPanel({ hooks }: { hooks: any[] }) {
  const { run, busy, error } = useAction();
  const [f, setF] = useState({ kind: 'slack', name: '', url: '', events: ['goal.activated', 'goal.completed'] });
  return (
    <Card><CardHeader className="pb-3"><CardTitle>Slack &amp; Microsoft Teams</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Post organisation-level announcements to a channel via an incoming webhook: company/department goals being approved or completed. Personal notifications are never posted to channels. Webhook URLs are stored encrypted and only the allowed provider domains are accepted.</p>
      <ul className="divide-y divide-border">{hooks.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"><div><span className="font-medium">{h.name}</span> <Pill variant="blue">{h.kind}</Pill> {!h.enabled && <Pill>paused</Pill>}<div className="text-xs text-muted-foreground">{h.url_hint} · {h.events.join(', ')} · {h.sent} sent{h.failed ? `, ${h.failed} failed` : ''}</div></div>
        <div className="flex gap-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => post(`/integrations/webhooks/${h.id}/test`), { success: 'Test message queued — it is delivered within a minute.' })}>Send test</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => patch(`/integrations/webhooks/${h.id}`, { enabled: !h.enabled }))}>{h.enabled ? 'Pause' : 'Resume'}</Button><Button size="icon" variant="ghost" aria-label={`Delete ${h.name}`} disabled={busy} onClick={() => confirm('Delete this integration?') && run(() => del(`/integrations/webhooks/${h.id}`), { success: 'Deleted.' })}><Trash2 className="size-4" aria-hidden /></Button></div></li>)}</ul>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => post('/integrations/webhooks', f), { success: 'Integration added.' }).then((r) => r && setF({ ...f, name: '', url: '' })); }}>
        <Field label="Service" htmlFor="wk"><Select id="wk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="slack">Slack</option><option value="teams">Microsoft Teams</option></Select></Field>
        <Field label="Name" htmlFor="wn"><Input id="wn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="#company-goals" /></Field>
        <Field label="Incoming webhook URL" htmlFor="wu" className="sm:col-span-2"><Input id="wu" type="url" autoComplete="off" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-4 sm:col-span-2">{[['goal.activated', 'Company & department goal approved'], ['goal.completed', 'Company & department goal completed']].map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={f.events.includes(k)} onChange={(e) => setF({ ...f, events: e.target.checked ? [...f.events, k] : f.events.filter((x) => x !== k) })} />{l}</label>)}</div>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy || !f.name || !f.url || f.events.length === 0}>Add integration</Button></div>
      </form></CardContent></Card>
  );
}
