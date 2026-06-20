'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { validateSheet, computeScore, activeQuarter } from '@/lib/goals';
import type { Goal, CheckIn, NotifChannel } from '@/lib/types';
import { ok, fail } from '@/lib/result';
import {
  parseInput,
  goalInputSchema,
  checkInInputSchema,
  pushSharedGoalSchema,
  nonEmptyComment,
} from '@/lib/validation';

// pull the signed-in AppUser, or send them back to the landing page
async function requireUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  const { data: appUser } = await supabase.from('users').select('*').eq('id', user.id).single();
  if (!appUser) throw new Error('USER_NOT_PROVISIONED');
  return { supabase, appUser };
}

// writes one audit-log row; we call this on every lifecycle change
async function audit(
  entity_type: 'goal' | 'check_in' | 'sheet',
  entity_id: string,
  action: string,
  before: any,
  after: any,
  reason?: string,
) {
  const { supabase, appUser } = await requireUser();
  await supabase.from('audit_log').insert({
    entity_type, entity_id, action,
    before_data: before, after_data: after,
    actor_id: appUser.id, actor_name: appUser.full_name,
    reason: reason ?? null,
  });
}

// fans one event out into Email + Teams + in-app notification rows
async function notify(args: {
  recipient_id: string;
  subject: string;
  body: string;
  deep_link?: string;
  channels?: NotifChannel[];
  payload?: any;
}) {
  const { supabase } = await requireUser();
  const channels = args.channels ?? ['Email', 'Teams', 'InApp'];
  const rows = channels.map(channel => ({
    recipient_id: args.recipient_id,
    channel,
    subject: args.subject,
    body: args.body,
    deep_link: args.deep_link ?? null,
    payload: args.payload ?? null,
    // In a real deployment a worker flips sent_at when it ships to SES / MS Graph.
    // For demo, we set sent_at immediately on Email/Teams so the notification
    // center shows a realistic "Sent" state without an actual delivery worker.
    sent_at: channel === 'InApp' ? null : new Date().toISOString(),
  }));
  await supabase.from('notifications').insert(rows);
}

// ----- sheet actions -----

/** Get or create the current cycle's goal sheet for the logged-in employee. */
export async function getOrCreateMySheet() {
  const { supabase, appUser } = await requireUser();
  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  if (!cycle) throw new Error('NO_ACTIVE_CYCLE');

  const { data: existing } = await supabase
    .from('goal_sheets')
    .select('*')
    .eq('cycle_id', cycle.id)
    .eq('employee_id', appUser.id)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('goal_sheets')
    .insert({ cycle_id: cycle.id, employee_id: appUser.id, status: 'Draft' })
    .select()
    .single();
  if (error) throw error;
  return created;
}

/** Submit a sheet for approval, after running every validation rule. */
export async function submitSheet(sheet_id: string) {
  const { supabase, appUser } = await requireUser();

  const { data: goals } = await supabase.from('goals').select('*').eq('sheet_id', sheet_id);
  const issues = validateSheet(goals ?? []);
  if (issues.length > 0) {
    return fail('Resolve the highlighted issues before submitting.', issues);
  }

  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({ status: 'Submitted', submitted_at: new Date().toISOString() })
    .eq('id', sheet_id)
    .select()
    .single();

  await audit('sheet', sheet_id, 'submit', null, sheet);

  // Notify manager
  if (appUser.manager_id) {
    await notify({
      recipient_id: appUser.manager_id,
      subject: `${appUser.full_name} submitted their goal sheet`,
      body: `${appUser.full_name} (${appUser.department}) submitted ${goals?.length ?? 0} goals for review.`,
      deep_link: `/manager/approvals`,
      payload: { event: 'sheet_submitted', sheet_id, employee_id: appUser.id },
    });
  }

  revalidatePath('/employee');
  revalidatePath('/manager');
  return ok({});
}

/** Manager approves a sheet, which locks it for the rest of the cycle. */
export async function approveSheet(sheet_id: string) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Manager' && appUser.role !== 'Admin') throw new Error('FORBIDDEN');

  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({
      status: 'Approved',
      approved_at: new Date().toISOString(),
      approved_by: appUser.id,
      locked_at: new Date().toISOString(),
    })
    .eq('id', sheet_id)
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .single();

  await audit('sheet', sheet_id, 'approve', null, sheet);

  if (sheet?.employee) {
    await notify({
      recipient_id: sheet.employee.id,
      subject: 'Your goal sheet was approved',
      body: `${appUser.full_name} approved your goals. Your sheet is now locked for the cycle.`,
      deep_link: `/employee`,
      payload: { event: 'sheet_approved', sheet_id },
    });
  }
  revalidatePath('/manager');
  revalidatePath('/employee');
  return ok({});
}

