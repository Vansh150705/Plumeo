export type ErrorCode =
  | 'unauthenticated' | 'forbidden' | 'not_found' | 'validation_failed' | 'conflict'
  | 'rate_limited' | 'invalid_state' | 'precondition_failed' | 'bad_request' | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, validation_failed: 422, conflict: 409,
  rate_limited: 429, invalid_state: 409, precondition_failed: 412, bad_request: 400, internal: 500,
};

/** Expected, user-facing failures. Anything else is treated as an internal error and never leaked. */
export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.status = STATUS[code];
  }
}

export const unauthenticated = (m = 'Sign in to continue.') => new AppError('unauthenticated', m);
export const forbidden = (m = 'You do not have permission to do that.') => new AppError('forbidden', m);
export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found.`);
export const conflict = (m: string, details?: unknown) => new AppError('conflict', m, details);
export const invalidState = (m: string, details?: unknown) => new AppError('invalid_state', m, details);
export const invalid = (m: string, details?: unknown) => new AppError('validation_failed', m, details);
export const badRequest = (m: string) => new AppError('bad_request', m);
export const rateLimited = (retryAfterSec: number) =>
  new AppError('rate_limited', 'Too many requests. Please slow down and try again shortly.', { retryAfterSec });
