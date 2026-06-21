/*
 * One result shape for every server action, so the client can always branch on
 * `.ok` and never has to catch a raw thrown error. Actions return `fail(...)`
 * for expected problems (validation, permissions, missing data) and only let
 * truly exceptional errors bubble.
 */

import type { ValidationIssue } from './goals';

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; issues?: ValidationIssue[] };

/** Build a typed success result. */
export function ok<T extends Record<string, unknown>>(data: T): ActionResult<T> {
  return { ok: true, ...data };
}

/** Build a failure result with a human-readable message. */
export function fail(error: string, issues?: ValidationIssue[]): ActionResult<never> {
  return issues ? { ok: false, error, issues } : { ok: false, error };
}
