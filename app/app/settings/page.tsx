import { requireCtx } from '@/server/auth/request';
import { getUser } from '@/server/services/users';
import { getPreferences } from '@/server/services/notifications';
import { listMySessions } from '@/server/auth/sessions';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordForm, PreferencesForm, ProfileForm, SessionList } from '@/components/settings-panels';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [me, prefs, sessions] = await Promise.all([getUser(ctx, ctx.userId), getPreferences(ctx), listMySessions(ctx)]);
  return (
    <div>
      <PageHeader title="Settings" description={`Signed in as ${me.email}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader className="pb-3"><CardTitle>Profile</CardTitle></CardHeader><CardContent><ProfileForm name={me.full_name} title={me.job_title} /></CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle>Password</CardTitle></CardHeader><CardContent><PasswordForm /></CardContent></Card>
        <Card id="notifications" className="lg:col-span-2"><CardHeader className="pb-3"><CardTitle>Notifications</CardTitle></CardHeader><CardContent><PreferencesForm prefs={prefs} /></CardContent></Card>
        <Card className="lg:col-span-2"><CardHeader className="pb-1"><CardTitle>Active sessions</CardTitle></CardHeader><CardContent><SessionList sessions={sessions as any[]} /></CardContent></Card>
      </div>
    </div>
  );
}
