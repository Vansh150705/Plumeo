import { forbidden } from './errors';
import type { Permission } from '@/lib/permissions';

/** The authenticated actor for one request. Built only from a validated server-side session. */
export interface Ctx {
  orgId: string;
  userId: string;
  userName: string;
  perms: ReadonlySet<string>;
  roleKeys: string[];
  requestId: string;
  actorType: 'user' | 'system' | 'scim' | 'platform';
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

export const can = (ctx: Ctx, p: Permission) => ctx.perms.has(p);
export function requirePerm(ctx: Ctx, ...ps: Permission[]) {
  if (!ps.some((p) => ctx.perms.has(p))) throw forbidden();
}
export function systemCtx(orgId: string, requestId = 'system'): Ctx {
  return { orgId, userId: '00000000-0000-0000-0000-000000000000', userName: 'System', perms: new Set(), roleKeys: [], requestId, actorType: 'system' };
}
