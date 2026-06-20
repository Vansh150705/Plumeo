/*
 * Zod schemas for every server-action input. The client sends these payloads,
 * so they are an untrusted boundary: parse before touching the database. The
 * goal *business* rules (weightage totals, goal count, scoring) still live in
 * goals.ts — this file only guards shape and basic bounds.
 */

import { z } from 'zod';
import { MIN_WEIGHTAGE, MAX_WEIGHTAGE } from './goals';

const uuid = z.string().uuid();

export const goalInputSchema = z.object({
  id: uuid.optional(),
  sheet_id: uuid,
  thrust_area: z.string().min(1, 'Pick a thrust area.'),
  title: z.string().trim().min(1, 'Every goal needs a title.').max(200),
  description: z.string().max(2000).nullish(),
  uom: z.enum(['Numeric', 'Percentage', 'Timeline', 'Zero']),
  direction: z.enum(['min', 'max', 'timeline', 'zero']),
  target_numeric: z.number().finite().nullish(),
  target_date: z.string().nullish(),
  weightage: z.number().int().min(MIN_WEIGHTAGE).max(MAX_WEIGHTAGE),
  is_shared_origin: z.boolean().optional(),
  shared_origin_id: uuid.nullish(),
  display_order: z.number().int().optional(),
});

export const checkInInputSchema = z.object({
  goal_id: uuid,
  quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
  actual_numeric: z.number().finite().nullish(),
  actual_date: z.string().nullish(),
  zero_achieved: z.boolean().nullish(),
  progress_status: z.enum(['NotStarted', 'OnTrack', 'AtRisk', 'Completed']).optional(),
  employee_comment: z.string().max(2000).nullish(),
});

export const pushSharedGoalSchema = z.object({
  origin_goal_id: uuid,
  recipient_employee_ids: z.array(uuid).min(1, 'Pick at least one recipient.'),
  default_weightage: z.number().int().min(MIN_WEIGHTAGE).max(MAX_WEIGHTAGE),
});

export const feedbackInputSchema = z.object({
  subject_id: uuid,
  goal_id: uuid.nullish(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1, 'A comment is required.').max(2000),
  visibility: z.enum(['Manager', 'Private']).default('Manager'),
});

export const nonEmptyComment = z.string().trim().min(1);

/** Run a schema and collapse the result into the parsed value or an error string. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown):
  | { ok: true; data: T }
  | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: first?.message ?? 'Invalid input.' };
}
