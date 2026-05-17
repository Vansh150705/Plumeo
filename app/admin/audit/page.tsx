import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { AuditClient } from './audit-client';

export default async function AuditPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');
  const { data: entries } = await supabase
    .from('audit_log')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(200);
  return (
    <AppShell role="Admin">
      <AuditClient entries={entries ?? []} />
    </AppShell>
  );
}
