import { withOrg, withSystem, pool } from '../db/pool';
import { logger } from '../core/logger';
import { sendApprovalReminders } from './approvals';
import { sendCheckinReminders, todayUtc } from './checkins';
import { processDeliveries } from './notifications';
import { purgeRateLimits } from '../auth/ratelimit';

/** Housekeeping that is safe to run frequently and on several instances at once (all steps are idempotent). */
async function retention(orgId: string) {
  return withOrg(orgId, async (tx) => ({
    notifications: await tx.exec(`delete from notifications where org_id = $1 and read_at is not null and read_at < now() - interval '180 days'`, [orgId]),
    sessions: await tx.exec(`delete from sessions where org_id = $1 and (expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days')`, [orgId]),
    tokens: await tx.exec(`delete from credential_tokens where org_id = $1 and (expires_at < now() - interval '30 days' or used_at < now() - interval '30 days')`, [orgId]),
    flows: await tx.exec(`delete from auth_flows where org_id = $1 and expires_at < now()`, [orgId]),
    idempotency: await tx.exec(`delete from idempotency_keys where org_id = $1 and created_at < now() - interval '48 hours'`, [orgId]),
    deliveries: await tx.exec(`delete from notification_deliveries where org_id = $1 and status in ('sent','skipped') and created_at < now() - interval '90 days'`, [orgId]),
  }));
}

export async function runScheduledJobs(opts: { asOf?: string } = {}) {
  const lock = await pool().connect();
  try {
    // Only one instance runs the sweep at a time; others skip quietly.
    const got = (await lock.query('select pg_try_advisory_lock(727275) as ok')).rows[0].ok;
    if (!got) return { skipped: true as const };
    const started = Date.now();
    const orgs = await withSystem((tx) => tx.query<{ id: string }>(`select id from orgs where status = 'active'`));
    const totals = { orgs: orgs.length, approvalReminders: 0, checkinReminders: 0, purged: 0, errors: 0 };
    for (const o of orgs) {
      try {
        await withOrg(o.id, async (tx) => {
          totals.approvalReminders += await sendApprovalReminders(tx, o.id);
          totals.checkinReminders += await sendCheckinReminders(tx, o.id, opts.asOf ?? todayUtc());
        });
        const r = await retention(o.id);
        totals.purged += Object.values(r).reduce((a, b) => a + b, 0);
      } catch (e) {
        totals.errors++;
        logger.error('job.org_failed', { orgId: o.id, err: e });
      }
    }
    await purgeRateLimits();
    const deliveries = await processDeliveries(200);
    const detail = { ...totals, deliveries, ms: Date.now() - started };
    await withSystem((tx) => tx.exec(
      `insert into job_runs (name, last_started_at, last_finished_at, last_status, last_detail) values ('scheduled', now() - make_interval(secs => $2), now(), $3, $1)
       on conflict (name) do update set last_started_at = excluded.last_started_at, last_finished_at = excluded.last_finished_at, last_status = excluded.last_status, last_detail = excluded.last_detail`,
      [JSON.stringify(detail), detail.ms / 1000, totals.errors ? 'partial' : 'ok']));
    return { skipped: false as const, ...detail };
  } finally {
    await lock.query('select pg_advisory_unlock(727275)').catch(() => {});
    lock.release();
  }
}
