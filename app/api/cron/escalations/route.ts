import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Vercel cron: runs nightly to catch lapses and fire off escalations.
 * Add to vercel.json: { "crons": [{ "path": "/api/cron/escalations", "schedule": "0 2 * * *" }] }
 *
 * Uses the admin client so it runs without an authenticated user. A real prod
 * deployment would gate this with a CRON_SECRET header from Vercel.
 */
export async function GET(req: Request) {
  const secret = req.headers.get('authorization');
  if (process.env.CRON_SECRET && secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rules } = await admin.from('escalation_rules').select('*').eq('is_active', true);
  const { data: cycle } = await admin.from('cycles').select('*').eq('is_active', true).single();
  if (!rules || !cycle) return NextResponse.json({ ok: true, triggered: 0 });

  const { data: sheets } = await admin
    .from('goal_sheets')
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .eq('cycle_id', cycle.id);
  if (!sheets) return NextResponse.json({ ok: true, triggered: 0 });

  let triggered = 0;
  const now = Date.now();
  const daysSince = (d: string | null) => d ? Math.floor((now - new Date(d).getTime()) / 86400000) : Infinity;

  for (const rule of rules) {
    for (const sheet of sheets) {
      let shouldTrigger = false;
      let reason = '';
      const employee = (sheet as any).employee;

      if (rule.trigger_type === 'goal_not_submitted' && sheet.status === 'Draft') {
        const since = daysSince(cycle.goal_window_start);
        if (since >= rule.threshold_days) {
          shouldTrigger = true;
          reason = `Draft for ${since} days since cycle opened.`;
        }
      } else if (rule.trigger_type === 'approval_pending' && sheet.status === 'Submitted' && sheet.submitted_at) {
        const since = daysSince(sheet.submitted_at);
        if (since >= rule.threshold_days) {
          shouldTrigger = true;
          reason = `Awaiting approval ${since} days.`;
        }
      }

      if (shouldTrigger) {
        const { data: dup } = await admin
          .from('escalation_events')
          .select('id')
          .eq('rule_id', rule.id)
          .eq('subject_id', employee.id)
          .gte('triggered_at', new Date(now - 86400000).toISOString())
          .maybeSingle();
        if (dup) continue;

        await admin.from('escalation_events').insert({
          rule_id: rule.id, subject_id: employee.id, sheet_id: sheet.id,
          level: rule.escalate_to, reason,
        });
        triggered++;
      }
    }
  }

  return NextResponse.json({ ok: true, triggered, ranAt: new Date().toISOString() });
}
