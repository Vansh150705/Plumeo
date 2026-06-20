'use server';

/*
 * AI goal-drafting assistant. Turns a plain-language brief ("I lead the SMB
 * sales pod and want to grow new logos while keeping churn down") into 3–5
 * well-formed draft goals that drop straight into the editor. The model only
 * proposes — nothing is persisted here, and every draft still flows through the
 * same validation and the same upsert path as a hand-typed goal.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAiConfigured, AI_GOAL_MODEL } from '@/lib/ai-config';
import { ok, fail, errorMessage } from '@/lib/result';
import { MIN_WEIGHTAGE, REQUIRED_TOTAL_WEIGHTAGE } from '@/lib/goals';

const draftedGoalSchema = z.object({
  thrust_area: z.string().describe('Must be one of the provided thrust areas.'),
  title: z.string().describe('A short, outcome-focused goal title.'),
  description: z.string().describe('One or two sentences of context.'),
  uom: z.enum(['Numeric', 'Percentage', 'Timeline', 'Zero']),
  direction: z.enum(['min', 'max', 'timeline', 'zero']),
  target_numeric: z.number().nullable(),
  target_date: z.string().nullable().describe('ISO date YYYY-MM-DD for Timeline goals, else null.'),
  weightage: z.number().int(),
});

export type DraftedGoal = z.infer<typeof draftedGoalSchema>;

const responseSchema = z.object({ goals: z.array(draftedGoalSchema).min(3).max(5) });

/** Spread/clamp weightages so each is >= the minimum and the set sums to 100. */
function normalizeWeightages(goals: DraftedGoal[]): DraftedGoal[] {
  if (goals.length === 0) return goals;
  const w = goals.map((g) => Math.max(MIN_WEIGHTAGE, Math.round(g.weightage)));
  let diff = REQUIRED_TOTAL_WEIGHTAGE - w.reduce((a, b) => a + b, 0);
  let guard = 1000;
  while (diff !== 0 && guard-- > 0) {
    if (diff > 0) {
      // add to the smallest entry
      const i = w.indexOf(Math.min(...w));
      w[i] += 1;
      diff -= 1;
    } else {
      // subtract from the largest entry, but never below the minimum
      const i = w.indexOf(Math.max(...w));
      if (w[i] - 1 < MIN_WEIGHTAGE) break;
      w[i] -= 1;
      diff += 1;
    }
  }
  return goals.map((g, i) => ({ ...g, weightage: w[i] }));
}

export async function draftGoalsFromBrief(brief: string) {
  if (!isAiConfigured()) {
    return fail('The AI assistant isn’t configured on this deployment.');
  }
  const trimmed = (brief ?? '').trim();
  if (trimmed.length < 12) {
    return fail('Add a sentence or two about your role and what you want to achieve.');
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('Please sign in again.');

  const { data: me } = await supabase.from('users').select('department, full_name').eq('id', user.id).maybeSingle();
  const { data: areas } = await supabase.from('thrust_areas').select('name').eq('is_active', true);
  const thrustNames = (areas ?? []).map((a) => a.name);

  const system = [
    'You are a performance-management coach helping an employee draft annual goals (KRAs).',
    'Return 3 to 5 concrete, measurable goals. Rules you must follow exactly:',
    `- thrust_area MUST be chosen from this list: ${thrustNames.join(', ') || 'Revenue Growth, Operational Excellence, Customer Experience'}.`,
    '- uom is the unit of measure: "Numeric" (a raw number target), "Percentage" (a % target), "Timeline" (hit a deadline), "Zero" (zero-defect / zero-incident).',
    '- direction encodes what "good" means. For Numeric/Percentage use "min" when a HIGHER actual is better (revenue, NPS, adoption) and "max" when a LOWER actual is better (cost, defects, turnaround time). For Timeline use "timeline". For Zero use "zero".',
    '- target_numeric: a realistic number for Numeric/Percentage goals; null for Timeline and Zero.',
    '- target_date: an ISO date (YYYY-MM-DD) for Timeline goals; null otherwise.',
    `- weightage: integers, each at least ${MIN_WEIGHTAGE}, and all goals together summing to exactly ${REQUIRED_TOTAL_WEIGHTAGE}.`,
    'Make titles specific and outcome-oriented, not activities. Vary the thrust areas where it makes sense.',
  ].join('\n');

  const prompt = [
    me?.department ? `The employee works in the ${me.department} department.` : '',
    `Their brief: "${trimmed}"`,
    'Draft their goal sheet now.',
  ].filter(Boolean).join('\n');

  try {
    const { object } = await generateObject({
      model: AI_GOAL_MODEL,
      schema: responseSchema,
      system,
      prompt,
    });
    const goals = normalizeWeightages(object.goals).map((g) => ({
      ...g,
      // keep the model honest about which fields belong to which UoM
      target_numeric: g.uom === 'Timeline' || g.uom === 'Zero' ? null : g.target_numeric,
      target_date: g.uom === 'Timeline' ? g.target_date : null,
    }));
    return ok({ goals });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
