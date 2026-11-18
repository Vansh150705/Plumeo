'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { validateSheet, computeScore } from '@/lib/goals';
import { sweepEscalations } from '@/lib/escalation';
import type { Goal, CheckIn } from '@/lib/types';
import { ok, fail } from '@/lib/result';
import {
  parseInput,
  goalInputSchema,
  checkInInputSchema,
  pushSharedGoalSchema,
  feedbackInputSchema,
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

// writes one in-app notification row, read straight from the inbox
async function notify(args: {
  recipient_id: string;
  subject: string;
  body: string;
  deep_link?: string;
  payload?: any;
}) {
  const { supabase } = await requireUser();
  await supabase.from('notifications').insert({
    recipient_id: args.recipient_id,
    channel: 'InApp',
    subject: args.subject,
    body: args.body,
    deep_link: args.deep_link ?? null,
    payload: args.payload ?? null,
  });
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

  // Only the owner's own Draft/Returned sheet can be submitted; RLS enforces the same rule.
  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({ status: 'Submitted', submitted_at: new Date().toISOString() })
    .eq('id', sheet_id)
    .eq('employee_id', appUser.id)
    .in('status', ['Draft', 'Returned'])
    .select()
    .maybeSingle();
  if (!sheet) return fail('This sheet can no longer be submitted. Refresh and try again.');

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

  // Only a Submitted sheet can be approved. If nothing matched, the sheet changed under us or
  // the caller is not its reviewer, so report that instead of a false success.
  const { data: sheet } = await supabase
    .from('goal_sheets')
    .update({
      status: 'Approved',
      approved_at: new Date().toISOString(),
      approved_by: appUser.id,
      locked_at: new Date().toISOString(),
    })
    .eq('id', sheet_id)
    .eq('status', 'Submitted')
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .maybeSingle();
  if (!sheet) return fail('This sheet is no longer awaiting your approval.');

  await audit('sheet', sheet_id, 'approve', null, sheet);

  if (sheet.employee) {
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
    .eq('status', 'Submitted')
    .select('*, employee:users!goal_sheets_employee_id_fkey(*)')
    .maybeSingle();
  if (!sheet) return fail('This sheet is no longer awaiting your review.');

  await audit('sheet', sheet_id, 'return', null, sheet, comment);

  if (sheet.employee) {
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

// ----- 360 / peer feedback -----

/** Leave structured feedback (rating + comment) about a colleague. */
export async function giveFeedback(input: unknown) {
  const { supabase, appUser } = await requireUser();

  const parsed = parseInput(feedbackInputSchema, input);
  if (!parsed.ok) return fail(parsed.error);
  const data = parsed.data;
  if (data.subject_id === appUser.id) return fail('You cannot leave feedback about yourself.');

  const { data: cycle } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle();

  const { data: row, error } = await supabase
    .from('feedback')
    .insert({
      cycle_id: cycle?.id ?? null,
      subject_id: data.subject_id,
      author_id: appUser.id,
      goal_id: data.goal_id ?? null,
      rating: data.rating,
      comment: data.comment,
      visibility: data.visibility,
    })
    .select()
    .single();
  if (error) return fail(error.message);

  // Only ping the subject when the feedback is meant to be shared with them.
  if (data.visibility === 'Manager') {
    await notify({
      recipient_id: data.subject_id,
      subject: `New feedback from ${appUser.full_name}`,
      body: `${appUser.full_name} shared feedback on your goals: "${data.comment}"`,
      deep_link: '/employee/checkins',
      payload: { event: 'feedback_received', feedback_id: row.id },
    });
  }

  revalidatePath('/manager');
  revalidatePath('/employee');
  return ok({ feedback: row });
}

/** Withdraw feedback you authored. */
export async function withdrawFeedback(feedback_id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from('feedback').delete().eq('id', feedback_id);
  if (error) return fail(error.message);
  revalidatePath('/manager');
  revalidatePath('/employee');
  return ok({});
}

// ----- escalation engine: nightly cron (/api/cron/escalations) and on demand from the admin UI -----
export async function runEscalationSweep() {
  const { supabase, appUser } = await requireUser();
  if (appUser.role !== 'Admin') throw new Error('FORBIDDEN');
  try {
    const { triggered } = await sweepEscalations(supabase);
    revalidatePath('/admin');
    return ok({ triggered });
  } catch (err) {
    console.error('Escalation sweep failed:', err);
    return fail('The escalation sweep failed. Please try again.');
  }
}
