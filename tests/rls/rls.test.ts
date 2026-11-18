/**
 * Row Level Security regression suite.
 *
 * Loads the real supabase/migrations/*.sql into an in-memory Postgres (PGlite) with a
 * Supabase-style auth.uid() stub, then runs queries as the `authenticated` / `anon` roles so
 * RLS genuinely applies (a superuser would bypass it). No external database is needed, so this
 * runs in CI.
 *
 *  - LEGIT probes are real app flows and must succeed.
 *  - BLOCK probes are attacks / state-machine violations and must be rejected or affect 0 rows.
 * Each probe runs in its own rolled-back transaction, so probes cannot contaminate each other.
 */
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations');

const ID = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  mgr: '00000000-0000-0000-0000-0000000000b1',
  other: '00000000-0000-0000-0000-0000000000d1', // a manager with no reports in the fixtures
  emp: '00000000-0000-0000-0000-0000000000c1',
  emp2: '00000000-0000-0000-0000-0000000000c2',
};
const CYCLE = '10000000-0000-0000-0000-000000000001';
const CYCLE2 = '10000000-0000-0000-0000-000000000002';
const SHEET = '20000000-0000-0000-0000-000000000001'; // emp's sheet
const SHEET2 = '20000000-0000-0000-0000-000000000002'; // emp2's sheet
const ADMIN_SHEET = '20000000-0000-0000-0000-0000000000ad';
const GOAL = '30000000-0000-0000-0000-000000000001';
const ADMIN_GOAL = '30000000-0000-0000-0000-0000000000ad';
const CI = '40000000-0000-0000-0000-000000000001';
const ADMIN_CI = '40000000-0000-0000-0000-0000000000ad';
const NOTIF = '50000000-0000-0000-0000-000000000001';

const SUBMITTED = `update goal_sheets set status='Submitted' where id='${SHEET}'`;
const SECOND_CYCLE = `insert into cycles (id,name,fiscal_year,goal_window_start,goal_window_end,q1_open,q1_close,q2_open,q2_close,q3_open,q3_close,q4_open,q4_close)
  values ('${CYCLE2}','FY2',2027,now(),now(),now(),now(),now(),now(),now(),now(),now(),now())`;
const ADMIN_OWN = `insert into goal_sheets (id,cycle_id,employee_id,status) values ('${ADMIN_SHEET}','${CYCLE}','${ID.admin}','Submitted')`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });
  // Minimal Supabase surface: roles, auth.uid() (reads the JWT subject), default grants.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(`
    insert into public.users (id, upn, full_name, role, manager_id) values
      ('${ID.admin}','admin@t','Admin','Admin',null),
      ('${ID.mgr}','mgr@t','Manager','Manager',null),
      ('${ID.other}','other@t','Other Mgr','Manager',null),
      ('${ID.emp}','emp@t','Emp','Employee','${ID.mgr}'),
      ('${ID.emp2}','emp2@t','Emp2','Employee','${ID.mgr}');
    insert into public.cycles (id,name,fiscal_year,goal_window_start,goal_window_end,q1_open,q1_close,q2_open,q2_close,q3_open,q3_close,q4_open,q4_close)
      values ('${CYCLE}','FY',2026,now(),now(),now(),now(),now(),now(),now(),now(),now(),now());
    insert into public.goal_sheets (id,cycle_id,employee_id,status) values
      ('${SHEET}','${CYCLE}','${ID.emp}','Draft'),
      ('${SHEET2}','${CYCLE}','${ID.emp2}','Draft');
    insert into public.goals (id,sheet_id,thrust_area,title,uom,direction,target_numeric,weightage)
      values ('${GOAL}','${SHEET}','T','G','Numeric','min',10,100);
    insert into public.check_ins (id,goal_id,quarter) values ('${CI}','${GOAL}','Q1');
  `);
});

afterAll(async () => {
  await db?.close();
});

type Probe = { uid?: string; role?: 'authenticated' | 'anon' | 'service_role'; sql: string; setup?: string };

/** Runs `sql` as the given user inside a rolled-back transaction; returns how many rows it touched. */
async function attempt({ uid = '', role = 'authenticated', sql, setup }: Probe) {
  await db.exec('begin');
  try {
    if (setup) await db.exec(setup); // a broken fixture must fail the test, not make a BLOCK pass
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid}',false);`);
    try {
      const r = await db.query(sql);
      return { error: null as string | null, rows: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
    } catch (e) {
      return { error: (e as Error).message, rows: 0 };
    }
  } finally {
    await db.exec('rollback');
  }
}

