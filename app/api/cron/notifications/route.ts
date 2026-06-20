import { deliverNotifications } from '@/lib/notifications/delivery';
import { NextResponse } from 'next/server';

/**
 * Vercel cron: drains the notification queue, shipping any un-sent Email/Teams
 * rows to their configured transports. Idempotent — safe to run as often as you
 * like. Configured in vercel.json.
 *
 * Gated by CRON_SECRET when set, matching the escalations cron.
 */
export async function GET(req: Request) {
  const secret = req.headers.get('authorization');
  if (process.env.CRON_SECRET && secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const result = await deliverNotifications(100);
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
