import { requireCtx, requirePermPage } from '@/server/auth/request';
import { getIdentityProvider, listScimTokens, listWebhooks } from '@/server/services/integrations';
import { deliveryStats } from '@/server/services/notifications';
import { mailEnabled } from '@/server/services/mailer';
import { config } from '@/server/core/config';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { ScimPanel, SsoPanel, WebhooksPanel } from '@/components/admin/integrations-admin';

export const metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const ctx = await requireCtx(); requirePermPage(ctx, 'integrations.manage');
  const [idp, tokens, hooks, stats] = await Promise.all([getIdentityProvider(ctx), listScimTokens(ctx), listWebhooks(ctx), deliveryStats(ctx)]);
  return (
    <div>
      <PageHeader title="Integrations" description="Connect your identity provider and chat tools. Only integrations that are actually implemented appear here." />
      <div className="space-y-6">
        <SsoPanel idp={idp} redirectUri={`${config().APP_URL}/api/v1/auth/sso/callback`} />
        <ScimPanel tokens={tokens as any[]} baseUrl={`${config().APP_URL}/api/scim/v2`} />
        <WebhooksPanel hooks={hooks as any[]} />
        <Card><CardHeader className="pb-3"><CardTitle>Email &amp; delivery status</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">Email notifications {mailEnabled() ? <Pill variant="green">configured</Pill> : <Pill variant="orange">not configured</Pill>}</div>
          {!mailEnabled() && <p className="text-muted-foreground">Set <code className="rounded bg-muted px-1">SMTP_URL</code> on the server to enable email. Until then notifications are in-app only and nothing is claimed as sent.</p>}
          {stats.length > 0 && <table className="w-full text-xs"><caption className="sr-only">Delivery status</caption><thead><tr className="text-left text-muted-foreground"><th scope="col" className="pb-1 font-medium">Channel</th><th scope="col" className="pb-1 font-medium">Status</th><th scope="col" className="pb-1 text-right font-medium">Count</th></tr></thead><tbody>{stats.map((s: any, i: number) => <tr key={i}><td className="py-0.5">{s.channel}</td><td>{s.status}</td><td className="text-right tabular-nums">{s.n}</td></tr>)}</tbody></table>}
        </CardContent></Card>
      </div>
    </div>
  );
}