const legit = (name: string, p: Probe) =>
  it(`LEGIT: ${name}`, async () => {
    const r = await attempt(p);
    expect(r.error, r.error ?? '').toBeNull();
    expect(r.rows).toBeGreaterThan(0);
  });

const block = (name: string, p: Probe) =>
  it(`BLOCK: ${name}`, async () => {
    const r = await attempt(p);
    expect(r.error === null && r.rows > 0, 'the operation must not succeed').toBe(false);
  });

describe('legitimate flows keep working', () => {
  legit('employee submits own draft sheet', { uid: ID.emp, sql: `update goal_sheets set status='Submitted', submitted_at=now() where id='${SHEET}'` });
  legit('employee edits own draft goal', { uid: ID.emp, sql: `update goals set weightage=50 where id='${GOAL}'` });
  legit('employee resubmits a Returned sheet', { uid: ID.emp, setup: `update goal_sheets set status='Returned' where id='${SHEET}'`, sql: `update goal_sheets set status='Submitted', submitted_at=now() where id='${SHEET}'` });
  legit('manager approves a SUBMITTED sheet of a report', { uid: ID.mgr, setup: SUBMITTED, sql: `update goal_sheets set status='Approved', approved_by='${ID.mgr}', approved_at=now(), locked_at=now() where id='${SHEET}'` });
  legit('manager returns a SUBMITTED sheet with a comment', { uid: ID.mgr, setup: SUBMITTED, sql: `update goal_sheets set status='Returned', returned_at=now(), return_comment='fix' where id='${SHEET}'` });
  legit("admin approves someone else's submitted sheet", { uid: ID.admin, setup: SUBMITTED, sql: `update goal_sheets set status='Approved', approved_by='${ID.admin}', approved_at=now(), locked_at=now() where id='${SHEET}'` });
  legit('employee creates own Draft sheet for a new cycle', { uid: ID.emp, setup: SECOND_CYCLE, sql: `insert into goal_sheets (cycle_id,employee_id,status) values ('${CYCLE2}','${ID.emp}','Draft')` });
  legit('manager creates a Draft sheet for a report (shared-goal push)', { uid: ID.mgr, setup: `delete from goal_sheets where id='${SHEET2}'`, sql: `insert into goal_sheets (cycle_id,employee_id,status) values ('${CYCLE}','${ID.emp2}','Draft')` });
  legit('manager adds a goal to a report sheet (shared goal)', { uid: ID.mgr, sql: `insert into goals (sheet_id,thrust_area,title,uom,direction,target_numeric,weightage) values ('${SHEET2}','T','shared','Numeric','min',1,20)` });
  legit('employee writes own check-in', { uid: ID.emp, sql: `insert into check_ins (goal_id,quarter,actual_numeric,progress_status) values ('${GOAL}','Q2',5,'OnTrack')` });
  legit('employee updates own check-in (non-review fields)', { uid: ID.emp, sql: `update check_ins set actual_numeric=9, employee_comment='hi', computed_score=50 where id='${CI}'` });
  legit('manager records a review on a report check-in, as themselves', { uid: ID.mgr, sql: `update check_ins set manager_comment='ok', manager_checked_by='${ID.mgr}', manager_checked_at=now() where id='${CI}'` });
  legit('manager writes a clone check-in for a report (shared goal sync)', { uid: ID.mgr, sql: `insert into check_ins (goal_id,quarter,actual_numeric,progress_status) values ('${GOAL}','Q3',1,'OnTrack')` });
  legit('employee notifies own manager', { uid: ID.emp, sql: `insert into notifications (recipient_id,channel,subject,body) values ('${ID.mgr}','InApp','s','b')` });
  legit('manager notifies own report', { uid: ID.mgr, sql: `insert into notifications (recipient_id,channel,subject,body) values ('${ID.emp}','InApp','s','b')` });
  legit('admin notifies anyone (escalation fan-out)', { uid: ID.admin, sql: `insert into notifications (recipient_id,channel,subject,body) values ('${ID.other}','InApp','s','b')` });
  legit('user marks own notification read', { uid: ID.emp, setup: `insert into notifications (id,recipient_id,channel,subject,body) values ('${NOTIF}','${ID.emp}','InApp','s','b')`, sql: `update notifications set read_at=now() where id='${NOTIF}'` });
  legit('user writes own audit row', { uid: ID.emp, sql: `insert into audit_log (entity_type,entity_id,action,actor_id,actor_name) values ('sheet','${SHEET}','submit','${ID.emp}','Emp')` });
  legit('user edits own profile (name, colour)', { uid: ID.emp, sql: `update users set full_name='Emp R', avatar_color='#fff' where id='${ID.emp}'` });
  legit("admin changes another user's role", { uid: ID.admin, sql: `update users set role='Manager' where id='${ID.emp2}'` });
  legit('admin inserts an escalation event', { uid: ID.admin, sql: `insert into escalation_events (subject_id,level,reason) values ('${ID.emp}','HR','late')` });
  legit('signed-in user can read the users directory', { uid: ID.emp, sql: `select id from users` });
  legit('trusted backend (service role, no JWT) can change a role', { role: 'service_role', sql: `update users set role='Manager' where id='${ID.emp2}'` });
});

