import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { migrate } from '@/server/db/migrate';
import { closePool, withOrg, withSystem } from '@/server/db/pool';
import { resetConfigForTests } from '@/server/core/config';
import { createOrganization } from '@/server/services/orgs';
import { createUser } from '@/server/services/users';
import { assignRole } from '@/server/services/rbac';
import { loadAccess } from '@/server/services/rbac-load';
import { redeemCredentialToken } from '@/server/auth/login';
import type { Ctx } from '@/server/core/context';

export const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://postgres@localhost:5433/postgres';
export const PASSWORD = 'Correct-Horse-Battery-9';

let dbName = '';
export function adminUrlFor(db: string) { return ADMIN_URL.replace(/\/[^/]*$/, `/${db}`); }

/** Creates a throw-away database, applies every migration as the owner, and points the app at it as the restricted app role. */
export async function setupTestDb() {
  dbName = `plumeo_t_${randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'plumeo_app_role') then create role plumeo_app_role nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'plumeo_app') then create role plumeo_app login password 'plumeo_app' in role plumeo_app_role; end if; end $$`);
  await admin.end();
  await migrate(adminUrlFor(dbName));
  process.env.DATABASE_URL = adminUrlFor(dbName).replace('postgres://postgres@', 'postgres://plumeo_app:plumeo_app@');
  process.env.DB_POOL_MAX = '30';
  resetConfigForTests();
  return { dbName, ownerUrl: adminUrlFor(dbName) };
}

export async function teardownTestDb() {
  await closePool();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}

export async function ctxFor(orgId: string, userId: string, requestId = 'test'): Promise<Ctx> {
  return withSystem(async (tx) => {
    const u = await tx.one<{ full_name: string }>('select full_name from users where org_id = $1 and id = $2', [orgId, userId]);
    const a = await loadAccess(tx, orgId, userId);
    return { orgId, userId, userName: u!.full_name, perms: a.perms, roleKeys: a.roleKeys, requestId, actorType: 'user' as const };
  });
}

export interface TestOrg {
  orgId: string; slug: string; admin: Ctx;
  add(name: string, opts?: { roles?: string[]; managerId?: string | null; departmentId?: string | null; teamId?: string | null; title?: string }): Promise<{ id: string; ctx: () => Promise<Ctx>; email: string }>;
}

let counter = 0;
export async function makeOrg(slug: string, withCycle = true): Promise<TestOrg> {
  const r = await createOrganization({ name: `${slug} Inc`, slug, adminName: 'Ada Admin', adminEmail: `admin@${slug}.test`, adminPassword: PASSWORD, createFirstCycle: withCycle }, { requestId: 'setup' });
  const admin = await ctxFor(r.orgId, r.adminId);
  return {
    orgId: r.orgId, slug, admin,
    async add(name, opts = {}) {
      const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}.${++counter}@${slug}.test`;
      const adminNow = await ctxFor(r.orgId, r.adminId);
      const u = await createUser(adminNow, { email, fullName: name, jobTitle: opts.title, managerId: opts.managerId ?? null, departmentId: opts.departmentId ?? null, teamId: opts.teamId ?? null });
      await redeemCredentialToken({ token: u.inviteToken!, password: PASSWORD }, { requestId: 'setup', ip: 'setup-' + counter });
      for (const role of opts.roles ?? []) await assignRole(await ctxFor(r.orgId, r.adminId), u.id, role);
      return { id: u.id, email, ctx: () => ctxFor(r.orgId, u.id) };
    },
  };
}

export async function activeCycle(orgId: string) {
  return withOrg(orgId, async (tx) => (await tx.one<{ id: string }>(`select id from cycles where org_id = $1 and status = 'active' limit 1`, [orgId]))!.id);
}
export async function periods(orgId: string) {
  return withOrg(orgId, (tx) => tx.query<any>('select * from review_periods where org_id = $1 order by sequence', [orgId]));
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fully valid goal payload that passes submission checks. */
export function goalInput(cycleId: string, over: Record<string, unknown> = {}) {
  const y = new Date().getUTCFullYear();
  return {
    cycleId, level: 'individual', title: 'Grow enterprise pipeline to 40 qualified accounts', description: 'Build and qualify pipeline in the enterprise segment.',
    expectedOutcome: 'A healthy pipeline that supports the annual revenue plan.', startDate: `${y}-01-01`, dueDate: `${y}-12-31`,
    keyResults: [{ title: 'Qualified accounts', metricType: 'number', startValue: 0, targetValue: 40 }], ...over,
  };
}