/** Manager returns a sheet for rework with a comment. */
export async function returnSheet(sheet_id: string, comment: string) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Manager' && appUser.role !== 'Admin') throw new Error('FORBIDDEN');
  if (!parseInput(nonEmptyComment, comment).ok) return fail('Comment required when returning.');

  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({
      status: 'Returned',
      returned_at: new Date().toISOString(),
      return_comment: comment,
    })
    .eq('id', sheet_id)
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .single();

  await audit('sheet', sheet_id, 'return', null, sheet, comment);

  if (sheet?.employee) {
    await notify({
      recipient_id: sheet.employee.id,
      subject: 'Your goal sheet was returned for rework',
      body: `${appUser.full_name} sent your sheet back with this comment:\n\n"${comment}"`,
      deep_link: `/employee`,
      payload: { event: 'sheet_returned', sheet_id, comment },
    });
  }
  revalidatePath('/manager');
  revalidatePath('/employee');
  return ok({});
}

/** Admin reopens a locked sheet; from here on every edit is written to the audit log. */
export async function unlockSheet(sheet_id: string, reason: string) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Admin') throw new Error('FORBIDDEN');
  if (!parseInput(nonEmptyComment, reason).ok) return fail('Reason required.');

  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({ status: 'Draft', locked_at: null, approved_at: null })
    .eq('id', sheet_id)
    .select()
    .single();

  await audit('sheet', sheet_id, 'unlock', null, sheet, reason);
  revalidatePath('/admin');
  return ok({});
}

// ----- goal actions -----
export async function upsertGoal(goal: Partial<Goal> & { sheet_id: string }) {
  const { supabase } = await requireUser();

  const parsed = parseInput(goalInputSchema, goal);
  if (!parsed.ok) return fail(parsed.error);

  const isUpdate = !!parsed.data.id;
  let before: any = null;
  if (isUpdate) {
    const { data } = await supabase.from('goals').select('*').eq('id', parsed.data.id!).single();
    before = data;
  }
  const { data: after, error } = await supabase
    .from('goals')
    .upsert(parsed.data as any)
    .select()
    .single();
  if (error) return fail(error.message);

  await audit('goal', after.id, isUpdate ? 'update' : 'create', before, after);
  revalidatePath('/employee');
  revalidatePath('/manager');
  return ok({ goal: after });
}

export async function deleteGoal(goal_id: string) {
  const { supabase } = await requireUser();
  const { data: before } = await supabase.from('goals').select('*').eq('id', goal_id).single();
  const { error } = await supabase.from('goals').delete().eq('id', goal_id);
  if (error) return fail(error.message);
  await audit('goal', goal_id, 'delete', before, null);
  revalidatePath('/employee');
  return ok({});
}

// ----- shared goals: a manager or admin pushes one goal to many reports -----
/**
 * Manager/Admin creates a master goal (is_shared_origin = true) on their own
 * sheet, then this function clones it onto each recipient's sheet with
 * shared_origin_id pointing back. Recipients may adjust weightage only;
 * the UI enforces read-only Title/Target.
 */
