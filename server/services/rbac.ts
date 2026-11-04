import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm, can } from '../core/context';
import { conflict, forbidden, invalid, notFound } from '../core/errors';
import { parse, uuid } from '../core/validation';
import { ALL_PERMISSIONS, MANAGERIAL_PERMISSIONS, SYSTEM_ROLES, type Permission } from '@/lib/permissions';
import { audit } from './audit';
export { loadAccess } from './rbac-load';
import { revokeUserSessions } from '../auth/sessions';

export async function seedSystemRoles(tx: Tx, orgId: string) {
  for (const r of SYSTEM_ROLES) {
    await tx.exec(
      `insert into roles (org_id, key, name, description, permissions, is_system) values ($1,$2,$3,$4,$5,true)
       on conflict (org_id, key) do update set permissions = excluded.permissions, name = excluded.name, description = excluded.description
       where roles.is_system`,
      [orgId, r.key, r.name, r.description, r.permissions],
    );
  }
}

/** Grant a role without actor checks. Used for system-driven grants (bootstrap, structure changes) — always audited by the caller. */
export async function grantRoleUnchecked(tx: Tx, orgId: string, userId: string, roleKey: string, grantedBy: string | null) {
  const role = await tx.one<{ id: string }>('select id from roles where org_id = $1 and key = $2', [orgId, roleKey]);
  if (!role) throw notFound('Role');
  return (await tx.exec(
    `insert into user_roles (org_id, user_id, role_id, granted_by) values ($1,$2,$3,$4) on conflict do nothing`,
    [orgId, userId, role.id, grantedBy])) > 0;
}

/** Ensure the implicit management role exists for someone given reports / a department to lead. */
export async function ensureRole(tx: Tx, ctx: Ctx, userId: string, roleKey: string, reason: string) {
  const granted = await grantRoleUnchecked(tx, ctx.orgId, userId, roleKey, ctx.userId);
  if (granted) await audit(tx, ctx, { action: 'role.granted', entityType: 'user', entityId: userId, after: { role: roleKey }, metadata: { reason, automatic: true } });
}

export async function listRoles(ctx: Ctx) {
  return withOrg(ctx.orgId, async (tx) => {
    return tx.query(
      `select r.id, r.key, r.name, r.description, r.permissions, r.is_system,
              (select count(*)::int from user_roles ur where ur.org_id = r.org_id and ur.role_id = r.id) as member_count
       from roles r where r.org_id = $1 order by r.is_system desc, r.name`, [ctx.orgId]);
  });
}

