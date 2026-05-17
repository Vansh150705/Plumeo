import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { EscalationsClient } from './escalations-client';

export default async function EscalationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: rules } = await supabase.from('escalation_rules').select('*').order('threshold_days');
  const { data: events } = await supabase
    .from('escalation_events')
    .select('*, rule:escalation_rules(name), subject:users!escalation_events_subject_id_fkey(full_name, department)')
    .order('triggered_at', { ascending: false })
    .limit(50);

  return (
    <AppShell role="Admin">
      <EscalationsClient rules={rules ?? []} events={(events ?? []) as any} />
    </AppShell>
  );
}
