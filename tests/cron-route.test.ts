import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweep = vi.hoisted(() => vi.fn(async () => ({ triggered: 2 })));
vi.mock('@/lib/escalation', () => ({ sweepEscalations: sweep }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));

import { GET } from '@/app/api/cron/escalations/route';

const call = (auth?: string) =>
  GET(new Request('http://localhost/api/cron/escalations', { headers: auth ? { authorization: auth } : {} }));

describe('GET /api/cron/escalations', () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => sweep.mockClear());
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await call('Bearer anything')).status).toBe(503);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer nope')).status).toBe(401);
    expect((await call('Bearer s3cret-but-longer')).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('runs the sweep for the correct secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await call('Bearer s3cret');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, triggered: 2 });
    expect(sweep).toHaveBeenCalledOnce();
  });
});
