import { z } from 'zod';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm } from '../core/context';
import { notFound } from '../core/errors';
import { parse, uuid } from '../core/validation';
import { audit } from './audit';
import { getVisibleGoal } from './goal-access';
import { keyResultInput } from './goals';

const contentSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  expectedOutcome: z.string().trim().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  keyResults: z.array(keyResultInput.omit({ id: true })).max(10).optional(),
}).strict();

const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  level: z.enum(['company', 'department', 'team', 'individual']),
  departmentId: uuid.nullable().optional(),
  content: contentSchema,
}).strict();

export async function listTemplates(ctx: Ctx, f: { level?: string; departmentId?: string } = {}) {
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select t.id, t.name, t.description, t.level, t.department_id, d.name as department_name, t.content, t.usage_count, t.created_at
     from goal_templates t left join departments d on d.org_id = t.org_id and d.id = t.department_id
     where t.org_id = $1 and t.archived_at is null and ($2::text is null or t.level = $2) and ($3::uuid is null or t.department_id = $3 or t.department_id is null)
     order by t.usage_count desc, t.name`, [ctx.orgId, f.level ?? null, f.departmentId ?? null]));
}

export async function createTemplate(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'templates.manage');
  const d = parse(templateSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const row = await tx.one<{ id: string }>(
      `insert into goal_templates (org_id, name, description, level, department_id, content, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [ctx.orgId, d.name, d.description ?? null, d.level, d.departmentId ?? null, JSON.stringify(d.content), ctx.userId]);
    await audit(tx, ctx, { action: 'template.created', entityType: 'template', entityId: row!.id, after: { name: d.name, level: d.level } });
    return { id: row!.id };
  });
}

/** Captures the structure of an existing (visible) goal as a reusable template. */
export async function createTemplateFromGoal(ctx: Ctx, goalId: string, name: string) {
  requirePerm(ctx, 'templates.manage');
  parse(uuid, goalId);
  const n = parse(z.string().trim().min(2).max(120), name);
  return withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId);
    const krs = await tx.query<any>(`select title, metric_type, direction, unit, start_value, target_value, weight from key_results where org_id = $1 and goal_id = $2 and removed_at is null order by position`, [ctx.orgId, goalId]);
    const content = {
      title: g.title, description: g.description ?? undefined, expectedOutcome: g.expected_outcome ?? undefined, priority: g.priority,
      keyResults: krs.map((k) => ({ title: k.title, metricType: k.metric_type, direction: k.direction, unit: k.unit, startValue: k.start_value, targetValue: k.target_value, weight: k.weight })),
    };
    const row = await tx.one<{ id: string }>(
      `insert into goal_templates (org_id, name, level, department_id, content, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [ctx.orgId, n, g.level, g.level === 'department' ? g.department_id : null, JSON.stringify(content), ctx.userId]);
    await audit(tx, ctx, { action: 'template.created', entityType: 'template', entityId: row!.id, after: { name: n, fromGoal: goalId } });
    return { id: row!.id };
  });
}

export async function archiveTemplate(ctx: Ctx, id: string) {
  requirePerm(ctx, 'templates.manage');
  parse(uuid, id);
  return withOrg(ctx.orgId, async (tx) => {
    const n = await tx.exec('update goal_templates set archived_at = now() where org_id = $1 and id = $2 and archived_at is null', [ctx.orgId, id]);
    if (!n) throw notFound('Template');
    await audit(tx, ctx, { action: 'template.archived', entityType: 'template', entityId: id });
    return { ok: true };
  });
}
