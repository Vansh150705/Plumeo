import type { SupabaseClient } from '@supabase/supabase-js';
import { activeQuarter } from '@/lib/goals';

/**
 * The escalation sweep: finds lapses (sheet not submitted, approval stuck, check-in overdue),
 * records an escalation event, and notifies the right person.
 *
 * One implementation shared by the nightly cron (service-role client) and the admin's
 * "run now" button (the admin's own RLS-scoped client), so they can never drift apart.
 * All reads are batched up front; there is no per-sheet query.
 */
export async function sweepEscalations(db: SupabaseClient): Promise<{ triggered: number }> {
  const { data: rules } = await db.from('escalation_rules').select('*').eq('is_active', true);
  const { data: cycle } = await db.from('cycles').select('*').eq('is_active', true).maybeSingle();
  if (!rules?.length || !cycle) return { triggered: 0 };

  const { data: sheets } = await db
    .from('goal_sheets')
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .eq('cycle_id', cycle.id);
  if (!sheets?.length) return { triggered: 0 };

  const now = Date.now();
  const daysSince = (d: string | null) => (d ? Math.floor((now - new Date(d).getTime()) / 86400000) : Infinity);

  // Which quarter is open, and for how long? Drives checkin_overdue.
  const quarter = activeQuarter(cycle);
  const quarterOpenedDaysAgo = quarter ? daysSince((cycle as any)[`${quarter.toLowerCase()}_open`]) : Infinity;

  // Goals and this quarter's check-ins for approved sheets: one query each, not one per sheet.
  const approvedSheetIds = sheets.filter((s) => s.status === 'Approved').map((s) => s.id);
  const goalsBySheet = new Map<string, { id: string }[]>();
  const checkedGoalIds = new Set<string>();
  if (quarter && approvedSheetIds.length) {
    const { data: goals } = await db.from('goals').select('id, sheet_id').in('sheet_id', approvedSheetIds);
    for (const g of goals ?? []) {
      const arr = goalsBySheet.get(g.sheet_id) ?? [];
      arr.push({ id: g.id });
      goalsBySheet.set(g.sheet_id, arr);
    }
    const goalIds = (goals ?? []).map((g) => g.id);
    if (goalIds.length) {
      const { data: checkIns } = await db.from('check_ins').select('goal_id').eq('quarter', quarter).in('goal_id', goalIds);
      for (const c of checkIns ?? []) checkedGoalIds.add(c.goal_id);
    }
  }

  // Events fired in the last 24h, to de-dupe.
  const { data: recentEvents } = await db
    .from('escalation_events')
    .select('rule_id, subject_id')
    .gte('triggered_at', new Date(now - 86400000).toISOString());
  const firedRecently = new Set((recentEvents ?? []).map((e) => `${e.rule_id}:${e.subject_id}`));

  // Who to notify: the HR admin, and each manager's own manager (skip level).
  const { data: hrAdmin } = await db.from('users').select('id').eq('role', 'Admin').limit(1).maybeSingle();
  const managerIds = Array.from(new Set(sheets.map((s) => s.employee?.manager_id).filter(Boolean) as string[]));
  const skipLevelByManager = new Map<string, string | null>();
  if (managerIds.length) {
    const { data: mgrs } = await db.from('users').select('id, manager_id').in('id', managerIds);
    for (const m of mgrs ?? []) skipLevelByManager.set(m.id, m.manager_id ?? null);
  }

  const events: { rule_id: string; subject_id: string; sheet_id: string; level: string; reason: string }[] = [];
  const notifications: {
    recipient_id: string; channel: 'InApp'; subject: string; body: string; deep_link: string; payload: unknown;
  }[] = [];

  for (const rule of rules) {
    for (const sheet of sheets) {
      const employee = sheet.employee;
      if (!employee) continue;
      let reason = '';

      if (rule.trigger_type === 'goal_not_submitted') {
        if (sheet.status === 'Draft') {
          const since = daysSince(cycle.goal_window_start);
          if (since >= rule.threshold_days) reason = `Sheet still in Draft ${since} days after cycle opened.`;
        }
      } else if (rule.trigger_type === 'approval_pending') {
        if (sheet.status === 'Submitted' && sheet.submitted_at) {
          const since = daysSince(sheet.submitted_at);
          if (since >= rule.threshold_days) reason = `Submitted ${since} days ago, still awaiting approval.`;
        }
      } else if (rule.trigger_type === 'checkin_overdue') {
        // Only meaningful once a quarter has been open at least threshold_days.
        if (quarter && sheet.status === 'Approved' && quarterOpenedDaysAgo >= rule.threshold_days) {
          const goals = goalsBySheet.get(sheet.id) ?? [];
          const missing = goals.filter((g) => !checkedGoalIds.has(g.id));
          if (goals.length > 0 && missing.length > 0) {
            reason = `${missing.length} of ${goals.length} goals have no ${quarter} check-in (${quarterOpenedDaysAgo} days into the quarter).`;
          }
        }
      }
      if (!reason) continue;

      const dedupeKey = `${rule.id}:${employee.id}`;
      if (firedRecently.has(dedupeKey)) continue;
      firedRecently.add(dedupeKey); // also de-dupe across rules within this run

      events.push({ rule_id: rule.id, subject_id: employee.id, sheet_id: sheet.id, level: rule.escalate_to, reason });

      let recipient_id: string | null = null;
      if (rule.escalate_to === 'Employee') recipient_id = employee.id;
      else if (rule.escalate_to === 'Manager') recipient_id = employee.manager_id;
      else if (rule.escalate_to === 'HR') recipient_id = hrAdmin?.id ?? null;
      else if (rule.escalate_to === 'SkipLevel' && employee.manager_id) {
        recipient_id = skipLevelByManager.get(employee.manager_id) ?? null;
      }
      if (recipient_id) {
        notifications.push({
          recipient_id,
          channel: 'InApp',
          subject: `Escalation: ${rule.name}`,
          body: `${employee.full_name}: ${reason}`,
          deep_link: '/admin/escalations',
          payload: { event: 'escalation', rule_id: rule.id, subject_id: employee.id },
        });
      }
    }
  }

  if (events.length) {
    const { error } = await db.from('escalation_events').insert(events);
    if (error) throw new Error(`Could not record escalation events: ${error.message}`);
  }
  if (notifications.length) {
    const { error } = await db.from('notifications').insert(notifications);
    if (error) throw new Error(`Could not send escalation notifications: ${error.message}`);
  }
  return { triggered: events.length };
}
