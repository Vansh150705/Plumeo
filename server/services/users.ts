import { z } from 'zod';
import { MANAGERIAL_PERMISSIONS } from '@/lib/permissions';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, can, requirePerm } from '../core/context';
import { conflict, forbidden, invalid, notFound } from '../core/errors';
import { pageParams, parse, uuid, type Page } from '../core/validation';
import { audit } from './audit';
import { ensureRole, grantRoleUnchecked, activeOrgAdminCount } from './rbac';
import { issueCredentialToken } from '../auth/login';
import { revokeUserSessions } from '../auth/sessions';
import { notify } from './notifications';
import { config } from '../core/config';
import { sendInviteEmail } from './mailer';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const emailSchema = z.string().trim().toLowerCase().email().max(200);

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(1).max(120),
  jobTitle: z.string().trim().max(120).optional(),
  employeeNumber: z.string().trim().max(40).optional(),
  managerId: uuid.nullable().optional(),
  departmentId: uuid.nullable().optional(),
  teamId: uuid.nullable().optional(),
  roles: z.array(z.string()).max(10).optional(),
  externalId: z.string().trim().max(200).optional(),
}).strict();

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  employeeNumber: z.string().trim().max(40).nullable().optional(),
  managerId: uuid.nullable().optional(),
  departmentId: uuid.nullable().optional(),
  teamId: uuid.nullable().optional(),
  externalId: z.string().trim().max(200).nullable().optional(),
}).strict();

const PUBLIC_FIELDS = `u.id, u.full_name, u.job_title, u.status, u.manager_id, u.department_id, u.team_id,
  d.name as department_name, t.name as team_name, m.full_name as manager_name`;

/** Validates that department/team/manager belong to this org and are mutually consistent. */
async function checkPlacement(tx: Tx, orgId: string, userId: string | null, p: { managerId?: string | null; departmentId?: string | null; teamId?: string | null }) {
  if (p.managerId) {
    if (p.managerId === userId) throw invalid('A person cannot be their own manager.');
    const m = await tx.one<{ status: string }>('select status from users where org_id = $1 and id = $2', [orgId, p.managerId]);
    if (!m) throw notFound('Manager');
    if (!['active', 'invited'].includes(m.status)) throw invalid('The manager must be an active or invited user.');
  }
  if (p.departmentId && !(await tx.one('select 1 from departments where org_id = $1 and id = $2 and archived_at is null', [orgId, p.departmentId]))) throw notFound('Department');
  if (p.teamId) {
    const t = await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2 and archived_at is null', [orgId, p.teamId]);
    if (!t) throw notFound('Team');
    if (p.departmentId && t.department_id !== p.departmentId) throw invalid('The team does not belong to that department.');
  }
}

