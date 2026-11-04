import { runScheduledJobs } from '../server/services/jobs';
import { processDeliveries } from '../server/services/notifications';
import { closePool } from '../server/db/pool';
import { logger } from '../server/core/logger';

/**
 * Standalone background worker (use this instead of an external scheduler when you run containers):
 *   - every WORKER_DELIVERY_SECONDS (default 20): send queued emails / chat messages (with retries)
 *   - every WORKER_SWEEP_MINUTES  (default 60): reminders, SLA nudges and retention clean-up
 * Safe to run several replicas: delivery uses SKIP LOCKED and sweeps take an advisory lock.
 */
const deliveryMs = Number(process.env.WORKER_DELIVERY_SECONDS ?? 20) * 1000;
const sweepMs = Number(process.env.WORKER_SWEEP_MINUTES ?? 60) * 60_000;
let stopping = false;

async function loop(name: string, every: number, fn: () => Promise<unknown>) {
  while (!stopping) {
    try { const r = await fn(); logger.info(`worker.${name}`, { result: r as object }); } catch (e) { logger.error(`worker.${name}_failed`, { err: e }); }
    await new Promise((r) => setTimeout(r, every));
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; setTimeout(() => closePool().finally(() => process.exit(0)), 1500); });
logger.info('worker.started', { deliveryMs, sweepMs });
void loop('sweep', sweepMs, () => runScheduledJobs());
void loop('deliveries', deliveryMs, () => processDeliveries(100));
