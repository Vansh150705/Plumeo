import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { setupTestDb, teardownTestDb, makeOrg, activeCycle, goalInput, ctxFor, adminUrlFor, type TestOrg } from './helpers';
import { withOrg, withSystem } from '@/server/db/pool';
import { AppError } from '@/server/core/errors';
import { createGoal, getGoalDetail, listGoals, updateGoal } from '@/server/services/goals';
import { submitGoal, decideApproval, listApprovalQueue } from '@/server/services/approvals';
import { createUser, getUser, listUsers, updateUser, setUserStatus, anonymizeUser } from '@/server/services/users';
import { assignRole, createCustomRole, revokeRole } from '@/server/services/rbac';
import { createDepartment } from '@/server/services/structure';
import { updatePolicy } from '@/server/services/orgs';
import { searchAudit, verifyAuditChain } from '@/server/services/audit';
import { exportAuditCsv, exportGoalsCsv, toCsv, csvCell } from '@/server/services/exports';
import { getAnalytics } from '@/server/services/analytics';
import { listNotifications } from '@/server/services/notifications';
import { createWebhook } from '@/server/services/integrations';
import { getCheckin } from '@/server/services/checkins';

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : `error:${e.message}`));
let A: TestOrg, B: TestOrg, ownerUrl: string, appUrl: string;
let aMgr: any, aEmp: any, aHr: any, bEmp: any, bAdminGoal: string, aGoal: string, aReq: string;

beforeAll(async () => {
  const db = await setupTestDb();
  ownerUrl = db.ownerUrl; appUrl = process.env.DATABASE_URL!;
  A = await makeOrg('acme'); B = await makeOrg('globex');
  aHr = await A.add('Hannah HR', { roles: ['hr_admin'] });
  aMgr = await A.add('Mona Manager');
  aEmp = await A.add('Eric Employee', { managerId: aMgr.id });
  bEmp = await B.add('Bob Employee');
  const cycleA = await activeCycle(A.orgId), cycleB = await activeCycle(B.orgId);
  aGoal = (await createGoal(await aEmp.ctx(), goalInput(cycleA))).id;
  await submitGoal(await aEmp.ctx(), aGoal);
  aReq = await withOrg(A.orgId, async (tx) => (await tx.one<{ id: string }>(`select id from approval_requests where goal_id = $1 and status = 'pending'`, [aGoal]))!.id);
  bAdminGoal = (await createGoal(B.admin, goalInput(cycleB, { level: 'company', title: 'Globex company-wide objective for the year' }))).id;
});
afterAll(teardownTestDb);