export async function pushSharedGoal(args: {
  origin_goal_id: string;
  recipient_employee_ids: string[];
  default_weightage: number;
}) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Manager' && appUser.role !== 'Admin') throw new Error('FORBIDDEN');

  const parsed = parseInput(pushSharedGoalSchema, args);
  if (!parsed.ok) return fail(parsed.error);
  const { origin_goal_id, recipient_employee_ids, default_weightage } = parsed.data;

  const { data: origin } = await supabase.from('goals').select('*').eq('id', origin_goal_id).single();
  if (!origin) return fail('Origin goal not found.');

  // Mark origin as shared if not already
  if (!origin.is_shared_origin) {
    await supabase.from('goals').update({ is_shared_origin: true }).eq('id', origin.id);
  }

  const { data: cycle } = await supabase.from('cycles').select('id').eq('is_active', true).single();
  if (!cycle) return fail('No active cycle.');

  // Batch: one query for every recipient's existing sheet, then create the
  // missing ones in a single insert — instead of two round-trips per recipient.
  const { data: existingSheets } = await supabase
    .from('goal_sheets')
    .select('id, employee_id')
    .eq('cycle_id', cycle.id)
    .in('employee_id', recipient_employee_ids);

  const sheetByEmployee = new Map<string, string>(
    (existingSheets ?? []).map((s) => [s.employee_id as string, s.id as string]),
  );
  const missing = recipient_employee_ids.filter((id) => !sheetByEmployee.has(id));
  if (missing.length) {
    const { data: created } = await supabase
      .from('goal_sheets')
      .insert(missing.map((employee_id) => ({ cycle_id: cycle.id, employee_id, status: 'Draft' as const })))
      .select('id, employee_id');
    for (const s of created ?? []) sheetByEmployee.set(s.employee_id as string, s.id as string);
  }

  // Clone inserts stay per-recipient so one capped sheet (8-goal limit) doesn't
  // sink the whole push; we collect a per-recipient result.
  const results: { employee_id: string; ok: boolean; error?: string }[] = [];
  const notifications: Parameters<typeof notify>[0][] = [];
  for (const employee_id of recipient_employee_ids) {
    const sheet_id = sheetByEmployee.get(employee_id);
    if (!sheet_id) {
      results.push({ employee_id, ok: false, error: 'Could not resolve a goal sheet.' });
      continue;
    }
    const { error } = await supabase.from('goals').insert({
      sheet_id,
      thrust_area: origin.thrust_area,
      title: origin.title,
      description: origin.description,
      uom: origin.uom,
      direction: origin.direction,
      target_numeric: origin.target_numeric,
      target_date: origin.target_date,
      weightage: default_weightage,
      shared_origin_id: origin.id,
      is_shared_origin: false,
    });
    if (error) {
      results.push({ employee_id, ok: false, error: error.message });
    } else {
      results.push({ employee_id, ok: true });
      notifications.push({
        recipient_id: employee_id,
        subject: `New shared goal: "${origin.title}"`,
        body: `${appUser.full_name} pushed a departmental goal to your sheet. You can adjust its weightage; title and target are locked.`,
        deep_link: '/employee',
        payload: { event: 'shared_goal_pushed', origin_goal_id: origin.id },
      });
    }
  }
  await Promise.all(notifications.map((n) => notify(n)));

  revalidatePath('/employee');
  revalidatePath('/manager');
  return ok({ results });
}

// ----- check-in actions -----
export async function upsertCheckIn(payload: Partial<CheckIn> & { goal_id: string; quarter: CheckIn['quarter'] }) {
  const { supabase } = await requireUser();

  const parsed = parseInput(checkInInputSchema, payload);
  if (!parsed.ok) return fail(parsed.error);
  const input = parsed.data;

  // Recompute score server-side using the canonical formulas
  const { data: goal } = await supabase.from('goals').select('*').eq('id', input.goal_id).single();
  const score = goal ? computeScore(goal, {
    actual_numeric: input.actual_numeric ?? null,
    actual_date: input.actual_date ?? null,
    zero_achieved: input.zero_achieved ?? null,
  }) : null;

  const { data: existing } = await supabase
    .from('check_ins')
    .select('*')
    .eq('goal_id', input.goal_id)
    .eq('quarter', input.quarter)
    .maybeSingle();

  const row = { ...input, computed_score: score };
  const { data: after, error } = await supabase
    .from('check_ins')
    .upsert(row as any, { onConflict: 'goal_id,quarter' })
    .select()
    .single();
  if (error) return fail(error.message);

  await audit('check_in', after.id, existing ? 'update' : 'create', existing, after);

  // If this goal is a shared-origin clone, sync the actual to all linked goals
  if (goal?.shared_origin_id) {
    // recipient is editing their own copy; leave it, their number is independent
  } else if (goal?.is_shared_origin) {
    // owner updates → propagate actual_numeric / actual_date / zero_achieved to
    // every linked clone in a single batched upsert.
    const { data: clones } = await supabase
      .from('goals')
      .select('id')
      .eq('shared_origin_id', goal.id);
    if (clones && clones.length) {
      const cloneRows = clones.map((c) => ({
        goal_id: c.id,
        quarter: input.quarter,
        actual_numeric: input.actual_numeric ?? null,
        actual_date: input.actual_date ?? null,
        zero_achieved: input.zero_achieved ?? null,
        progress_status: input.progress_status ?? 'OnTrack',
        computed_score: score,
      }));
      await supabase.from('check_ins').upsert(cloneRows, { onConflict: 'goal_id,quarter' });
    }
  }

  revalidatePath('/employee');
  revalidatePath('/manager');
  return ok({ check_in: after, score });
}