export async function listUserRoles(ctx: Ctx, userId: string) {
  if (userId !== ctx.userId) requirePerm(ctx, 'roles.manage', 'users.read');
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select r.id, r.key, r.name from user_roles ur join roles r on r.org_id = ur.org_id and r.id = ur.role_id
     where ur.org_id = $1 and ur.user_id = $2 order by r.name`, [ctx.orgId, userId]));
}

async function activeOrgAdminCount(tx: Tx, orgId: string, excludeUser?: string) {
  const r = await tx.one<{ n: number }>(
    `select count(*)::int as n from user_roles ur join roles r on r.org_id = ur.org_id and r.id = ur.role_id
     join users u on u.org_id = ur.org_id and u.id = ur.user_id
     where ur.org_id = $1 and r.key = 'org_admin' and u.status = 'active' and ($2::uuid is null or u.id <> $2)`, [orgId, excludeUser ?? null]);
  return r!.n;
}
export { activeOrgAdminCount };

function assertCanGrant(ctx: Ctx, perms: string[]) {
  // Privilege-escalation guard: privileged permissions can only be handed out by someone who holds them.
  const missing = perms.filter((p) => !ctx.perms.has(p) && !(MANAGERIAL_PERMISSIONS as string[]).includes(p));
  if (missing.length) throw forbidden(`You cannot grant permissions you do not hold: ${missing.slice(0, 3).join(', ')}.`);
}

export async function assignRole(ctx: Ctx, userId: string, roleKey: string) {
  requirePerm(ctx, 'roles.manage');
  if (userId === ctx.userId) throw forbidden('You cannot change your own roles.');
  return withOrg(ctx.orgId, async (tx) => {
    const target = await tx.one<{ id: string; status: string }>('select id, status from users where org_id = $1 and id = $2', [ctx.orgId, userId]);
    if (!target) throw notFound('User');
    if (target.status !== 'active' && target.status !== 'invited') throw conflict('Roles can only be assigned to active users.');
    const role = await tx.one<{ id: string; permissions: string[] }>('select id, permissions from roles where org_id = $1 and key = $2', [ctx.orgId, roleKey]);
    if (!role) throw notFound('Role');
    assertCanGrant(ctx, role.permissions);
    const added = await tx.exec(`insert into user_roles (org_id, user_id, role_id, granted_by) values ($1,$2,$3,$4) on conflict do nothing`, [ctx.orgId, userId, role.id, ctx.userId]);
    if (added) await audit(tx, ctx, { action: 'role.granted', entityType: 'user', entityId: userId, after: { role: roleKey } });
    return { changed: added > 0 };
  });
}

export async function revokeRole(ctx: Ctx, userId: string, roleKey: string) {
  requirePerm(ctx, 'roles.manage');
  if (userId === ctx.userId) throw forbidden('You cannot change your own roles.');
  if (roleKey === 'employee') throw conflict('The base Employee role cannot be removed.');
  return withOrg(ctx.orgId, async (tx) => {
    const role = await tx.one<{ id: string; permissions: string[] }>('select id, permissions from roles where org_id = $1 and key = $2', [ctx.orgId, roleKey]);
    if (!role) throw notFound('Role');
    assertCanGrant(ctx, role.permissions);
    if (roleKey === 'org_admin' && (await activeOrgAdminCount(tx, ctx.orgId, userId)) === 0) {
      throw conflict('An organisation must always keep at least one administrator.');
    }
    const n = await tx.exec('delete from user_roles where org_id = $1 and user_id = $2 and role_id = $3', [ctx.orgId, userId, role.id]);
    if (n) await audit(tx, ctx, { action: 'role.revoked', entityType: 'user', entityId: userId, before: { role: roleKey } });
    return { changed: n > 0 };
  });
}

const customRoleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Use lowercase letters, digits and underscores'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).max(40),
}).strict();

function validatePerms(perms: string[]) {
  const unknown = perms.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
  if (unknown.length) throw invalid(`Unknown permissions: ${unknown.join(', ')}`);
  return [...new Set(perms)] as Permission[];
}

export async function createCustomRole(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'roles.manage');
  const d = parse(customRoleSchema, input);
  const perms = validatePerms(d.permissions);
  assertCanGrant(ctx, perms);
  return withOrg(ctx.orgId, async (tx) => {
    if (await tx.one('select 1 from roles where org_id = $1 and key = $2', [ctx.orgId, d.key])) throw conflict('A role with that key already exists.');
    const r = await tx.one<{ id: string }>(
      `insert into roles (org_id, key, name, description, permissions, is_system) values ($1,$2,$3,$4,$5,false) returning id`,
      [ctx.orgId, d.key, d.name, d.description ?? null, perms]);
    await audit(tx, ctx, { action: 'role.created', entityType: 'role', entityId: r!.id, after: { key: d.key, permissions: perms } });
    return { id: r!.id };
  });
}

export async function updateCustomRole(ctx: Ctx, roleId: string, input: unknown) {
  requirePerm(ctx, 'roles.manage');
  parse(uuid, roleId);
  const d = parse(customRoleSchema.omit({ key: true }).partial().strict(), input);
  return withOrg(ctx.orgId, async (tx) => {
    const role = await tx.one<any>('select * from roles where org_id = $1 and id = $2 for update', [ctx.orgId, roleId]);
    if (!role) throw notFound('Role');
    if (role.is_system) throw forbidden('Built-in roles cannot be edited. Create a custom role instead.');
    const perms = d.permissions ? validatePerms(d.permissions) : role.permissions;
    assertCanGrant(ctx, perms);
    await tx.exec('update roles set name = coalesce($3, name), description = coalesce($4, description), permissions = $5 where org_id = $1 and id = $2',
      [ctx.orgId, roleId, d.name ?? null, d.description ?? null, perms]);
    await audit(tx, ctx, { action: 'role.updated', entityType: 'role', entityId: roleId, before: { permissions: role.permissions }, after: { permissions: perms } });
    return { ok: true };
  });
}

export async function deleteCustomRole(ctx: Ctx, roleId: string) {
  requirePerm(ctx, 'roles.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const role = await tx.one<any>('select * from roles where org_id = $1 and id = $2 for update', [ctx.orgId, roleId]);
    if (!role) throw notFound('Role');
    if (role.is_system) throw forbidden('Built-in roles cannot be deleted.');
    assertCanGrant(ctx, role.permissions);
    await tx.exec('delete from user_roles where org_id = $1 and role_id = $2', [ctx.orgId, roleId]);
    await tx.exec('delete from roles where org_id = $1 and id = $2', [ctx.orgId, roleId]);
    await audit(tx, ctx, { action: 'role.deleted', entityType: 'role', entityId: roleId, before: { key: role.key } });
    return { ok: true };
  });
}

/** Called when permissions of a user may have changed in ways sessions should not outlive (deactivation etc.). */
export { revokeUserSessions, can };
