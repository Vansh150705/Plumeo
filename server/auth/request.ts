import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { resolveSession, SESSION_COOKIE } from './sessions';
import type { Ctx } from '../core/context';

/** Request-scoped context for server components. Redirects to /login when there is no valid session. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const h = headers();
  return resolveSession(token, { requestId: h.get('x-request-id') ?? randomUUID(), ip: (h.get('x-forwarded-for') ?? '').split(',')[0] || undefined, userAgent: h.get('user-agent') ?? undefined });
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect('/login');
  return ctx;
}

export function requirePermPage(ctx: Ctx, ...perms: string[]) {
  if (!perms.some((p) => ctx.perms.has(p))) redirect('/app?denied=1');
}
