/*
 * One-command database bootstrap for a NEW, EMPTY Postgres database (Neon, Supabase, RDS, Docker...).
 *   MIGRATION_DATABASE_URL=<owner connection> APP_DB_PASSWORD=<new password> npm run db:setup
 * 1. creates the restricted application role `plumeo_app` (idempotent; resets its password),
 * 2. applies every migration as the owner.
 * Then use  postgres://plumeo_app:<APP_DB_PASSWORD>@<host>/<db>  as DATABASE_URL for the running app.
 * Refuses to touch a database that already contains tables that are not Plumeo's (e.g. the old Supabase prototype).
 */
import { Client } from 'pg';
import { migrate } from '../server/db/migrate';

const url = process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.APP_DB_PASSWORD;
const appRole = process.env.APP_DB_USER ?? 'plumeo_app';
if (!url || !appPassword) { console.error('Set MIGRATION_DATABASE_URL (owner) and APP_DB_PASSWORD.'); process.exit(1); }
if (appPassword.length < 12) { console.error('APP_DB_PASSWORD must be at least 12 characters.'); process.exit(1); }
if (!/^[a-z_][a-z0-9_]{0,40}$/.test(appRole)) { console.error('APP_DB_USER must be a simple lowercase identifier.'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const foreign = await c.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name in ('users','goals','goal_sheets','check_ins') and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'org_id')`);
    if (foreign.rowCount) { console.error('This database already contains tables from another application (e.g. the old prototype). Use a fresh, empty database.'); process.exit(1); }
    await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'plumeo_app_role') then create role plumeo_app_role nologin; end if; end $$`);
    const exists = (await c.query('select 1 from pg_roles where rolname = $1', [appRole])).rowCount;
    const stmt = (await c.query(`select format($1, $2::text, $3::text) as s`, [exists ? 'alter role %I login password %L' : 'create role %I login password %L in role plumeo_app_role', appRole, appPassword])).rows[0].s;
    await c.query(stmt);
    await c.query(`select 1`); // role ensured above
    await c.query((await c.query(`select format('grant plumeo_app_role to %I', $1::text) as s`, [appRole])).rows[0].s);
    await c.query((await c.query(`select format('grant connect on database %I to plumeo_app_role', current_database()) as s`)).rows[0].s);
    await c.query('grant usage on schema public to plumeo_app_role');
    console.log(`Application role "${appRole}" is ready.`);
  } finally { await c.end(); }
  const applied = await migrate(url!);
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Migrations already up to date.');
  console.log(`\nDATABASE_URL for the app: use the same host/database with user "${appRole}" and your APP_DB_PASSWORD.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
