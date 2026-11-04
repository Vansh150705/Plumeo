import { withOrg, withSystem } from '../db/pool';
import { AppError, conflict, notFound } from '../core/errors';
import { config } from '../core/config';
import { sha256 } from '../core/crypto';
import type { Ctx } from '../core/context';
import { createUser, setUserStatus, updateUser } from './users';
import { rateLimit } from '../auth/ratelimit';

/** SCIM 2.0 (RFC 7643/7644) user provisioning: Users resource only (Groups are not implemented). */
export const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

export class ScimError extends Error {
  constructor(readonly status: number, message: string, readonly scimType?: string) { super(message); }
}

const ZERO = '00000000-0000-0000-0000-000000000000';

export async function authenticateScim(authHeader: string | null, requestId: string, ip?: string): Promise<Ctx> {
  const token = authHeader?.match(/^Bearer\s+(plm_scim_[A-Za-z0-9_-]{20,})$/)?.[1];
  await rateLimit('scim', token ? sha256(token) : (ip ?? 'unknown'), 600, 60).catch(() => { throw new ScimError(429, 'Too many requests'); });
  if (!token) throw new ScimError(401, 'Missing or malformed bearer token');
  const row = await withSystem(async (tx) => {
    const t = await tx.one<{ id: string; org_id: string; status: string }>(
      `select t.id, t.org_id, o.status from scim_tokens t join orgs o on o.id = t.org_id where t.token_hash = $1 and t.revoked_at is null`, [sha256(token)]);
    if (t && t.status === 'active') await tx.exec('update scim_tokens set last_used_at = now() where id = $1', [t.id]);
    return t;
  });
  if (!row || row.status !== 'active') throw new ScimError(401, 'Invalid token');
  return { orgId: row.org_id, userId: ZERO, userName: 'SCIM', perms: new Set(['users.manage']), roleKeys: [], requestId, actorType: 'scim', ip };
}

const base = () => `${config().APP_URL}/api/scim/v2`;

function toResource(u: any) {
  const [given, ...rest] = String(u.full_name).split(' ');
  return {
    schemas: [SCIM_USER, SCIM_ENTERPRISE],
    id: u.id,
    ...(u.external_id ? { externalId: u.external_id } : {}),
    userName: u.email,
    name: { formatted: u.full_name, givenName: given, familyName: rest.join(' ') },
    displayName: u.full_name,
    title: u.job_title ?? undefined,
    emails: [{ value: u.email, primary: true }],
    active: u.status === 'active' || u.status === 'invited',
    [SCIM_ENTERPRISE]: {
      ...(u.employee_number ? { employeeNumber: u.employee_number } : {}),
      ...(u.department_name ? { department: u.department_name } : {}),
      ...(u.manager_id ? { manager: { value: u.manager_id } } : {}),
    },
    meta: { resourceType: 'User', created: u.created_at, lastModified: u.updated_at, location: `${base()}/Users/${u.id}` },
  };
}

const SELECT = `select u.id, u.email, u.full_name, u.job_title, u.employee_number, u.status, u.manager_id, u.external_id, u.created_at, u.updated_at, d.name as department_name
  from users u left join departments d on d.org_id = u.org_id and d.id = u.department_id`;

export async function scimListUsers(ctx: Ctx, q: { filter?: string; startIndex?: number; count?: number }) {
  const start = Math.max(1, q.startIndex ?? 1);
  const count = Math.min(Math.max(q.count ?? 100, 0), 200);
  const w = ['u.org_id = $1', `u.status <> 'anonymized'`];
  const params: unknown[] = [ctx.orgId];
  if (q.filter) {
    const m = q.filter.match(/^\s*(userName|externalId|id)\s+eq\s+"([^"]{1,300})"\s*$/i);
    if (!m) throw new ScimError(400, 'Only filters of the form `attribute eq "value"` on userName, externalId or id are supported', 'invalidFilter');
    const col = { username: 'u.email', externalid: 'u.external_id', id: 'u.id::text' }[m[1].toLowerCase()]!;
    params.push(m[1].toLowerCase() === 'username' ? m[2].toLowerCase() : m[2]);
    w.push(`${col} = $${params.length}`);
  }
  return withOrg(ctx.orgId, async (tx) => {
    const total = (await tx.one<{ n: number }>(`select count(*)::int as n from users u where ${w.join(' and ')}`, params))!.n;
    const rows = await tx.query(`${SELECT} where ${w.join(' and ')} order by u.created_at, u.id limit ${count} offset ${start - 1}`, params);
    return { schemas: [SCIM_LIST], totalResults: total, startIndex: start, itemsPerPage: rows.length, Resources: rows.map(toResource) };
  });
}

export async function scimGetUser(ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ScimError(404, 'User not found');
  return withOrg(ctx.orgId, async (tx) => {
    const u = await tx.one(`${SELECT} where u.org_id = $1 and u.id = $2`, [ctx.orgId, id]);
    if (!u) throw new ScimError(404, 'User not found');
    return toResource(u);
  });
}

function parseBody(b: any) {
  const email = String(b.userName ?? b.emails?.find((e: any) => e.primary)?.value ?? b.emails?.[0]?.value ?? '').trim().toLowerCase();
  const name = String(b.displayName ?? b.name?.formatted ?? [b.name?.givenName, b.name?.familyName].filter(Boolean).join(' ')).trim();
  const ext = b[SCIM_ENTERPRISE] ?? {};
  return {
    email, name, title: b.title as string | undefined, externalId: b.externalId as string | undefined,
    employeeNumber: ext.employeeNumber as string | undefined, department: ext.department as string | undefined,
    managerId: (ext.manager?.value ?? undefined) as string | undefined,
    active: parseBool(b.active),
  };
}
const parseBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : undefined);