export async function createUser(ctx: Ctx, input: unknown, opts: { invite?: boolean; status?: 'invited' | 'active' } = {}) {
  requirePerm(ctx, 'users.manage');
  const d = parse(createUserSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    if (await tx.one('select 1 from users where org_id = $1 and email = $2', [ctx.orgId, d.email])) throw conflict('A user with that email already exists.');
    let departmentId = d.departmentId ?? null;
    if (d.teamId && !departmentId) {
      departmentId = (await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2', [ctx.orgId, d.teamId]))?.department_id ?? null;
    }
    await checkPlacement(tx, ctx.orgId, null, { ...d, departmentId });
    const u = await tx.one<{ id: string }>(
      `insert into users (org_id, email, full_name, job_title, employee_number, status, manager_id, department_id, team_id, external_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [ctx.orgId, d.email, d.fullName, d.jobTitle ?? null, d.employeeNumber ?? null, opts.status ?? 'invited', d.managerId ?? null, departmentId, d.teamId ?? null, d.externalId ?? null]);
    const roles = [...new Set(['employee', ...(d.roles ?? [])])];
    for (const key of roles) {
      const role = await tx.one<{ permissions: string[] }>('select permissions from roles where org_id = $1 and key = $2', [ctx.orgId, key]);
      if (!role) throw notFound(`Role "${key}"`);
      if (key !== 'employee') {
        requirePerm(ctx, 'roles.manage');
        const missing = role.permissions.filter((p) => !ctx.perms.has(p) && !(MANAGERIAL_PERMISSIONS as string[]).includes(p));
        if (missing.length) throw forbidden('You cannot grant a role with permissions you do not hold.');
      }
      await grantRoleUnchecked(tx, ctx.orgId, u!.id, key, ctx.userId);
    }
    if (d.managerId) await ensureRole(tx, ctx, d.managerId, 'team_manager', 'assigned as manager');
    await audit(tx, ctx, { action: 'user.created', entityType: 'user', entityId: u!.id, after: { roles, managerId: d.managerId ?? null, departmentId, teamId: d.teamId ?? null, source: ctx.actorType } });
    if (opts.invite === false) return { id: u!.id, inviteToken: null, inviteUrl: null };
    const inviteToken = await issueCredentialToken(tx, ctx.orgId, u!.id, 'invite', ctx.userId === SYSTEM_ID ? null : ctx.userId);
    await sendInviteEmail(tx, ctx, { userId: u!.id, email: d.email, name: d.fullName, token: inviteToken });
    return { id: u!.id, inviteToken, inviteUrl: `${config().APP_URL}/accept-invite?token=${inviteToken}` };
  });
}

export async function updateUser(ctx: Ctx, userId: string, input: unknown) {
  parse(uuid, userId);
  const d = parse(updateUserSchema, input);
  const self = userId === ctx.userId;
  // Anyone may edit nothing about themselves except via profile; org structure changes need users.manage.
  requirePerm(ctx, 'users.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from users where org_id = $1 and id = $2 for update', [ctx.orgId, userId]);
    if (!cur) throw notFound('User');
    if (cur.status === 'anonymized') throw conflict('Anonymised users cannot be edited.');
    const next = {
      managerId: d.managerId === undefined ? cur.manager_id : d.managerId,
      departmentId: d.departmentId === undefined ? cur.department_id : d.departmentId,
      teamId: d.teamId === undefined ? cur.team_id : d.teamId,
    };
    if (d.teamId && d.departmentId === undefined) {
      next.departmentId = (await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2', [ctx.orgId, d.teamId]))?.department_id ?? null;
    }
    if (next.teamId && next.departmentId) {
      const t = await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2', [ctx.orgId, next.teamId]);
      if (t && t.department_id !== next.departmentId) next.teamId = null; // moving department clears an incompatible team
    }
    await checkPlacement(tx, ctx.orgId, userId, next);
    await tx.exec(
      `update users set full_name = $3, job_title = $4, employee_number = $5, manager_id = $6, department_id = $7, team_id = $8, external_id = $9 where org_id = $1 and id = $2`,
      [ctx.orgId, userId, d.fullName ?? cur.full_name, d.jobTitle === undefined ? cur.job_title : d.jobTitle,
       d.employeeNumber === undefined ? cur.employee_number : d.employeeNumber, next.managerId, next.departmentId, next.teamId,
       d.externalId === undefined ? cur.external_id : d.externalId]);
    const managerChanged = next.managerId !== cur.manager_id;
    if (managerChanged) {
      if (next.managerId) await ensureRole(tx, ctx, next.managerId, 'team_manager', 'assigned as manager');
      await reassignPendingApprovals(tx, ctx, userId, cur.manager_id, next.managerId);
    }
    await audit(tx, ctx, {
      action: managerChanged ? 'user.manager_changed' : 'user.updated', entityType: 'user', entityId: userId,
      before: { fullName: cur.full_name, jobTitle: cur.job_title, managerId: cur.manager_id, departmentId: cur.department_id, teamId: cur.team_id },
      after: { fullName: d.fullName ?? cur.full_name, jobTitle: d.jobTitle === undefined ? cur.job_title : d.jobTitle, ...next },
      metadata: self ? { self: true } : undefined,
    });
    return { ok: true };
  });
}

/** When someone's manager changes, approvals still waiting on the old manager move with the reporting line. */
async function reassignPendingApprovals(tx: Tx, ctx: Ctx, employeeId: string, oldManagerId: string | null, newManagerId: string | null) {
  if (!oldManagerId) return;
  const moved = await tx.query<{ id: string }>(
    `update approval_requests ar set approver_id = $4
       from goals g
      where ar.org_id = $1 and g.org_id = ar.org_id and g.id = ar.goal_id and g.owner_id = $2
        and ar.approver_id = $3 and ar.status in ('pending', 'waiting') and ar.decided_at is null
      returning ar.id`, [ctx.orgId, employeeId, oldManagerId, newManagerId]);
  if (moved.length) {
    await audit(tx, ctx, { action: 'approval.reassigned', entityType: 'user', entityId: employeeId, metadata: { requests: moved.length, from: oldManagerId, to: newManagerId } });
  }
}

export async function setUserStatus(ctx: Ctx, userId: string, status: 'active' | 'suspended' | 'deactivated') {
  requirePerm(ctx, 'users.manage');
  parse(uuid, userId);
  if (userId === ctx.userId && status !== 'active') throw forbidden('You cannot deactivate your own account.');
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from users where org_id = $1 and id = $2 for update', [ctx.orgId, userId]);
    if (!cur) throw notFound('User');
    if (cur.status === 'anonymized') throw conflict('Anonymised users cannot change status.');
    if (cur.status === status) return { status };
    if (status !== 'active') {
      const isAdmin = await tx.one(`select 1 from user_roles ur join roles r on r.org_id = ur.org_id and r.id = ur.role_id where ur.org_id = $1 and ur.user_id = $2 and r.key = 'org_admin'`, [ctx.orgId, userId]);
      if (isAdmin && (await activeOrgAdminCount(tx, ctx.orgId, userId)) === 0) throw conflict('You cannot remove the last organisation administrator.');
    }
    await tx.exec(`update users set status = $3, deactivated_at = case when $3 = 'active' then null else now() end where org_id = $1 and id = $2`, [ctx.orgId, userId, status]);
    if (status !== 'active') {
      await revokeUserSessions(tx, ctx.orgId, userId);
      // Hand open work to the departing person's manager so nothing is stranded.
      await tx.exec(`update approval_requests set approver_id = $3 where org_id = $1 and approver_id = $2 and status in ('pending','waiting')`, [ctx.orgId, userId, cur.manager_id]);
      await tx.exec(`update users set manager_id = $3 where org_id = $1 and manager_id = $2`, [ctx.orgId, userId, cur.manager_id]);
      await tx.exec(`update departments set head_user_id = null where org_id = $1 and head_user_id = $2`, [ctx.orgId, userId]);
      await tx.exec(`update teams set lead_user_id = null where org_id = $1 and lead_user_id = $2`, [ctx.orgId, userId]);
      if (cur.manager_id) {
        await notify(tx, ctx, {
          userId: cur.manager_id, category: 'org', type: 'user.deactivated', title: `${cur.full_name} is no longer active`,
          body: `Their direct reports and pending approvals have been moved to you.`, link: '/app/team',
          entityType: 'user', entityId: userId, dedupeKey: `deactivated:${userId}:${Date.now()}`,
        });
      }
    }
    await audit(tx, ctx, { action: `user.${status === 'active' ? 'reactivated' : status}`, entityType: 'user', entityId: userId, before: { status: cur.status }, after: { status } });
    return { status };
  });
}

/** Privacy erasure: removes personal data but keeps goals/audit history intact (they reference ids, not names). */
export async function anonymizeUser(ctx: Ctx, userId: string) {
  requirePerm(ctx, 'users.anonymize');
  parse(uuid, userId);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from users where org_id = $1 and id = $2 for update', [ctx.orgId, userId]);
    if (!cur) throw notFound('User');
    if (cur.status !== 'deactivated') throw conflict('Only deactivated users can be anonymised. Deactivate the user first.');
    await tx.exec(
      `update users set email = $3, full_name = 'Former employee', job_title = null, employee_number = null, external_id = null,
         oidc_subject = null, password_hash = null, status = 'anonymized' where org_id = $1 and id = $2`,
      [ctx.orgId, userId, `anonymized+${userId}@invalid.local`]);
    await tx.exec('delete from notifications where org_id = $1 and user_id = $2', [ctx.orgId, userId]);
    await tx.exec('delete from notification_preferences where org_id = $1 and user_id = $2', [ctx.orgId, userId]);
    await tx.exec(`update notification_deliveries set payload = '{}'::jsonb, status = 'skipped' where org_id = $1 and user_id = $2`, [ctx.orgId, userId]);
    await tx.exec('delete from credential_tokens where org_id = $1 and user_id = $2', [ctx.orgId, userId]);
    await revokeUserSessions(tx, ctx.orgId, userId);
    await audit(tx, ctx, { action: 'user.anonymized', entityType: 'user', entityId: userId });
    return { ok: true };
  });
}

export async function resetUserPassword(ctx: Ctx, userId: string) {
  requirePerm(ctx, 'users.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const u = await tx.one<any>('select id, email, full_name, status from users where org_id = $1 and id = $2', [ctx.orgId, userId]);
    if (!u) throw notFound('User');
    if (!['active', 'invited'].includes(u.status)) throw conflict('That account is not active.');
    const token = await issueCredentialToken(tx, ctx.orgId, userId, u.status === 'invited' ? 'invite' : 'reset', ctx.userId);
    await audit(tx, ctx, { action: 'user.reset_issued', entityType: 'user', entityId: userId });
    await sendInviteEmail(tx, ctx, { userId, email: u.email, name: u.full_name, token, reset: u.status !== 'invited' });
    return { token, url: `${config().APP_URL}/accept-invite?token=${token}` };
  });
}

export interface UserFilters { q?: string; status?: string; departmentId?: string; teamId?: string; managerId?: string; }

export async function listUsers(ctx: Ctx, f: UserFilters & { limit?: number; offset?: number }): Promise<Page<any>> {
  const { limit, offset } = parse(pageParams, { limit: f.limit, offset: f.offset });
  const full = can(ctx, 'users.read') || can(ctx, 'users.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const params: unknown[] = [ctx.orgId];
    const w: string[] = ['u.org_id = $1'];
    if (!full) w.push(`u.status = 'active'`);
    if (f.status && full) { params.push(f.status); w.push(`u.status = $${params.length}`); }
    if (f.departmentId) { params.push(f.departmentId); w.push(`u.department_id = $${params.length}`); }
    if (f.teamId) { params.push(f.teamId); w.push(`u.team_id = $${params.length}`); }
    if (f.managerId) { params.push(f.managerId); w.push(`u.manager_id = $${params.length}`); }
    if (f.q) { params.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`); w.push(`(u.full_name ilike $${params.length} or ${full ? `u.email ilike $${params.length}` : 'false'})`); }
    const where = w.join(' and ');
    const total = (await tx.one<{ n: number }>(`select count(*)::int as n from users u where ${where}`, params))!.n;
    const rows = await tx.query(
      `select ${PUBLIC_FIELDS} ${full ? ', u.email, u.employee_number, u.last_login_at, u.external_id is not null as scim_managed, (select array_agg(r.key order by r.key) from user_roles ur join roles r on r.org_id = ur.org_id and r.id = ur.role_id where ur.org_id = u.org_id and ur.user_id = u.id) as roles' : ''}
       from users u
       left join departments d on d.org_id = u.org_id and d.id = u.department_id
       left join teams t on t.org_id = u.org_id and t.id = u.team_id
       left join users m on m.org_id = u.org_id and m.id = u.manager_id
       where ${where} order by u.full_name limit ${limit} offset ${offset}`, params);
    return { data: rows, page: { limit, offset, total } };
  });
}

