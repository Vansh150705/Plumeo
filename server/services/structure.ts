import { z } from 'zod';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm } from '../core/context';
import { conflict, invalid, notFound } from '../core/errors';
import { parse, uuid } from '../core/validation';
import { audit } from './audit';
import { ensureRole } from './rbac';

const deptSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['business_unit', 'department']).default('department'),
  parentId: uuid.nullable().optional(),
  headUserId: uuid.nullable().optional(),
}).strict();

const teamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  departmentId: uuid,
  parentTeamId: uuid.nullable().optional(),
  leadUserId: uuid.nullable().optional(),
}).strict();

export async function listStructure(ctx: Ctx) {
  return withOrg(ctx.orgId, async (tx) => {
    const departments = await tx.query(
      `select d.id, d.name, d.kind, d.parent_id, d.head_user_id, h.full_name as head_name, d.archived_at,
         (select count(*)::int from users u where u.org_id = d.org_id and u.department_id = d.id and u.status = 'active') as member_count
       from departments d left join users h on h.org_id = d.org_id and h.id = d.head_user_id
       where d.org_id = $1 and d.archived_at is null order by d.name`, [ctx.orgId]);
    const teams = await tx.query(
      `select t.id, t.name, t.department_id, t.parent_team_id, t.lead_user_id, l.full_name as lead_name,
         (select count(*)::int from users u where u.org_id = t.org_id and u.team_id = t.id and u.status = 'active') as member_count
       from teams t left join users l on l.org_id = t.org_id and l.id = t.lead_user_id
       where t.org_id = $1 and t.archived_at is null order by t.name`, [ctx.orgId]);
    return { departments, teams };
  });
}

async function activeUser(tx: any, orgId: string, id: string, label: string) {
  const u = await tx.one('select status from users where org_id = $1 and id = $2', [orgId, id]);
  if (!u) throw notFound(label);
  if (u.status !== 'active') throw invalid(`${label} must be an active user.`);
}

export async function createDepartment(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'structure.manage');
  const d = parse(deptSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    if (d.headUserId) await activeUser(tx, ctx.orgId, d.headUserId, 'Department head');
    let row;
    try {
      row = await tx.one<{ id: string }>(`insert into departments (org_id, name, kind, parent_id, head_user_id) values ($1,$2,$3,$4,$5) returning id`,
        [ctx.orgId, d.name, d.kind, d.parentId ?? null, d.headUserId ?? null]);
    } catch (e: any) {
      if (e.code === '23505') throw conflict('A department with that name already exists at this level.');
      if (e.code === '23503') throw notFound('Parent department');
      throw e;
    }
    if (d.headUserId) await ensureRole(tx, ctx, d.headUserId, 'department_head', 'appointed department head');
    await audit(tx, ctx, { action: 'department.created', entityType: 'department', entityId: row!.id, after: d });
    return { id: row!.id };
  });
}

export async function updateDepartment(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'structure.manage');
  parse(uuid, id);
  const d = parse(deptSchema.partial(), input);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from departments where org_id = $1 and id = $2 and archived_at is null for update', [ctx.orgId, id]);
    if (!cur) throw notFound('Department');
    if (d.headUserId) await activeUser(tx, ctx.orgId, d.headUserId, 'Department head');
    const next = {
      name: d.name ?? cur.name, kind: d.kind ?? cur.kind,
      parent_id: d.parentId === undefined ? cur.parent_id : d.parentId,
      head_user_id: d.headUserId === undefined ? cur.head_user_id : d.headUserId,
    };
    try {
      await tx.exec('update departments set name = $3, kind = $4, parent_id = $5, head_user_id = $6 where org_id = $1 and id = $2',
        [ctx.orgId, id, next.name, next.kind, next.parent_id, next.head_user_id]);
    } catch (e: any) {
      if (e.code === '23514') throw invalid('That change would create a loop in the department hierarchy.');
      if (e.code === '23505') throw conflict('A department with that name already exists at this level.');
      throw e;
    }
    if (next.head_user_id && next.head_user_id !== cur.head_user_id) await ensureRole(tx, ctx, next.head_user_id, 'department_head', 'appointed department head');
    await audit(tx, ctx, { action: 'department.updated', entityType: 'department', entityId: id,
      before: { name: cur.name, parent_id: cur.parent_id, head_user_id: cur.head_user_id }, after: next });
    return { ok: true };
  });
}

