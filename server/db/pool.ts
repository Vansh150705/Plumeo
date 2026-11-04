import { Pool, types, type PoolClient } from 'pg';
import { config } from '../core/config';
import { logger } from '../core/logger';

// date -> 'YYYY-MM-DD' (no timezone shifting), numeric/int8 -> number
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => Number(v));

const g = globalThis as unknown as { __plumeoPool?: Pool };

export function pool(): Pool {
  if (!g.__plumeoPool) {
    const p = new Pool({
      connectionString: config().DATABASE_URL ?? (() => { throw new Error('DATABASE_URL is not set'); })(),
      max: config().DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      application_name: 'plumeo',
    });
    p.on('error', (e) => logger.error('db.pool_error', { err: e }));
    g.__plumeoPool = p;
  }
  return g.__plumeoPool;
}

export async function closePool() {
  if (g.__plumeoPool) { await g.__plumeoPool.end(); g.__plumeoPool = undefined; }
}

/** Thin typed wrapper over a client that already carries the tenant context for its transaction. */
export class Tx {
  constructor(readonly client: PoolClient, readonly orgId: string | null) {}
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params as any[])).rows as T[];
  }
  async one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async exec(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.client.query(sql, params as any[])).rowCount ?? 0;
  }
}

const RETRYABLE = new Set(['40001', '40P01']);

async function run<T>(setup: (c: PoolClient) => Promise<void>, orgId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool().connect();
    try {
      await client.query('begin');
      await setup(client);
      const result = await fn(new Tx(client, orgId));
      await client.query('commit');
      return result;
    } catch (e: any) {
      await client.query('rollback').catch(() => {});
      if (RETRYABLE.has(e?.code) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 15 * attempt * attempt + Math.random() * 20));
        continue;
      }
      throw e;
    } finally {
      client.release();
    }
  }
}

/** Run `fn` in ONE transaction scoped to a single organisation (RLS enforced). Retries on deadlock/serialization failures. */
export function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run((c) => c.query("select set_config('app.org_id', $1, true), set_config('app.system', '', true)", [orgId]).then(() => {}), orgId, fn);
}

/** Cross-tenant system scope. Only for pre-auth lookups and background sweeps; callers must never expose results across tenants. */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run((c) => c.query("select set_config('app.system', 'on', true), set_config('app.org_id', '', true)").then(() => {}), null, fn);
}
