import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PLATFORM_COOKIE, resolvePlatformSession, } from '@/server/auth/platform';
import { listOrgsForPlatform } from '@/server/services/orgs';
import { PlatformConsole } from './platform-console';

export const metadata: Metadata = { title: 'Platform', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Operator console for super administrators. It manages organisations only — it has no access to goals, people or any tenant data. */
export default async function PlatformPage() {
  const s = await resolvePlatformSession(cookies().get(PLATFORM_COOKIE)?.value ?? null);
  const orgs = s ? await listOrgsForPlatform() : [];
  return <PlatformConsole signedIn={!!s} name={s?.full_name ?? ''} orgs={orgs as any[]} />;
}
