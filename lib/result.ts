/*
 * One result shape for every server action, so the client can always branch on
 * `.ok` and never has to catch a raw thrown error. Actions return `fail(...)`
 * for expected problems (validation, permissions, missing data) and only let
 * truly exceptional errors bubble — those get normalised by `errorMessage`.
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

/** Turn anything thrown into a safe, user-facing message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong. Please try again.';
}

/**
 * Wrap a server action body so an unexpected throw becomes a clean
 * `{ ok: false }` instead of a 500 the client can't read.
 */
export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
