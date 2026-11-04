import { z } from 'zod';
import { invalid } from './errors';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');

/** Parse untrusted input with a strict schema (unknown keys are rejected => no mass assignment). */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    throw invalid(first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input.', issues);
  }
  return r.data;
}

export const pageParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export interface Page<T> { data: T[]; page: { limit: number; offset: number; total: number } }