async function departmentIdByName(ctx: Ctx, name?: string) {
  if (!name) return undefined;
  return withOrg(ctx.orgId, async (tx) => (await tx.one<{ id: string }>('select id from departments where org_id = $1 and lower(name) = lower($2) and archived_at is null limit 1', [ctx.orgId, name]))?.id);
}

function mapErr(e: unknown): never {
  if (e instanceof AppError) {
    if (e.code === 'conflict') throw new ScimError(409, e.message, 'uniqueness');
    if (e.code === 'not_found') throw new ScimError(404, e.message);
    throw new ScimError(e.status === 422 ? 400 : e.status, e.message, e.code === 'validation_failed' ? 'invalidValue' : undefined);
  }
  throw e;
}

export async function scimCreateUser(ctx: Ctx, body: any) {
  const p = parseBody(body);
  if (!p.email || !p.name) throw new ScimError(400, 'userName and a name are required', 'invalidValue');
  try {
    const departmentId = await departmentIdByName(ctx, p.department);
    const r = await createUser(ctx, {
      email: p.email, fullName: p.name, jobTitle: p.title, employeeNumber: p.employeeNumber, externalId: p.externalId,
      managerId: p.managerId ?? null, departmentId: departmentId ?? null,
    }, { invite: false });
    if (p.active === false) await setUserStatus(ctx, r.id, 'deactivated');
    return scimGetUser(ctx, r.id);
  } catch (e) { return mapErr(e); }
}

async function applyUpdate(ctx: Ctx, id: string, p: ReturnType<typeof parseBody>, partial: boolean) {
  try {
    const departmentId = await departmentIdByName(ctx, p.department);
    const patch: Record<string, unknown> = {};
    if (p.name) patch.fullName = p.name;
    if (p.title !== undefined) patch.jobTitle = p.title;
    if (p.employeeNumber !== undefined) patch.employeeNumber = p.employeeNumber;
    if (p.externalId !== undefined) patch.externalId = p.externalId;
    if (p.managerId !== undefined || !partial) patch.managerId = p.managerId ?? null;
    if (departmentId !== undefined) patch.departmentId = departmentId;
    if (Object.keys(patch).length) await updateUser(ctx, id, patch);
    if (p.active !== undefined) await setUserStatus(ctx, id, p.active ? 'active' : 'deactivated');
  } catch (e) { mapErr(e); }
}

export async function scimReplaceUser(ctx: Ctx, id: string, body: any) {
  await scimGetUser(ctx, id);
  await applyUpdate(ctx, id, parseBody(body), false);
  return scimGetUser(ctx, id);
}

export async function scimPatchUser(ctx: Ctx, id: string, body: any) {
  await scimGetUser(ctx, id);
  const ops: any[] = body?.Operations ?? [];
  if (!Array.isArray(ops) || ops.length === 0) throw new ScimError(400, 'Operations are required', 'invalidSyntax');
  const merged: Record<string, any> = {};
  for (const op of ops) {
    const kind = String(op.op ?? '').toLowerCase();
    if (!['add', 'replace', 'remove'].includes(kind)) throw new ScimError(400, `Unsupported op "${op.op}"`, 'invalidSyntax');
    if (!op.path) { if (op.value && typeof op.value === 'object') Object.assign(merged, op.value); continue; }
    const path = String(op.path);
    const val = kind === 'remove' ? undefined : op.value;
    if (path === 'active') merged.active = val;
    else if (path === 'userName') merged.userName = val;
    else if (path === 'displayName') merged.displayName = val;
    else if (path === 'name.givenName' || path === 'name.familyName' || path === 'name.formatted') merged.name = { ...(merged.name ?? {}), [path.split('.')[1]]: val };
    else if (path === 'title') merged.title = val;
    else if (path === 'externalId') merged.externalId = val;
    else if (path === `${SCIM_ENTERPRISE}:employeeNumber`) merged[SCIM_ENTERPRISE] = { ...(merged[SCIM_ENTERPRISE] ?? {}), employeeNumber: val };
    else if (path === `${SCIM_ENTERPRISE}:department`) merged[SCIM_ENTERPRISE] = { ...(merged[SCIM_ENTERPRISE] ?? {}), department: val };
    else if (path === `${SCIM_ENTERPRISE}:manager`) merged[SCIM_ENTERPRISE] = { ...(merged[SCIM_ENTERPRISE] ?? {}), manager: { value: typeof val === 'object' ? val?.value : val } };
    else throw new ScimError(400, `Unsupported path "${path}"`, 'noTarget');
  }
  const p = parseBody(merged);
  if (p.email) throw new ScimError(400, 'userName cannot be changed', 'mutability');
  await applyUpdate(ctx, id, p, true);
  return scimGetUser(ctx, id);
}

export async function scimDeleteUser(ctx: Ctx, id: string) {
  await scimGetUser(ctx, id);
  try { await setUserStatus(ctx, id, 'deactivated'); } catch (e) { mapErr(e); }
}

export const scimServiceProviderConfig = () => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
  authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'Per-organisation SCIM token created in Plumeo admin settings', primary: true }],
});

export { conflict, notFound };
