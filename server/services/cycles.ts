import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm } from '../core/context';
import { conflict, invalid, notFound } from '../core/errors';
import { isoDate, parse, uuid } from '../core/validation';
import { audit } from './audit';

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10);
};

const periodInput = z.object({
  name: z.string().trim().min(1).max(60),
  startsOn: isoDate, endsOn: isoDate, opensOn: isoDate, dueOn: isoDate,
}).strict();

export const cycleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  startsOn: isoDate,
  endsOn: isoDate,
  goalSettingOpensOn: isoDate.optional(),
  goalSettingClosesOn: isoDate.optional(),
  cadence: z.enum(['quarterly', 'custom']).default('quarterly'),
  periods: z.array(periodInput).max(24).optional(),            // required for 'custom'
  openDaysBeforeEnd: z.number().int().min(0).max(60).default(14),
  dueDaysAfterEnd: z.number().int().min(0).max(60).default(14),
  activate: z.boolean().default(false),
}).strict();

/** Splits a cycle into consecutive 3-month review periods (last period absorbs the remainder). */
export function quarterlyPeriods(startsOn: string, endsOn: string, openDays: number, dueDays: number) {
  const out: z.infer<typeof periodInput>[] = [];
  let s = startsOn; let i = 1;
  while (s <= endsOn && i <= 12) {
    let e = addDays(addMonths(s, 3), -1);
    if (e >= endsOn || addDays(e, 1) > endsOn) e = endsOn;
    const opens = addDays(e, -openDays) < s ? s : addDays(e, -openDays);
    out.push({ name: `Q${i}`, startsOn: s, endsOn: e, opensOn: opens, dueOn: addDays(e, dueDays) });
    if (e >= endsOn) break;
    s = addDays(e, 1); i++;
  }
  return out;
}

export async function createCycleInTx(tx: Tx, ctx: Ctx, input: unknown) {
  const d = parse(cycleSchema, input);
  if (d.startsOn > d.endsOn) throw invalid('The cycle must end after it starts.');
  if (d.goalSettingOpensOn && d.goalSettingClosesOn && d.goalSettingOpensOn > d.goalSettingClosesOn) throw invalid('Goal setting must close after it opens.');
  let periods = d.periods;
  if (d.cadence === 'custom') {
    if (!periods?.length) throw invalid('Custom cadence needs at least one review period.');
  } else {
    periods = quarterlyPeriods(d.startsOn, d.endsOn, d.openDaysBeforeEnd, d.dueDaysAfterEnd);
  }
  for (const p of periods!) {
    if (p.startsOn > p.endsOn) throw invalid(`Period "${p.name}" ends before it starts.`);
    if (p.opensOn > p.dueOn) throw invalid(`Period "${p.name}" is due before it opens.`);
  }
  if (await tx.one('select 1 from cycles where org_id = $1 and lower(name) = lower($2)', [ctx.orgId, d.name])) throw conflict('A cycle with that name already exists.');
  const c = await tx.one<{ id: string }>(
    `insert into cycles (org_id, name, starts_on, ends_on, goal_setting_opens_on, goal_setting_closes_on, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.orgId, d.name, d.startsOn, d.endsOn, d.goalSettingOpensOn ?? null, d.goalSettingClosesOn ?? null, d.activate ? 'active' : 'planning',
     ctx.actorType === 'system' ? null : ctx.userId]);
  let seq = 1;
  for (const p of periods!) {
    await tx.exec(
      `insert into review_periods (org_id, cycle_id, name, kind, sequence, starts_on, ends_on, opens_on, due_on) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.orgId, c!.id, p.name, d.cadence, seq++, p.startsOn, p.endsOn, p.opensOn, p.dueOn]);
  }
  await audit(tx, ctx, { action: 'cycle.created', entityType: 'cycle', entityId: c!.id, after: { name: d.name, startsOn: d.startsOn, endsOn: d.endsOn, periods: periods!.length, status: d.activate ? 'active' : 'planning' } });
  return c!.id;
}

export async function createCycle(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'cycles.manage');
  return withOrg(ctx.orgId, async (tx) => ({ id: await createCycleInTx(tx, ctx, input) }));
}

export async function listCycles(ctx: Ctx) {
  return withOrg(ctx.orgId, async (tx) => {
    const cycles = await tx.query<any>(`select id, name, starts_on, ends_on, goal_setting_opens_on, goal_setting_closes_on, status, created_at from cycles where org_id = $1 order by starts_on desc`, [ctx.orgId]);
    const periods = await tx.query<any>(
      `select id, cycle_id, name, kind, sequence, starts_on, ends_on, opens_on, due_on,
              case when current_date > due_on then 'overdue' when current_date >= opens_on then 'open' else 'upcoming' end as phase
       from review_periods where org_id = $1 order by cycle_id, sequence`, [ctx.orgId]);
    return cycles.map((c) => ({ ...c, periods: periods.filter((p) => p.cycle_id === c.id) }));
  });
}

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  goalSettingOpensOn: isoDate.nullable().optional(),
  goalSettingClosesOn: isoDate.nullable().optional(),
  status: z.enum(['planning', 'active', 'closed']).optional(),
}).strict();

export async function updateCycle(ctx: Ctx, cycleId: string, input: unknown) {
  requirePerm(ctx, 'cycles.manage');
  parse(uuid, cycleId);
  const d = parse(updateSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from cycles where org_id = $1 and id = $2 for update', [ctx.orgId, cycleId]);
    if (!cur) throw notFound('Cycle');
    if (cur.status === 'closed' && d.status && d.status !== 'closed') throw conflict('A closed cycle cannot be reopened.');
    const opens = d.goalSettingOpensOn === undefined ? cur.goal_setting_opens_on : d.goalSettingOpensOn;
    const closes = d.goalSettingClosesOn === undefined ? cur.goal_setting_closes_on : d.goalSettingClosesOn;
    await tx.exec(`update cycles set name = $3, goal_setting_opens_on = $4, goal_setting_closes_on = $5, status = $6 where org_id = $1 and id = $2`,
      [ctx.orgId, cycleId, d.name ?? cur.name, opens, closes, d.status ?? cur.status]);
    await audit(tx, ctx, { action: 'cycle.updated', entityType: 'cycle', entityId: cycleId,
      before: { name: cur.name, status: cur.status }, after: { name: d.name ?? cur.name, status: d.status ?? cur.status } });
    return { ok: true };
  });
}

const periodUpdate = z.object({ opensOn: isoDate.optional(), dueOn: isoDate.optional(), name: z.string().trim().min(1).max(60).optional() }).strict();
export async function updatePeriod(ctx: Ctx, periodId: string, input: unknown) {
  requirePerm(ctx, 'cycles.manage');
  const d = parse(periodUpdate, input);
  return withOrg(ctx.orgId, async (tx) => {
    const cur = await tx.one<any>('select * from review_periods where org_id = $1 and id = $2 for update', [ctx.orgId, periodId]);
    if (!cur) throw notFound('Review period');
    const opens = d.opensOn ?? cur.opens_on;
    const due = d.dueOn ?? cur.due_on;
    if (String(opens) > String(due)) throw invalid('A period cannot be due before it opens.');
    await tx.exec('update review_periods set opens_on = $3, due_on = $4, name = $5 where org_id = $1 and id = $2', [ctx.orgId, periodId, opens, due, d.name ?? cur.name]);
    await audit(tx, ctx, { action: 'period.updated', entityType: 'review_period', entityId: periodId,
      before: { opens_on: cur.opens_on, due_on: cur.due_on }, after: { opens_on: opens, due_on: due } });
    return { ok: true };
  });
}
