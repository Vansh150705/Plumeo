import { z } from 'zod';
import { withOrg, withSystem } from '../db/pool';
import { hashPassword, passwordProblem } from '../core/crypto';
import { type Ctx, requirePerm } from '../core/context';
import { conflict, invalid, notFound } from '../core/errors';
import { parse } from '../core/validation';
import { policySchema, resolvePolicy, type OrgPolicy } from '@/lib/policy';
import { audit } from './audit';
import { seedSystemRoles, grantRoleUnchecked } from './rbac';
import { rateLimit } from '../auth/ratelimit';
import { createCycleInTx } from './cycles';

const slugRe = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(slugRe, 'Use 3–40 lowercase letters, digits or hyphens'),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  adminPassword: z.string().min(1).max(200),
  createFirstCycle: z.boolean().optional(),
}).strict();

const RESERVED = new Set(['admin', 'api', 'app', 'www', 'platform', 'login', 'signup', 'static', 'scim', 'health', 'plumeo']);

/** Creates an organisation, its system roles, default policy and first administrator in ONE transaction. */
export async function createOrganization(input: unknown, meta: { requestId: string; ip?: string }) {
  const d = parse(createOrgSchema, input);
  const prob = passwordProblem(d.adminPassword);
  if (prob) throw invalid(prob);
  if (RESERVED.has(d.slug)) throw conflict('That workspace address is reserved.');
  if (meta.ip) await rateLimit('org-create', meta.ip, 5, 3600);
  const pw = await hashPassword(d.adminPassword);
  return withSystem(async (tx) => {
    if (await tx.one('select 1 from orgs where slug = $1', [d.slug])) throw conflict('That workspace address is already taken.');
    const org = await tx.one<{ id: string }>('insert into orgs (slug, name) values ($1,$2) returning id', [d.slug, d.name]);
    const orgId = org!.id;
    await tx.exec('insert into org_policies (org_id, settings) values ($1, $2)', [orgId, JSON.stringify({})]);
    await seedSystemRoles(tx, orgId);
    const admin = await tx.one<{ id: string }>(
      `insert into users (org_id, email, full_name, status, password_hash, password_changed_at) values ($1,$2,$3,'active',$4, now()) returning id`,
      [orgId, d.adminEmail, d.adminName, pw]);
    await grantRoleUnchecked(tx, orgId, admin!.id, 'employee', null);
    await grantRoleUnchecked(tx, orgId, admin!.id, 'org_admin', null);
    const actor: Ctx = { orgId, userId: admin!.id, userName: d.adminName, perms: new Set(), roleKeys: [], requestId: meta.requestId, actorType: 'user', ip: meta.ip };
    await audit(tx, actor, { action: 'org.created', entityType: 'org', entityId: orgId, after: { slug: d.slug, name: d.name } });
    await audit(tx, actor, { action: 'user.created', entityType: 'user', entityId: admin!.id, after: { roles: ['employee', 'org_admin'] } });
    if (d.createFirstCycle) {
      const y = new Date().getUTCFullYear();
      await createCycleInTx(tx, actor, { name: `FY ${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, cadence: 'quarterly', activate: true });
    }
    return { orgId, adminId: admin!.id, slug: d.slug };
  });
}

export async function getOrg(ctx: Ctx) {
  return withOrg(ctx.orgId, async (tx) => {
    const o = await tx.one<any>('select id, slug, name, status, created_at from orgs where id = $1', [ctx.orgId]);
    if (!o) throw notFound('Organisation');
    return o;
  });
}

export async function updateOrgName(ctx: Ctx, name: unknown) {
  requirePerm(ctx, 'org.manage');
  const n = parse(z.string().trim().min(2).max(120), name);
  return withOrg(ctx.orgId, async (tx) => {
    const before = await tx.one<{ name: string }>('select name from orgs where id = $1', [ctx.orgId]);
    await tx.exec('update orgs set name = $2, updated_at = now() where id = $1', [ctx.orgId, n]);
    await audit(tx, ctx, { action: 'org.updated', entityType: 'org', entityId: ctx.orgId, before: { name: before?.name }, after: { name: n } });
    return { name: n };
  });
}

export async function getPolicy(ctx: Ctx): Promise<{ policy: OrgPolicy; version: number }> {
  return withOrg(ctx.orgId, async (tx) => {
    const r = await tx.one<{ settings: unknown; version: number }>('select settings, version from org_policies where org_id = $1', [ctx.orgId]);
    return { policy: resolvePolicy(r?.settings), version: r?.version ?? 1 };
  });
}

export async function updatePolicy(ctx: Ctx, input: unknown, expectedVersion?: number) {
  requirePerm(ctx, 'policies.manage');
  const next = parse(policySchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<{ settings: unknown; version: number }>('select settings, version from org_policies where org_id = $1 for update', [ctx.orgId]);
    if (expectedVersion != null && cur && cur.version !== expectedVersion) throw conflict('Policies were changed by someone else. Reload and try again.');
    const before = resolvePolicy(cur?.settings);
    await tx.exec(`insert into org_policies (org_id, settings, version, updated_by, updated_at) values ($1,$2,1,$3, now())
      on conflict (org_id) do update set settings = excluded.settings, version = org_policies.version + 1, updated_by = excluded.updated_by, updated_at = now()`,
      [ctx.orgId, JSON.stringify(next), ctx.userId]);
    await audit(tx, ctx, { action: 'policy.updated', entityType: 'policy', entityId: ctx.orgId, before, after: next });
    return { policy: next, version: (cur?.version ?? 0) + 1 };
  });
}

/** Platform (super admin) operations — organisation lifecycle only, never tenant data. */
export async function listOrgsForPlatform() {
  return withSystem((tx) => tx.query(
    `select o.id, o.slug, o.name, o.status, o.created_at,
            (select count(*)::int from users u where u.org_id = o.id and u.status = 'active') as active_users
     from orgs o order by o.created_at desc limit 500`));
}

export async function setOrgStatus(orgId: string, status: 'active' | 'suspended', platformAdminId: string, requestId: string) {
  if (!['active', 'suspended'].includes(status)) throw invalid('Invalid status');
  return withSystem(async (tx) => {
    const o = await tx.one('select id from orgs where id = $1', [orgId]);
    if (!o) throw notFound('Organisation');
    await tx.exec('update orgs set status = $2, updated_at = now() where id = $1', [orgId, status]);
    if (status === 'suspended') await tx.exec('update sessions set revoked_at = now() where org_id = $1 and revoked_at is null', [orgId]);
    await audit(tx, { orgId, userId: platformAdminId, userName: 'Platform', perms: new Set(), roleKeys: [], requestId, actorType: 'platform' },
      { action: status === 'suspended' ? 'org.suspended' : 'org.reactivated', entityType: 'org', entityId: orgId });
    return { id: orgId, status };
  });
}