export async function archiveDepartment(ctx: Ctx, id: string) {
  requirePerm(ctx, 'structure.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from departments where org_id = $1 and id = $2 and archived_at is null for update', [ctx.orgId, id]);
    if (!cur) throw notFound('Department');
    const blockers = await tx.one<{ u: number; c: number; t: number }>(
      `select (select count(*)::int from users where org_id = $1 and department_id = $2 and status = 'active') as u,
              (select count(*)::int from departments where org_id = $1 and parent_id = $2 and archived_at is null) as c,
              (select count(*)::int from teams where org_id = $1 and department_id = $2 and archived_at is null) as t`, [ctx.orgId, id]);
    if (blockers!.u || blockers!.c || blockers!.t) throw conflict('Move or archive the department\'s people, teams and sub-departments first.', blockers);
    await tx.exec('update departments set archived_at = now() where org_id = $1 and id = $2', [ctx.orgId, id]);
    await audit(tx, ctx, { action: 'department.archived', entityType: 'department', entityId: id, before: { name: cur.name } });
    return { ok: true };
  });
}

export async function createTeam(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'structure.manage');
  const d = parse(teamSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    if (d.leadUserId) await activeUser(tx, ctx.orgId, d.leadUserId, 'Team lead');
    if (d.parentTeamId) {
      const p = await tx.one<{ department_id: string }>('select department_id from teams where org_id = $1 and id = $2 and archived_at is null', [ctx.orgId, d.parentTeamId]);
      if (!p) throw notFound('Parent team');
    }
    let row;
    try {
      row = await tx.one<{ id: string }>(`insert into teams (org_id, name, department_id, parent_team_id, lead_user_id) values ($1,$2,$3,$4,$5) returning id`,
        [ctx.orgId, d.name, d.departmentId, d.parentTeamId ?? null, d.leadUserId ?? null]);
    } catch (e: any) {
      if (e.code === '23505') throw conflict('A team with that name already exists in this department.');
      if (e.code === '23503') throw notFound('Department');
      throw e;
    }
    if (d.leadUserId) await ensureRole(tx, ctx, d.leadUserId, 'team_manager', 'appointed team lead');
    await audit(tx, ctx, { action: 'team.created', entityType: 'team', entityId: row!.id, after: d });
    return { id: row!.id };
  });
}

export async function updateTeam(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'structure.manage');
  const d = parse(teamSchema.partial(), input);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from teams where org_id = $1 and id = $2 and archived_at is null for update', [ctx.orgId, id]);
    if (!cur) throw notFound('Team');
    if (d.leadUserId) await activeUser(tx, ctx.orgId, d.leadUserId, 'Team lead');
    const next = {
      name: d.name ?? cur.name, department_id: d.departmentId ?? cur.department_id,
      parent_team_id: d.parentTeamId === undefined ? cur.parent_team_id : d.parentTeamId,
      lead_user_id: d.leadUserId === undefined ? cur.lead_user_id : d.leadUserId,
    };
    try {
      await tx.exec('update teams set name = $3, department_id = $4, parent_team_id = $5, lead_user_id = $6 where org_id = $1 and id = $2',
        [ctx.orgId, id, next.name, next.department_id, next.parent_team_id, next.lead_user_id]);
    } catch (e: any) {
      if (e.code === '23514') throw invalid('That change would create a loop in the team hierarchy.');
      if (e.code === '23505') throw conflict('A team with that name already exists in this department.');
      throw e;
    }
    if (next.lead_user_id && next.lead_user_id !== cur.lead_user_id) await ensureRole(tx, ctx, next.lead_user_id, 'team_manager', 'appointed team lead');
    await audit(tx, ctx, { action: 'team.updated', entityType: 'team', entityId: id,
      before: { name: cur.name, department_id: cur.department_id, lead_user_id: cur.lead_user_id }, after: next });
    return { ok: true };
  });
}

export async function archiveTeam(ctx: Ctx, id: string) {
  requirePerm(ctx, 'structure.manage');
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from teams where org_id = $1 and id = $2 and archived_at is null for update', [ctx.orgId, id]);
    if (!cur) throw notFound('Team');
    const u = await tx.one<{ n: number }>(`select count(*)::int as n from users where org_id = $1 and team_id = $2 and status = 'active'`, [ctx.orgId, id]);
    const c = await tx.one<{ n: number }>(`select count(*)::int as n from teams where org_id = $1 and parent_team_id = $2 and archived_at is null`, [ctx.orgId, id]);
    if (u!.n || c!.n) throw conflict('Move the team\'s people and sub-teams first.');
    await tx.exec('update teams set archived_at = now() where org_id = $1 and id = $2', [ctx.orgId, id]);
    await audit(tx, ctx, { action: 'team.archived', entityType: 'team', entityId: id, before: { name: cur.name } });
    return { ok: true };
  });
}