describe('feedback notifications come from the trigger, with fixed wording', () => {
  const count = async (where: string) =>
    Number((await db.query<{ n: number }>(`select count(*)::int as n from notifications where ${where}`)).rows[0].n);

  it('shared feedback notifies the subject, even though the author cannot insert notifications directly', async () => {
    await db.exec('begin');
    try {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ID.emp2}',false);`);
      await db.query(`insert into feedback (subject_id,author_id,rating,comment,visibility) values ('${ID.emp}','${ID.emp2}',4,'great work','Manager')`);
      await db.exec('reset role');
      expect(await count(`recipient_id='${ID.emp}' and payload->>'event'='feedback_received' and subject='New feedback from Emp2'`)).toBe(1);
    } finally { await db.exec('rollback'); }
  });

  it('private feedback does not notify the subject', async () => {
    await db.exec('begin');
    try {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ID.emp2}',false);`);
      await db.query(`insert into feedback (subject_id,author_id,rating,comment,visibility) values ('${ID.emp}','${ID.emp2}',2,'hidden','Private')`);
      await db.exec('reset role');
      expect(await count(`recipient_id='${ID.emp}'`)).toBe(0);
    } finally { await db.exec('rollback'); }
  });
});

describe('attacks and state-machine violations are rejected', () => {
  block('self-promotion to Admin', { uid: ID.emp, sql: `update users set role='Admin' where id='${ID.emp}'` });
  block('self re-parenting (manager_id)', { uid: ID.emp, sql: `update users set manager_id=null where id='${ID.emp}'` });
  block('self changing identity (upn)', { uid: ID.emp, sql: `update users set upn='ceo@t' where id='${ID.emp}'` });
  block("editing someone else's profile", { uid: ID.emp, sql: `update users set full_name='x' where id='${ID.emp2}'` });
  block('forged audit row attributed to someone else', { uid: ID.emp, sql: `insert into audit_log (entity_type,entity_id,action,actor_id,actor_name) values ('sheet','${SHEET}','approve','${ID.admin}','Admin (forged)')` });
  block('audit row with no actor', { uid: ID.emp, sql: `insert into audit_log (entity_type,entity_id,action,actor_name) values ('sheet','${SHEET}','approve','nobody')` });
  block('notification to an unrelated user', { uid: ID.emp, sql: `insert into notifications (recipient_id,channel,subject,body) values ('${ID.admin}','InApp','phish','click')` });
  block("hijacking own notification into another user's inbox", { uid: ID.emp, setup: `insert into notifications (id,recipient_id,channel,subject,body) values ('${NOTIF}','${ID.emp}','InApp','s','b')`, sql: `update notifications set recipient_id='${ID.emp2}' where id='${NOTIF}'` });
  block('notifying someone just because you left feedback about them', {
    uid: ID.emp2,
    setup: `insert into feedback (subject_id,author_id,rating,comment) values ('${ID.emp}','${ID.emp2}',4,'x')`,
    sql: `insert into notifications (recipient_id,channel,subject,body) values ('${ID.emp}','InApp','phish','click')`,
  });
  block('non-admin forging escalation events', { uid: ID.emp, sql: `insert into escalation_events (subject_id,level,reason) values ('${ID.emp2}','HR','forged')` });
  block('employee self-approving own submitted sheet', { uid: ID.emp, setup: SUBMITTED, sql: `update goal_sheets set status='Approved', approved_by='${ID.emp}', approved_at=now(), locked_at=now() where id='${SHEET}'` });
  block("employee approving a peer's sheet", { uid: ID.emp, setup: `update goal_sheets set status='Submitted' where id='${SHEET2}'`, sql: `update goal_sheets set status='Approved' where id='${SHEET2}'` });
  block('employee inserting an already-Approved sheet', { uid: ID.emp, setup: SECOND_CYCLE, sql: `insert into goal_sheets (cycle_id,employee_id,status,approved_by) values ('${CYCLE2}','${ID.emp}','Approved','${ID.emp}')` });
  block('admin approving their OWN sheet', { uid: ID.admin, setup: ADMIN_OWN, sql: `update goal_sheets set status='Approved', approved_by='${ID.admin}' where id='${ADMIN_SHEET}'` });
  block('manager approving a DRAFT sheet (skipping submit/validation)', { uid: ID.mgr, sql: `update goal_sheets set status='Approved', approved_by='${ID.mgr}', approved_at=now(), locked_at=now() where id='${SHEET}'` });
  block('manager recording an approval as someone else', { uid: ID.mgr, setup: SUBMITTED, sql: `update goal_sheets set status='Approved', approved_by='${ID.admin}' where id='${SHEET}'` });
  block("unrelated manager approving someone else's sheet", { uid: ID.other, setup: SUBMITTED, sql: `update goal_sheets set status='Approved', approved_by='${ID.other}' where id='${SHEET}'` });
  block('employee editing goals on an approved sheet', { uid: ID.emp, setup: `update goal_sheets set status='Approved' where id='${SHEET}'`, sql: `update goals set weightage=10 where id='${GOAL}'` });
  block('employee editing goals on a submitted sheet', { uid: ID.emp, setup: SUBMITTED, sql: `update goals set weightage=10 where id='${GOAL}'` });
  block('employee forging a manager review on own check-in', { uid: ID.emp, sql: `update check_ins set manager_comment='Great', manager_checked_by='${ID.mgr}', manager_checked_at=now() where id='${CI}'` });
  block('employee inserting a check-in pre-stamped with a manager review', { uid: ID.emp, sql: `insert into check_ins (goal_id,quarter,manager_comment,manager_checked_by) values ('${GOAL}','Q4','Great','${ID.mgr}')` });
  block('admin reviewing their OWN check-in', {
    uid: ID.admin,
    setup: `insert into goal_sheets (id,cycle_id,employee_id,status) values ('${ADMIN_SHEET}','${CYCLE}','${ID.admin}','Approved');
            insert into goals (id,sheet_id,thrust_area,title,uom,direction,target_numeric,weightage) values ('${ADMIN_GOAL}','${ADMIN_SHEET}','T','G','Numeric','min',1,100);
            insert into check_ins (id,goal_id,quarter) values ('${ADMIN_CI}','${ADMIN_GOAL}','Q1')`,
    sql: `update check_ins set manager_comment='me', manager_checked_by='${ID.admin}' where id='${ADMIN_CI}'`,
  });
  block('manager review attributed to another manager', { uid: ID.mgr, sql: `update check_ins set manager_comment='ok', manager_checked_by='${ID.admin}' where id='${CI}'` });
  block('anonymous (logged-out) read of the users directory', { role: 'anon', sql: `select id from users` });
  block('anonymous read of cycles', { role: 'anon', sql: `select id from cycles` });
});
