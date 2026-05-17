'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { validateSheet, computeScore } from '@/lib/goals';
import type { Goal, GoalSheet, CheckIn, NotifChannel } from '@/lib/types';

// =============================================================================
// Helper: get the currently authenticated AppUser
// =============================================================================
async function requireUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  const { data: appUser } = await supabase.from('users').select('*').eq('id', user.id).single();
  if (!appUser) throw new Error('USER_NOT_PROVISIONED');
  return { supabase, appUser };
}

// =============================================================================
// Audit log helper — called on every lifecycle change
// =============================================================================
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

// =============================================================================
// Notification helper — queues Email + Teams + InApp on a single event
// =============================================================================
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

// =============================================================================
// SHEET ACTIONS
// =============================================================================

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

/** Submit a sheet for manager approval — enforces all BRD validations. */
export async function submitSheet(sheet_id: string) {
  const { supabase, appUser } = await requireUser();

  const { data: goals } = await supabase.from('goals').select('*').eq('sheet_id', sheet_id);
  const issues = validateSheet(goals ?? []);
  if (issues.length > 0) {
    return { ok: false, issues };
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
  return { ok: true };
}

/** Manager approves a sheet — locks it. */
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
  return { ok: true };
}

/** Manager returns a sheet for rework with a comment. */
export async function returnSheet(sheet_id: string, comment: string) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Manager' && appUser.role !== 'Admin') throw new Error('FORBIDDEN');
  if (!comment?.trim()) return { ok: false, error: 'Comment required when returning.' };

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
  return { ok: true };
}

/** Admin unlocks an approved sheet — every edit afterwards hits audit_log. */
export async function unlockSheet(sheet_id: string, reason: string) {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Admin') throw new Error('FORBIDDEN');
  if (!reason?.trim()) return { ok: false, error: 'Reason required.' };

  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({ status: 'Draft', locked_at: null, approved_at: null })
    .eq('id', sheet_id)
    .select()
    .single();

  await audit('sheet', sheet_id, 'unlock', null, sheet, reason);
  revalidatePath('/admin');
  return { ok: true };
}

// =============================================================================
// GOAL ACTIONS
// =============================================================================
export async function upsertGoal(goal: Partial<Goal> & { sheet_id: string }) {
  const { supabase } = await requireUser();
  const isUpdate = !!goal.id;
  let before: any = null;
  if (isUpdate) {
    const { data } = await supabase.from('goals').select('*').eq('id', goal.id!).single();
    before = data;
  }
  const { data: after, error } = await supabase
    .from('goals')
    .upsert(goal as any)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  await audit('goal', after.id, isUpdate ? 'update' : 'create', before, after);
  revalidatePath('/employee');
  revalidatePath('/manager');
  return { ok: true, goal: after };
}

export async function deleteGoal(goal_id: string) {
  const { supabase } = await requireUser();
  const { data: before } = await supabase.from('goals').select('*').eq('id', goal_id).single();
  const { error } = await supabase.from('goals').delete().eq('id', goal_id);
  if (error) return { ok: false, error: error.message };
  await audit('goal', goal_id, 'delete', before, null);
  revalidatePath('/employee');
  return { ok: true };
}

// =============================================================================
// SHARED GOAL FAN-OUT  (BRD §2.1 — admin/manager push goal to N recipients)
// =============================================================================
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

  const { data: origin } = await supabase.from('goals').select('*').eq('id', args.origin_goal_id).single();
  if (!origin) return { ok: false, error: 'Origin goal not found.' };

  // Mark origin as shared if not already
  if (!origin.is_shared_origin) {
    await supabase.from('goals').update({ is_shared_origin: true }).eq('id', origin.id);
  }

  const { data: cycle } = await supabase.from('cycles').select('id').eq('is_active', true).single();
  if (!cycle) return { ok: false, error: 'No active cycle.' };

  const results: { employee_id: string; ok: boolean; error?: string }[] = [];
  for (const employee_id of args.recipient_employee_ids) {
    // Ensure recipient has a sheet
    let { data: sheet } = await supabase
      .from('goal_sheets')
      .select('*')
      .eq('cycle_id', cycle.id)
      .eq('employee_id', employee_id)
      .maybeSingle();
    if (!sheet) {
      const { data: created } = await supabase
        .from('goal_sheets')
        .insert({ cycle_id: cycle.id, employee_id, status: 'Draft' })
        .select()
        .single();
      sheet = created;
    }
    // Insert linked clone
    const { error } = await supabase.from('goals').insert({
      sheet_id: sheet!.id,
      thrust_area: origin.thrust_area,
      title: origin.title,
      description: origin.description,
      uom: origin.uom,
      direction: origin.direction,
      target_numeric: origin.target_numeric,
      target_date: origin.target_date,
      weightage: args.default_weightage,
      shared_origin_id: origin.id,
      is_shared_origin: false,
    });
    if (error) {
      results.push({ employee_id, ok: false, error: error.message });
    } else {
      results.push({ employee_id, ok: true });
      await notify({
        recipient_id: employee_id,
        subject: `New shared goal: "${origin.title}"`,
        body: `${appUser.full_name} pushed a departmental goal to your sheet. You can adjust its weightage; title and target are locked.`,
        deep_link: '/employee',
        payload: { event: 'shared_goal_pushed', origin_goal_id: origin.id },
      });
    }
  }
  revalidatePath('/employee');
  revalidatePath('/manager');
  return { ok: true, results };
}

