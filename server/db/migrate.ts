import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Minimal, auditable migration runner: ordered .sql files, each applied in its own
 * transaction, checksummed, guarded by an advisory lock so concurrent deploys cannot
 * interleave. Applied migrations are never re-run and must not be edited (a checksum
 * mismatch aborts).
 */
export async function migrate(connectionString: string, dir = path.join(process.cwd(), 'db', 'migrations')) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const done = new Map<string, string>(
      (await client.query('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]),
    );
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [file, checksum]);
        await client.query('commit');
        applied.push(file);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {});
    await client.end();
  }
  return applied;
}

export async function currentMigration(client: { query: (q: string) => Promise<{ rows: any[] }> }) {
  const r = await client.query('select name from schema_migrations order by name desc limit 1');
  return (r.rows[0]?.name as string) ?? null;
}