/** Manager adds a check-in comment after reviewing achievement vs target. */
export async function managerCheckIn(check_in_id: string, comment: string) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Manager' && appUser.role !== 'Admin') throw new Error('FORBIDDEN');

  const { data: before } = await supabase.from('check_ins').select('*').eq('id', check_in_id).single();
  const { data: after } = await supabase
    .from('check_ins')
    .update({
      manager_comment: comment,
      manager_checked_at: new Date().toISOString(),
      manager_checked_by: appUser.id,
    })
    .eq('id', check_in_id)
    .select()
    .single();
  await audit('check_in', check_in_id, 'manager_review', before, after);
  revalidatePath('/manager');
  return ok({});
}

// ----- escalation engine: run by the nightly cron, or on demand from the admin UI -----
export async function runEscalationSweep() {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Admin') throw new Error('FORBIDDEN');

  const { data: rules } = await supabase.from('escalation_rules').select('*').eq('is_active', true);
  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  if (!rules || !cycle) return ok({ triggered: 0 });

  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .eq('cycle_id', cycle.id);
  if (!sheets) return ok({ triggered: 0 });

  const now = Date.now();
  const daysSince = (d: string | null) => d ? Math.floor((now - new Date(d).getTime()) / 86400000) : Infinity;

  // --- Pre-load everything the sweep needs, once, instead of per (rule, sheet). ---

  // Which quarter is open, and how long has it been open? Drives checkin_overdue.
  const quarter = activeQuarter(cycle);
  const quarterOpenedDaysAgo = quarter
    ? daysSince((cycle as any)[`${quarter.toLowerCase()}_open`])
    : Infinity;

  // Goals + their check-ins for the current quarter, so we can tell which
  // approved sheets are missing a check-in. One query each, not one per sheet.
  const approvedSheetIds = sheets.filter((s) => s.status === 'Approved').map((s) => s.id);
  const goalsBySheet = new Map<string, { id: string }[]>();
  const checkedGoalIds = new Set<string>();
  if (quarter && approvedSheetIds.length) {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, sheet_id')
      .in('sheet_id', approvedSheetIds);
    for (const g of goals ?? []) {
      const arr = goalsBySheet.get(g.sheet_id) ?? [];
      arr.push({ id: g.id });
      goalsBySheet.set(g.sheet_id, arr);
    }
    const goalIds = (goals ?? []).map((g) => g.id);
    if (goalIds.length) {
      const { data: checkIns } = await supabase
        .from('check_ins')
        .select('goal_id')
        .eq('quarter', quarter)
        .in('goal_id', goalIds);
      for (const c of checkIns ?? []) checkedGoalIds.add(c.goal_id);
    }
  }

  // Recently-fired events, once, to de-dupe within 24h.
  const { data: recentEvents } = await supabase
    .from('escalation_events')
    .select('rule_id, subject_id')
    .gte('triggered_at', new Date(now - 86400000).toISOString());
  const firedRecently = new Set(
    (recentEvents ?? []).map((e) => `${e.rule_id}:${e.subject_id}`),
  );

  // Resolve the HR recipient + a manager→skip-level map up front.
  const { data: hrAdmin } = await supabase.from('users').select('id').eq('role', 'Admin').limit(1).maybeSingle();
  const managerIds = Array.from(
    new Set(sheets.map((s) => s.employee?.manager_id).filter(Boolean) as string[]),
  );
  const skipLevelByManager = new Map<string, string | null>();
  if (managerIds.length) {
    const { data: mgrs } = await supabase.from('users').select('id, manager_id').in('id', managerIds);
    for (const m of mgrs ?? []) skipLevelByManager.set(m.id, m.manager_id ?? null);
  }

  const events: { rule_id: string; subject_id: string; sheet_id: string; level: string; reason: string }[] = [];
  const notifications: Parameters<typeof notify>[0][] = [];

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

      events.push({
        rule_id: rule.id,
        subject_id: employee.id,
        sheet_id: sheet.id,
        level: rule.escalate_to,
        reason,
      });

      // Resolve who to notify from the pre-loaded maps.
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
          subject: `Escalation: ${rule.name}`,
          body: `${employee.full_name}: ${reason}`,
          deep_link: `/admin/escalations`,
          payload: { event: 'escalation', rule_id: rule.id, subject_id: employee.id },
        });
      }
    }
  }

  // One batched insert for the events, then fan out the notifications.
  if (events.length) await supabase.from('escalation_events').insert(events);
  await Promise.all(notifications.map((n) => notify(n)));

  revalidatePath('/admin');
  return ok({ triggered: events.length });
}