// =============================================================================
// CHECK-IN ACTIONS
// =============================================================================
export async function upsertCheckIn(payload: Partial<CheckIn> & { goal_id: string; quarter: CheckIn['quarter'] }) {
  const { supabase } = await requireUser();

  // Recompute score server-side using the canonical formulas
  const { data: goal } = await supabase.from('goals').select('*').eq('id', payload.goal_id).single();
  const score = goal ? computeScore(goal, {
    actual_numeric: payload.actual_numeric ?? null,
    actual_date: payload.actual_date ?? null,
    zero_achieved: payload.zero_achieved ?? null,
  }) : null;

  const { data: existing } = await supabase
    .from('check_ins')
    .select('*')
    .eq('goal_id', payload.goal_id)
    .eq('quarter', payload.quarter)
    .maybeSingle();

  const row = { ...payload, computed_score: score };
  const { data: after, error } = await supabase
    .from('check_ins')
    .upsert(row as any, { onConflict: 'goal_id,quarter' })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  await audit('check_in', after.id, existing ? 'update' : 'create', existing, after);

  // If this goal is a shared-origin clone, sync the actual to all linked goals
  if (goal?.shared_origin_id) {
    // recipient editing — do nothing, recipient's own number is independent
  } else if (goal?.is_shared_origin) {
    // owner updates → propagate actual_numeric / actual_date / zero_achieved
    const { data: clones } = await supabase
      .from('goals')
      .select('id')
      .eq('shared_origin_id', goal.id);
    if (clones && clones.length) {
      for (const c of clones) {
        await supabase.from('check_ins').upsert({
          goal_id: c.id,
          quarter: payload.quarter,
          actual_numeric: payload.actual_numeric ?? null,
          actual_date: payload.actual_date ?? null,
          zero_achieved: payload.zero_achieved ?? null,
          progress_status: payload.progress_status ?? 'OnTrack',
          computed_score: score,
        }, { onConflict: 'goal_id,quarter' });
      }
    }
  }

  revalidatePath('/employee');
  revalidatePath('/manager');
  return { ok: true, check_in: after, score };
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
  return { ok: true };
}

// =============================================================================
// ESCALATION ENGINE — invoked by /api/cron/escalations (or manually from admin)
// =============================================================================
export async function runEscalationSweep() {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Admin') throw new Error('FORBIDDEN');

  const { data: rules } = await supabase.from('escalation_rules').select('*').eq('is_active', true);
  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).single();
  if (!rules || !cycle) return { ok: true, triggered: 0 };

  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .eq('cycle_id', cycle.id);
  if (!sheets) return { ok: true, triggered: 0 };

  let triggered = 0;
  const now = Date.now();
  const daysSince = (d: string | null) => d ? Math.floor((now - new Date(d).getTime()) / 86400000) : Infinity;

  for (const rule of rules) {
    for (const sheet of sheets) {
      let shouldTrigger = false;
      let reason = '';
      const employee = sheet.employee;

      if (rule.trigger_type === 'goal_not_submitted') {
        if (sheet.status === 'Draft') {
          const since = daysSince(cycle.goal_window_start);
          if (since >= rule.threshold_days) {
            shouldTrigger = true;
            reason = `Sheet still in Draft ${since} days after cycle opened.`;
          }
        }
      } else if (rule.trigger_type === 'approval_pending') {
        if (sheet.status === 'Submitted' && sheet.submitted_at) {
          const since = daysSince(sheet.submitted_at);
          if (since >= rule.threshold_days) {
            shouldTrigger = true;
            reason = `Submitted ${since} days ago, still awaiting approval.`;
          }
        }
      } else if (rule.trigger_type === 'checkin_overdue') {
        // Check active quarter window
        // (Simplified for demo — a real impl reads per-quarter close dates)
      }

      if (shouldTrigger) {
        // Dedupe — don't trigger same rule on same subject twice within 24h
        const { data: dup } = await supabase
          .from('escalation_events')
          .select('id')
          .eq('rule_id', rule.id)
          .eq('subject_id', employee.id)
          .gte('triggered_at', new Date(now - 86400000).toISOString())
          .maybeSingle();
        if (dup) continue;

        await supabase.from('escalation_events').insert({
          rule_id: rule.id,
          subject_id: employee.id,
          sheet_id: sheet.id,
          level: rule.escalate_to,
          reason,
        });
        triggered++;

        // Resolve who to notify
        let recipient_id: string | null = null;
        if (rule.escalate_to === 'Employee') recipient_id = employee.id;
        else if (rule.escalate_to === 'Manager') recipient_id = employee.manager_id;
        else if (rule.escalate_to === 'HR') {
          const { data: admin } = await supabase.from('users').select('id').eq('role', 'Admin').limit(1).single();
          recipient_id = admin?.id ?? null;
        } else if (rule.escalate_to === 'SkipLevel' && employee.manager_id) {
          const { data: mgr } = await supabase.from('users').select('manager_id').eq('id', employee.manager_id).single();
          recipient_id = mgr?.manager_id ?? null;
        }

        if (recipient_id) {
          await notify({
            recipient_id,
            subject: `Escalation: ${rule.name}`,
            body: `${employee.full_name} — ${reason}`,
            deep_link: `/admin/escalations`,
            payload: { event: 'escalation', rule_id: rule.id, subject_id: employee.id },
          });
        }
      }
    }
  }
  revalidatePath('/admin');
  return { ok: true, triggered };
}