export async function getUser(ctx: Ctx, userId: string) {
  parse(uuid, userId);
  const full = can(ctx, 'users.read') || can(ctx, 'users.manage') || userId === ctx.userId;
  return withOrg(ctx.orgId, async (tx) => {
    const u = await tx.one<any>(
      `select ${PUBLIC_FIELDS} ${full ? ', u.email, u.employee_number, u.last_login_at, u.created_at' : ''}
       from users u left join departments d on d.org_id = u.org_id and d.id = u.department_id
       left join teams t on t.org_id = u.org_id and t.id = u.team_id left join users m on m.org_id = u.org_id and m.id = u.manager_id
       where u.org_id = $1 and u.id = $2`, [ctx.orgId, userId]);
    if (!u) throw notFound('User');
    return u;
  });
}

/** Direct + indirect reports of the caller with their workload. */
export async function myTeam(ctx: Ctx) {
  return withOrg(ctx.orgId, async (tx) => tx.query(
    `with direct as (select id from users where org_id = $1 and manager_id = $2)
     select u.id, u.full_name, u.job_title, u.status, (u.manager_id = $2) as direct_report,
       (select count(*)::int from goals g where g.org_id = u.org_id and g.owner_id = u.id and g.status = 'active' and g.deleted_at is null) as active_goals,
       (select count(*)::int from goals g where g.org_id = u.org_id and g.owner_id = u.id and g.status = 'pending_approval' and g.deleted_at is null) as pending_goals,
       (select count(*)::int from goals g where g.org_id = u.org_id and g.owner_id = u.id and g.status in ('draft','changes_requested') and g.deleted_at is null) as draft_goals
     from users u where u.org_id = $1 and u.status = 'active' and u.id in (select reporting_subtree($1, $2)) order by direct_report desc, u.full_name`,
    [ctx.orgId, ctx.userId]));
}

export async function updateMyProfile(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ fullName: z.string().trim().min(1).max(120).optional(), jobTitle: z.string().trim().max(120).nullable().optional() }).strict(), input);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select full_name, job_title from users where org_id = $1 and id = $2', [ctx.orgId, ctx.userId]);
    await tx.exec('update users set full_name = $3, job_title = $4 where org_id = $1 and id = $2',
      [ctx.orgId, ctx.userId, d.fullName ?? cur.full_name, d.jobTitle === undefined ? cur.job_title : d.jobTitle]);
    await audit(tx, ctx, { action: 'user.profile_updated', entityType: 'user', entityId: ctx.userId, before: { fullName: cur.full_name, jobTitle: cur.job_title }, after: d });
    return { ok: true };
  });
}