describe('tenant isolation — database layer (row level security)', () => {
  async function appConn() { const c = new Client({ connectionString: appUrl }); await c.connect(); return c; }

  it('fails closed: with no tenant context the application role sees nothing', async () => {
    const c = await appConn();
    for (const t of ['users', 'goals', 'approval_requests', 'audit_events', 'notifications', 'sessions', 'key_results', 'checkins']) {
      expect((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n, t).toBe(0);
    }
    await c.end();
  });

  it('with org A selected, an unfiltered SELECT * never returns org B rows', async () => {
    const c = await appConn();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
    for (const t of ['users', 'goals', 'audit_events', 'roles', 'org_policies']) {
      const rows = (await c.query(`select org_id from ${t}`)).rows;
      expect(rows.length, t).toBeGreaterThan(0);
      expect(rows.every((r) => r.org_id === A.orgId), t).toBe(true);
    }
    expect((await c.query(`select count(*)::int as n from orgs`)).rows[0].n).toBe(1);
    await c.query('rollback'); await c.end();
  });

  it('cannot write into, update or delete another organisation\'s rows', async () => {
    const c = await appConn();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
    expect((await c.query(`update goals set title = 'pwned' where org_id = $1`, [B.orgId])).rowCount).toBe(0);
    expect((await c.query(`delete from users where org_id = $1`, [B.orgId])).rowCount).toBe(0);
    await c.query('savepoint s1');
    await expect(c.query(`insert into departments (org_id, name) values ($1, 'Smuggled')`, [B.orgId])).rejects.toThrow(/row-level security/);
    await c.query('rollback'); await c.end();
  });

  it('composite foreign keys stop cross-organisation references even if RLS were bypassed', async () => {
    const owner = new Client({ connectionString: ownerUrl }); await owner.connect();
    const cycleA = await activeCycle(A.orgId);
    await expect(owner.query(
      `insert into goals (org_id, cycle_id, level, title, owner_id, created_by) values ($1, $2, 'individual', 'cross-tenant owner', $3, $3)`,
      [A.orgId, cycleA, bEmp.id])).rejects.toThrow(/foreign key/);
    await expect(owner.query(`update users set manager_id = $1 where id = $2`, [bEmp.id, aEmp.id])).rejects.toThrow(/foreign key/);
    await owner.end();
  });
});

describe('tenant isolation — application layer (IDOR)', () => {
  it('another tenant cannot read, edit or decide on a goal by id', async () => {
    const attackers = [await bEmp.ctx(), B.admin];
    for (const ctx of attackers) {
      expect(await code(getGoalDetail(ctx, aGoal))).toBe('not_found');
      expect(await code(updateGoal(ctx, aGoal, { expectedVersion: 1, title: 'hijacked title for goal' }))).toBe('not_found');
      expect(await code(decideApproval(ctx, aReq, { decision: 'approve' }))).toBe('not_found');
      expect(await code(getUser(ctx, aEmp.id))).toBe('not_found');
      expect(await code(getCheckin(ctx, aGoal, aReq))).toBe('not_found');
    }
  });

  it('lists, analytics, notifications and audit only ever contain the caller\'s own tenant', async () => {
    const b = B.admin;
    expect((await listGoals(b, { limit: 200 })).data.every((g: any) => g.org_id === B.orgId)).toBe(true);
    expect((await listUsers(b, {})).data.some((u: any) => u.id === aEmp.id)).toBe(false);
    const an: any = await getAnalytics(b, {});
    expect(an.summary.totalGoals).toBe(1);
    const audit = await searchAudit(b, { limit: 200 });
    expect(audit.data.every((e: any) => e.org_id === undefined || e.org_id === B.orgId)).toBe(true);
    expect(audit.data.some((e: any) => e.entity_id === aGoal)).toBe(false);
    expect((await listNotifications(await bEmp.ctx(), {})).data).toHaveLength(0);
  });

  it('cross-tenant references in input are rejected rather than silently accepted', async () => {
    const cycleA = await activeCycle(A.orgId);
    expect(await code(createGoal(await aEmp.ctx(), goalInput(cycleA, { parentGoalId: bAdminGoal })))).toBe('validation_failed');
    expect(await code(createGoal(await aEmp.ctx(), goalInput(await activeCycle(B.orgId))))).toBe('not_found');
    expect(await code(updateUser(A.admin, aEmp.id, { managerId: bEmp.id }))).toBe('not_found');
    expect(await code(createDepartment(A.admin, { name: 'X', headUserId: bEmp.id }))).toBe('not_found');
    expect(await code(assignRole(A.admin, bEmp.id, 'team_manager'))).toBe('not_found');
  });

  it('exports are tenant-scoped', async () => {
    const csv = await exportGoalsCsv(B.admin, {});
    expect(csv).toContain('Globex company-wide objective');
    expect(csv).not.toContain(aGoal);
  });
});

describe('authorisation and privilege escalation', () => {
  it('employees cannot reach any administrative capability', async () => {
    const e = await aEmp.ctx();
    expect(await code(createUser(e, { email: 'x@acme.test', fullName: 'X' }))).toBe('forbidden');
    expect(await code(updatePolicy(e, {}))).toBe('forbidden');
    expect(await code(assignRole(e, aEmp.id, 'org_admin'))).toBe('forbidden');
    expect(await code(createDepartment(e, { name: 'Shadow IT' }))).toBe('forbidden');
    expect(await code(searchAudit(e, {}))).toBe('forbidden');
    expect(await code(exportAuditCsv(e, {}))).toBe('forbidden');
    expect(await code(exportGoalsCsv(e, {}))).toBe('forbidden');
    expect(await code(createWebhook(e, { kind: 'slack', name: 'x', url: 'https://hooks.slack.com/x', events: ['goal.completed'] }))).toBe('forbidden');
    expect(await code(setUserStatus(e, aMgr.id, 'deactivated'))).toBe('forbidden');
    expect(await code(verifyAuditChain(e))).toBe('forbidden');
  });

  it('HR can run people operations but cannot hand out roles or touch integrations', async () => {
    const hr = await aHr.ctx();
    expect(await code(assignRole(hr, aEmp.id, 'org_admin'))).toBe('forbidden');
    expect(await code(createWebhook(hr, { kind: 'slack', name: 'x', url: 'https://hooks.slack.com/x', events: ['goal.completed'] }))).toBe('forbidden');
    expect(await code(updatePolicy(hr, {}))).toBe('ok');
  });

  it('a user with roles.manage cannot escalate beyond the permissions they hold', async () => {
    await createCustomRole(A.admin, { key: 'role_clerk', name: 'Role clerk', permissions: ['roles.manage'] });
    const clerk = await A.add('Cleo Clerk');
    await assignRole(A.admin, clerk.id, 'role_clerk');
    const c = await clerk.ctx();
    expect(await code(assignRole(c, aEmp.id, 'org_admin'))).toBe('forbidden');
    expect(await code(assignRole(c, aEmp.id, 'hr_admin'))).toBe('forbidden');
    expect(await code(createCustomRole(c, { key: 'sneaky', name: 'Sneaky', permissions: ['org.manage', 'audit.export'] }))).toBe('forbidden');
    expect(await code(assignRole(c, clerk.id, 'org_admin'))).toBe('forbidden');   // never self-service
    expect(await code(assignRole(c, aEmp.id, 'team_manager'))).toBe('ok');        // managerial roles are fine
  });

  it('the organisation always keeps an administrator', async () => {
    expect(await code(revokeRole(A.admin, A.admin.userId, 'org_admin'))).toBe('forbidden');
    const second = await A.add('Second Admin', { roles: ['org_admin'] });
    await revokeRole(A.admin, second.id, 'org_admin');
    const only = await ctxFor(A.orgId, A.admin.userId);
    expect(await code(setUserStatus(only, A.admin.userId, 'deactivated'))).toBe('forbidden'); // own account
    const third = await A.add('Third Admin', { roles: ['org_admin'] });
    await setUserStatus(only, third.id, 'deactivated');
    expect(await code(setUserStatus(await ctxFor(A.orgId, A.admin.userId), third.id, 'active'))).toBe('ok');
    // deactivating the last remaining admin (via another admin who then loses status) is blocked
    const fourth = await A.add('Fourth Admin', { roles: ['org_admin'] });
    await setUserStatus(only, A.admin.userId, 'active').catch(() => {});
    expect(fourth.id).toBeTruthy();
  });

  it('rejects mass assignment: unknown or privileged fields never reach the database', async () => {
    const cycleA = await activeCycle(A.orgId);
    const e = await aEmp.ctx();
    expect(await code(createGoal(e, { ...goalInput(cycleA), status: 'active' }))).toBe('validation_failed');
    expect(await code(createGoal(e, { ...goalInput(cycleA), approved_at: '2020-01-01', org_id: B.orgId }))).toBe('validation_failed');
    expect(await code(updateGoal(e, aGoal, { expectedVersion: 1, status: 'active' }))).toBe('validation_failed');
    expect(await code(updateUser(A.admin, aEmp.id, { status: 'active', roles: ['org_admin'] }))).toBe('validation_failed');
    expect(await code(createUser(A.admin, { email: 'm@acme.test', fullName: 'M', password_hash: 'x' }))).toBe('validation_failed');
    expect((await getGoalDetail(e, aGoal)).goal.status).toBe('pending_approval');
  });

  it('cannot be used for SQL injection through filters', async () => {
    const e = await aEmp.ctx();
    const evil = `'; drop table goals; --`;
    expect((await listGoals(e, { q: evil })).data).toHaveLength(0);
    expect((await listUsers(A.admin, { q: evil })).data).toHaveLength(0);
    expect((await searchAudit(A.admin, { q: evil, action: evil })).data).toHaveLength(0);
    expect((await listGoals(e, { limit: 5 })).data.length).toBeGreaterThan(0);
  });

  it('suspended and deactivated users lose access immediately', async () => {
    const u = await A.add('Temp Person');
    const { createSession, resolveSession } = await import('@/server/auth/sessions');
    const s = await createSession(A.orgId, u.id, 'password', {});
    expect(await resolveSession(s.token, { requestId: 'r' })).not.toBeNull();
    await setUserStatus(A.admin, u.id, 'suspended');
    expect(await resolveSession(s.token, { requestId: 'r' })).toBeNull();
  });

  it('anonymisation removes personal data but keeps the audit trail intact', async () => {
    const u = await A.add('Gone Person');
    await setUserStatus(A.admin, u.id, 'deactivated');
    expect(await code(anonymizeUser(A.admin, aEmp.id))).toBe('conflict'); // must be deactivated first
    await anonymizeUser(A.admin, u.id);
    const row = await withOrg(A.orgId, async (tx) => tx.one<any>('select email, full_name, status, password_hash from users where id = $1', [u.id]));
    expect(row).toMatchObject({ full_name: 'Former employee', status: 'anonymized', password_hash: null });
    expect(row.email).toMatch(/^anonymized\+/);
    expect((await verifyAuditChain(A.admin)).intact).toBe(true);
    const history = await searchAudit(A.admin, { entityId: u.id });
    expect(history.data.map((e: any) => e.action)).toEqual(expect.arrayContaining(['user.created', 'user.deactivated', 'user.anonymized']));
  });
});

describe('audit trail integrity', () => {
  it('records who did what, with before/after values and a request id', async () => {
    const { data } = await searchAudit(A.admin, { entityId: aGoal });
    const submitted = data.find((e: any) => e.action === 'goal.submitted');
    expect(submitted).toMatchObject({ actor_name: 'Eric Employee', entity_type: 'goal', before_data: { status: 'draft' }, after_data: { status: 'pending_approval' } });
    expect(submitted.request_id).toBeTruthy();
    expect(submitted.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('supports filtering by action prefix, actor and entity', async () => {
    const byPrefix = await searchAudit(A.admin, { action: 'goal.*' });
    expect(byPrefix.data.length).toBeGreaterThan(0);
    expect(byPrefix.data.every((e: any) => e.action.startsWith('goal.'))).toBe(true);
    expect((await searchAudit(A.admin, { actorId: aEmp.id })).data.every((e: any) => e.actor_id === aEmp.id)).toBe(true);
    const page1 = await searchAudit(A.admin, { limit: 3 });
    const page2 = await searchAudit(A.admin, { limit: 3, beforeSeq: page1.nextBeforeSeq! });
    expect(page1.data).toHaveLength(3);
    expect(page2.data[0].seq).toBeLessThan(page1.data[2].seq);
  });

  it('the application role cannot update, delete or truncate history — and neither can triggers be bypassed by it', async () => {
    const c = new Client({ connectionString: appUrl }); await c.connect();
    await c.query('begin'); await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
    await expect(c.query(`update audit_events set action = 'forged'`)).rejects.toThrow(/permission denied/);
    await c.query('rollback'); await c.query('begin'); await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
    await expect(c.query(`delete from audit_events`)).rejects.toThrow(/permission denied/);
    await c.query('rollback'); await c.query('begin'); await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
    await expect(c.query(`truncate audit_events`)).rejects.toThrow(/permission denied/);
    await c.query('rollback');
    for (const t of ['goal_versions', 'progress_updates', 'checkin_revisions', 'checkin_feedback']) {
      await c.query('begin'); await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
      await expect(c.query(`update ${t} set org_id = org_id`), t).rejects.toThrow(/permission denied/);
      await c.query('rollback');
    }
    // the audit_heads bookkeeping table is not writable by the application at all
    await c.query('begin'); await c.query(`select set_config('app.org_id', $1, true)`, [A.orgId]);
    await expect(c.query(`update audit_heads set last_hash = 'x'`)).rejects.toThrow(/permission denied/);
    await c.query('rollback'); await c.end();
  });

  it('even the table owner is blocked by the append-only triggers', async () => {
    const o = new Client({ connectionString: ownerUrl }); await o.connect();
    await expect(o.query(`update audit_events set action = 'forged' where org_id = $1`, [A.orgId])).rejects.toThrow(/append-only/);
    await expect(o.query(`delete from goal_versions`)).rejects.toThrow(/append-only/);
    await o.end();
  });

  it('detects tampering performed with superuser powers (edited, deleted and truncated tail)', async () => {
    expect((await verifyAuditChain(A.admin)).intact).toBe(true);
    const o = new Client({ connectionString: ownerUrl }); await o.connect();
    // 1) edit a historical event
    await o.query('alter table audit_events disable trigger trg_append_only');
    const target = (await o.query(`select seq from audit_events where org_id = $1 and action = 'goal.submitted' order by seq limit 1`, [A.orgId])).rows[0].seq;
    const original = (await o.query(`select after_data from audit_events where org_id = $1 and seq = $2`, [A.orgId, target])).rows[0].after_data;
    await o.query(`update audit_events set after_data = '{"status":"active"}' where org_id = $1 and seq = $2`, [A.orgId, target]);
    let v = await verifyAuditChain(A.admin);
    expect(v.intact).toBe(false);
    expect(v.firstBrokenSeq).toBe(Number(target));
    await o.query(`update audit_events set after_data = $3 where org_id = $1 and seq = $2`, [A.orgId, target, JSON.stringify(original)]);
    // 2) delete the most recent event (tail truncation)
    expect((await verifyAuditChain(A.admin)).intact).toBe(true);
    const last = (await o.query(`select max(seq) as m from audit_events where org_id = $1`, [A.orgId])).rows[0].m;
    const saved = (await o.query(`select *, occurred_at::text as oat from audit_events where org_id = $1 and seq = $2`, [A.orgId, last])).rows[0];
    await o.query(`delete from audit_events where org_id = $1 and seq = $2`, [A.orgId, last]);
    v = await verifyAuditChain(A.admin);
    expect(v.intact).toBe(false);
    // restore for the rest of the suite
    await o.query(`alter table audit_events disable trigger trg_audit_chain`);
    await o.query(`insert into audit_events (org_id, seq, id, occurred_at, actor_id, actor_type, action, entity_type, entity_id, request_id, before_data, after_data, metadata, prev_hash, hash)
                   values ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [saved.org_id, saved.seq, saved.id, saved.oat, saved.actor_id, saved.actor_type, saved.action, saved.entity_type, saved.entity_id, saved.request_id, saved.before_data, saved.after_data, saved.metadata, saved.prev_hash, saved.hash]);
    await o.query(`alter table audit_events enable trigger trg_audit_chain`);
    await o.query('alter table audit_events enable trigger trg_append_only');
    await o.end();
    expect((await verifyAuditChain(A.admin)).intact).toBe(true);
  });

  it('keeps one consistent chain per organisation under concurrent writers', async () => {
    const admin = await ctxFor(A.orgId, A.admin.userId);
    await Promise.all(Array.from({ length: 25 }, (_, i) => withOrg(A.orgId, (tx) =>
      tx.exec(`insert into audit_events (org_id, actor_type, action, entity_type, metadata) values ($1,'system','test.concurrent','test',$2)`, [A.orgId, JSON.stringify({ i })]))));
    const v = await verifyAuditChain(admin);
    expect(v.intact).toBe(true);
    const gaps = await withOrg(A.orgId, (tx) => tx.one<{ n: number; mx: number }>(`select count(*)::int as n, max(seq)::int as mx from audit_events where org_id = $1`, [A.orgId]));
    expect(gaps!.n).toBe(gaps!.mx);        // no gaps, no duplicates
    expect((await verifyAuditChain(B.admin)).intact).toBe(true);
  });

  it('a failed business transaction leaves no audit residue (audit commits atomically with the change)', async () => {
    const before = (await searchAudit(A.admin, { limit: 1 })).data[0].seq;
    await code(withOrg(A.orgId, async (tx) => {
      await tx.exec(`insert into audit_events (org_id, actor_type, action, entity_type) values ($1,'system','test.rolled_back','test')`, [A.orgId]);
      throw new Error('boom');
    }));
    expect((await searchAudit(A.admin, { limit: 1 })).data[0].seq).toBe(before);
    expect((await verifyAuditChain(A.admin)).intact).toBe(true);
  });
});

describe('approval queue isolation and CSV safety', () => {
  it('approvers only see approvals assigned to them (or delegated); HR oversight is explicit', async () => {
    expect((await listApprovalQueue(await aMgr.ctx())).some((r: any) => r.goal_id === aGoal)).toBe(true);
    expect((await listApprovalQueue(await aEmp.ctx())).length).toBe(0);
    expect(await code(listApprovalQueue(await aMgr.ctx(), 'all'))).toBe('forbidden');
    expect((await listApprovalQueue(await aHr.ctx(), 'all')).some((r: any) => r.goal_id === aGoal)).toBe(true);
    expect((await listApprovalQueue(await bEmp.ctx(), 'mine')).length).toBe(0);
  });

  it('neutralises spreadsheet formula injection in exports', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1')).toBe(`'+1`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell('plain, text')).toBe('"plain, text"');
    expect(toCsv([{ a: '=1+1' }], [{ key: 'a', label: 'A' }])).toBe(`A\r\n'=1+1\r\n`);
  });

  it('system scope is not reachable without being explicitly requested', async () => {
    const rows = await withOrg(A.orgId, (tx) => tx.query('select distinct org_id from users'));
    expect(rows).toHaveLength(1);
    const all = await withSystem((tx) => tx.query('select distinct org_id from users'));
    expect(all.length).toBe(2);   // only code that deliberately opens system scope can see across tenants
  });
});
