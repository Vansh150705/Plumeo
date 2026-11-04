import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm } from '../core/context';
import { redact } from '../core/logger';

export interface AuditInput {
  action: string;              // e.g. goal.approved
  entityType: string;          // goal | user | role | policy | ...
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit event INSIDE the caller's transaction, so a state change and its
 * audit record commit or roll back together. Hash-chain bookkeeping is done by a
 * database trigger. Secrets are scrubbed before storage.
 */
export async function audit(tx: Tx, ctx: Ctx, e: AuditInput) {
  await tx.exec(
    `insert into audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, request_id, before_data, after_data, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.orgId,
      ctx.actorType === 'system' || ctx.actorType === 'scim' ? null : ctx.userId,
      ctx.actorType,
      e.action,
      e.entityType,
      e.entityId ?? null,
      ctx.requestId,
      e.before === undefined ? null : JSON.stringify(redact(e.before)),
      e.after === undefined ? null : JSON.stringify(redact(e.after)),
      JSON.stringify({ ...(redact(e.metadata ?? {}) as object), ...(ctx.ip ? { ip: ctx.ip } : {}) }),
    ],
  );
}

export interface AuditFilters {
  q?: string; action?: string; entityType?: string; entityId?: string; actorId?: string;
  from?: string; to?: string; limit?: number; beforeSeq?: number;
}

function where(f: AuditFilters, params: unknown[]) {
  const c: string[] = ['a.org_id = $1'];
  if (f.action) { params.push(f.action.endsWith('*') ? f.action.slice(0, -1) + '%' : f.action); c.push(`a.action ${f.action.endsWith('*') ? 'like' : '='} $${params.length}`); }
  if (f.entityType) { params.push(f.entityType); c.push(`a.entity_type = $${params.length}`); }
  if (f.entityId) { params.push(f.entityId); c.push(`a.entity_id = $${params.length}`); }
  if (f.actorId) { params.push(f.actorId); c.push(`a.actor_id = $${params.length}`); }
  if (f.from) { params.push(f.from); c.push(`a.occurred_at >= $${params.length}::timestamptz`); }
  if (f.to) { params.push(f.to); c.push(`a.occurred_at < ($${params.length}::date + 1)`); }
  if (f.beforeSeq) { params.push(f.beforeSeq); c.push(`a.seq < $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    c.push(`(a.action ilike $${n} or a.entity_type ilike $${n} or u.full_name ilike $${n} or a.after_data::text ilike $${n})`);
  }
  return c.join(' and ');
}

const SELECT = `select a.seq, a.id, a.occurred_at, a.actor_id, a.actor_type,
  coalesce(u.full_name, case a.actor_type when 'system' then 'System' when 'scim' then 'SCIM provisioning' else null end) as actor_name,
  a.action, a.entity_type, a.entity_id, a.request_id, a.before_data, a.after_data, a.metadata, a.hash
  from audit_events a left join users u on u.org_id = a.org_id and u.id = a.actor_id`;

/** Keyset-paginated audit search (newest first). `nextBeforeSeq` continues the listing. */
export async function searchAudit(ctx: Ctx, f: AuditFilters) {
  requirePerm(ctx, 'audit.read');
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  return withOrg(ctx.orgId, async (tx) => {
    const params: unknown[] = [ctx.orgId];
    const w = where(f, params);
    const rows = await tx.query(`${SELECT} where ${w} order by a.seq desc limit ${limit + 1}`, params);
    const more = rows.length > limit;
    const data = more ? rows.slice(0, limit) : rows;
    return { data, nextBeforeSeq: more ? (data[data.length - 1].seq as number) : null };
  });
}

/** History of one entity, for features that have already authorised access to that entity. */
export async function entityHistory(tx: Tx, orgId: string, entityType: string, entityId: string, limit = 100) {
  return tx.query(`${SELECT} where a.org_id = $1 and a.entity_type = $2 and a.entity_id = $3 order by a.seq desc limit ${limit}`,
    [orgId, entityType, entityId]);
}

export async function verifyAuditChain(ctx: Ctx) {
  requirePerm(ctx, 'audit.read');
  return withOrg(ctx.orgId, async (tx) => {
    const r = await tx.one<{ checked: string; broken_seq: string | null; head_ok: boolean }>(
      'select * from verify_audit_chain($1)', [ctx.orgId]);
    return {
      intact: r!.broken_seq == null && r!.head_ok,
      eventsChecked: Number(r!.checked),
      firstBrokenSeq: r!.broken_seq == null ? null : Number(r!.broken_seq),
    };
  });
}

export async function auditExportRows(ctx: Ctx, f: AuditFilters) {
  requirePerm(ctx, 'audit.export');
  return withOrg(ctx.orgId, async (tx) => {
    const params: unknown[] = [ctx.orgId];
    const w = where(f, params);
    const rows = await tx.query(`${SELECT} where ${w} order by a.seq desc limit 50000`, params);
    await audit(tx, ctx, { action: 'audit.exported', entityType: 'audit', metadata: { filters: f, rows: rows.length } });
    return rows;
  });
}
