import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sweepEscalations } from '@/lib/escalation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nightly escalation sweep, triggered by Vercel Cron (see vercel.json).
 *
 * Runs with the service-role client, so it must never be reachable anonymously: it fails
 * closed. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically once the
 * CRON_SECRET environment variable is set on the project.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing to run the escalation sweep.');
    return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 });
  }

  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { triggered } = await sweepEscalations(createAdminClient());
    return NextResponse.json({ ok: true, triggered, ranAt: new Date().toISOString() });
  } catch (err) {
    console.error('Escalation sweep failed:', err);
    return NextResponse.json({ ok: false, error: 'Sweep failed.' }, { status: 500 });
  }
}
