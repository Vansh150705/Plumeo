import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (appUser?.role !== 'Admin') return new NextResponse('Forbidden', { status: 403 });

  const { data: entries } = await supabase
    .from('audit_log')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(10000);

  const csvEscape = (v: any): string => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const rows = ['Timestamp,Actor,Entity type,Entity ID,Action,Reason,Before,After'];
  for (const e of entries ?? []) {
    rows.push([
      e.occurred_at, e.actor_name, e.entity_type, e.entity_id, e.action, e.reason ?? '',
      e.before_data, e.after_data,
    ].map(csvEscape).join(','));
  }

  return new NextResponse(rows.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="atomquest-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
