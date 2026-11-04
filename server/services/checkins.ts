import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withOrg } from '../db/pool';
import { type Ctx, can } from '../core/context';
import { conflict, forbidden, invalid, invalidState, notFound } from '../core/errors';
import { isoDate, parse, uuid } from '../core/validation';
import { resolvePolicy, type OrgPolicy } from '@/lib/policy';
import { keyResultProgress } from '@/lib/progress';
import { audit } from './audit';
import { notify } from './notifications';
import { isManagerOf } from './goal-access';
import { loadProgress } from './progress';

export const todayUtc = () => new Date().toISOString().slice(0, 10);

const policyOf = async (tx: Tx, orgId: string): Promise<OrgPolicy> =>
  resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [orgId]))?.settings);

/**
 * Every (goal, review period) pair that should have a check-in: approved goals that existed
 * during the period, in active cycles. `state` is derived from dates + check-in status, never stored.
 * Params: $1 org, $2 today (date).
 */
export const EXPECTED_CHECKINS_SQL = `
  select g.id as goal_id, g.title, g.owner_id, g.level, g.department_id, p.id as period_id, p.name as period_name, p.sequence, p.starts_on, p.ends_on, p.opens_on, p.due_on,
         c.id as checkin_id, c.status as checkin_status, c.is_late, c.health, c.progress_snapshot, c.submitted_at, c.reviewed_at,
         case when c.status in ('submitted','reviewed') then 'submitted'
              when c.status = 'reopened' then 'reopened'
              when $2::date > p.due_on then 'overdue'
              when $2::date >= p.opens_on then 'due'
              else 'upcoming' end as state
  from review_periods p
  join cycles cy on cy.org_id = p.org_id and cy.id = p.cycle_id and cy.status = 'active'
  join goals g on g.org_id = p.org_id and g.cycle_id = p.cycle_id and g.deleted_at is null and g.status in ('active', 'completed') and g.approved_at is not null
       and g.approved_at::date <= p.ends_on and (g.completed_at is null or g.completed_at::date >= p.starts_on)
  left join checkins c on c.org_id = g.org_id and c.goal_id = g.id and c.period_id = p.id
  where p.org_id = $1`;

async function canReadCheckin(tx: Tx, ctx: Ctx, ownerId: string): Promise<boolean> {
  if (ownerId === ctx.userId || can(ctx, 'goals.read_org')) return true;
  if ((can(ctx, 'goals.read_reports') || can(ctx, 'checkins.review')) && (await isManagerOf(tx, ctx.orgId, ctx.userId, ownerId))) return true;
  if (can(ctx, 'goals.read_department')) {
    return !!(await tx.one(
      `select 1 from users u where u.org_id = $1 and u.id = $2 and u.department_id in
         (select department_descendants($1, d.id) from departments d where d.org_id = $1 and d.head_user_id = $3 and d.archived_at is null)`, [ctx.orgId, ownerId, ctx.userId]));
  }
  return false;
}

async function canReview(tx: Tx, ctx: Ctx, ownerId: string): Promise<boolean> {
  if (ownerId === ctx.userId) return false;
  return can(ctx, 'checkins.review') && (await isManagerOf(tx, ctx.orgId, ctx.userId, ownerId));
}

export async function listMyCheckins(ctx: Ctx, asOf = todayUtc()) {
  return withOrg(ctx.orgId, async (tx) => {
    const rows = await tx.query<any>(
      `with e as (${EXPECTED_CHECKINS_SQL}) select * from e where owner_id = $3 and (state <> 'upcoming' or opens_on <= ($2::date + 30)) order by sequence desc, title`, [ctx.orgId, asOf, ctx.userId]);
    const periods = new Map<string, any>();
    for (const r of rows) {
      const p = periods.get(r.period_id) ?? { id: r.period_id, name: r.period_name, sequence: r.sequence, starts_on: r.starts_on, ends_on: r.ends_on, opens_on: r.opens_on, due_on: r.due_on, items: [] };
      p.items.push({ goal_id: r.goal_id, title: r.title, level: r.level, state: r.state, checkin_id: r.checkin_id, health: r.health, progress: r.progress_snapshot, submitted_at: r.submitted_at, is_late: r.is_late });
      periods.set(r.period_id, p);
    }
    return [...periods.values()];
  });
}

/** Check-ins of the caller's reports that need attention, plus overdue ones. */
export async function listTeamCheckins(ctx: Ctx, f: { periodId?: string; state?: string; asOf?: string } = {}) {
  if (!can(ctx, 'checkins.review') && !can(ctx, 'goals.read_org') && !can(ctx, 'goals.read_department')) throw forbidden();
  return withOrg(ctx.orgId, async (tx) => {
    const params: unknown[] = [ctx.orgId, f.asOf ?? todayUtc()];
    const w: string[] = [`state <> 'upcoming'`, `owner_id <> $3`];
    params.push(ctx.userId);
    if (f.periodId) { params.push(parse(uuid, f.periodId)); w.push(`period_id = $${params.length}`); }
    if (f.state) { params.push(f.state); w.push(`state = $${params.length}`); }
    if (!can(ctx, 'goals.read_org')) {
      params.push(ctx.userId);
      const me = `$${params.length}`;
      const parts = [`owner_id in (select reporting_subtree($1, ${me}))`];
      if (can(ctx, 'goals.read_department')) {
        parts.push(`owner_id in (select hu.id from users hu where hu.org_id = $1 and hu.department_id in (select department_descendants($1, hd.id) from departments hd where hd.org_id = $1 and hd.head_user_id = ${me} and hd.archived_at is null))`);
      }
      w.push(`(${parts.join(' or ')})`);
    }
    return tx.query(
      `with e as (${EXPECTED_CHECKINS_SQL}) select e.*, u.full_name as owner_name from e join users u on u.org_id = $1 and u.id = e.owner_id
       where ${w.join(' and ')} order by case e.state when 'overdue' then 0 when 'reopened' then 1 when 'submitted' then 2 else 3 end, e.due_on, u.full_name limit 500`, params);
  });
}

export async function getCheckin(ctx: Ctx, goalId: string, periodId: string, asOf = todayUtc()) {
  parse(uuid, goalId); parse(uuid, periodId);
  return withOrg(ctx.orgId, async (tx) => {
    const policy = await policyOf(tx, ctx.orgId);
    const row = await tx.one<any>(`with e as (${EXPECTED_CHECKINS_SQL}) select * from e where goal_id = $3 and period_id = $4`, [ctx.orgId, asOf, goalId, periodId]);
    if (!row) throw notFound('Check-in');
    if (!(await canReadCheckin(tx, ctx, row.owner_id))) throw notFound('Check-in');
    const krs = await tx.query<any>(
      `select id, title, metric_type, direction, unit, start_value, target_value, current_value, weight from key_results where org_id = $1 and goal_id = $2 and removed_at is null order by position`, [ctx.orgId, goalId]);
    const checkin = row.checkin_id ? await tx.one<any>('select * from checkins where org_id = $1 and id = $2', [ctx.orgId, row.checkin_id]) : null;
    const revisions = checkin ? await tx.query<any>(
      `select r.revision, r.kr_values, r.progress, r.health, r.achievements, r.challenges, r.blockers, r.next_steps, r.reflection, r.answers, r.is_late, r.submitted_at, u.full_name as submitted_by_name
       from checkin_revisions r join users u on u.org_id = r.org_id and u.id = r.submitted_by where r.org_id = $1 and r.checkin_id = $2 order by r.revision desc`, [ctx.orgId, checkin.id]) : [];
    const feedback = checkin ? await tx.query<any>(
      `select f.id, f.revision, f.kind, f.body, f.created_at, f.author_id, u.full_name as author_name from checkin_feedback f join users u on u.org_id = f.org_id and u.id = f.author_id
       where f.org_id = $1 and f.checkin_id = $2 order by f.created_at`, [ctx.orgId, checkin.id]) : [];
    const actions = await tx.query<any>(
      `select a.id, a.title, a.due_date, a.status, a.assignee_id, u.full_name as assignee_name, a.created_at, a.completed_at from action_items a join users u on u.org_id = a.org_id and u.id = a.assignee_id
       where a.org_id = $1 and a.goal_id = $2 order by a.created_at desc limit 50`, [ctx.orgId, goalId]);
    const goal = await tx.one<any>('select id, title, level, status, owner_id from goals where org_id = $1 and id = $2', [ctx.orgId, goalId]);
    const progress = (await loadProgress(tx, ctx.orgId, [goalId])).get(goalId);
    const period = await tx.one<any>('select id, name, starts_on, ends_on, opens_on, due_on from review_periods where org_id = $1 and id = $2', [ctx.orgId, periodId]);
    return {
      goal, period, state: row.state, owner_id: row.owner_id,
      keyResults: krs.map((k) => ({ ...k, progress: keyResultProgress(k) })), goalProgress: progress?.effective ?? null,
      checkin: checkin && { id: checkin.id, status: checkin.status, current_revision: checkin.current_revision, health: checkin.health, progress_snapshot: checkin.progress_snapshot, draft: checkin.draft, submitted_at: checkin.submitted_at, is_late: checkin.is_late, reviewed_at: checkin.reviewed_at },
      revisions, feedback, actionItems: actions, questions: policy.checkins.customQuestions,
      permissions: { submit: row.owner_id === ctx.userId && ['due', 'overdue', 'reopened'].includes(row.state), review: await canReview(tx, ctx, row.owner_id) },
    };
  });
}

const textField = z.string().trim().max(4000).optional();
export const checkinSchema = z.object({
  krValues: z.array(z.object({ keyResultId: uuid, value: z.number().finite() }).strict()).max(20),
  health: z.enum(['on_track', 'at_risk', 'off_track', 'completed']),
  achievements: textField, challenges: textField, blockers: textField, nextSteps: textField, reflection: textField,
  answers: z.record(z.string().max(4000)).optional(),
}).strict();

async function ensureCheckinRow(tx: Tx, ctx: Ctx, goalId: string, periodId: string, ownerId: string) {
  await tx.exec(`insert into checkins (org_id, goal_id, period_id, owner_id) values ($1,$2,$3,$4) on conflict (goal_id, period_id) do nothing`, [ctx.orgId, goalId, periodId, ownerId]);
  return tx.one<any>('select * from checkins where org_id = $1 and goal_id = $2 and period_id = $3 for update', [ctx.orgId, goalId, periodId]);
}

async function loadExpected(tx: Tx, ctx: Ctx, goalId: string, periodId: string, asOf: string) {
  const row = await tx.one<any>(`with e as (${EXPECTED_CHECKINS_SQL}) select * from e where goal_id = $3 and period_id = $4`, [ctx.orgId, asOf, goalId, periodId]);
  if (!row) throw notFound('Check-in');
  return row;
}

export async function saveCheckinDraft(ctx: Ctx, goalId: string, periodId: string, input: unknown, asOf = todayUtc()) {
  parse(uuid, goalId); parse(uuid, periodId);
  const d = parse(checkinSchema.partial(), input);
  return withOrg(ctx.orgId, async (tx) => {
    const e = await loadExpected(tx, ctx, goalId, periodId, asOf);
    if (e.owner_id !== ctx.userId) throw notFound('Check-in');
    if (e.state === 'upcoming') throw invalidState('This review period has not opened yet.');
    if (e.state === 'submitted') throw conflict('This check-in was already submitted. Ask your manager to reopen it if it needs correcting.');
    const c = await ensureCheckinRow(tx, ctx, goalId, periodId, ctx.userId);
    await tx.exec('update checkins set draft = $3 where org_id = $1 and id = $2', [ctx.orgId, c.id, JSON.stringify(d)]);
    return { ok: true };
  });
}

export async function submitCheckin(ctx: Ctx, goalId: string, periodId: string, input: unknown, asOf = todayUtc()) {
  parse(uuid, goalId); parse(uuid, periodId);
  const d = parse(checkinSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const policy = await policyOf(tx, ctx.orgId);
    await tx.one('select id from goals where org_id = $1 and id = $2 for update', [ctx.orgId, goalId]);
    const e = await loadExpected(tx, ctx, goalId, periodId, asOf);
    if (e.owner_id !== ctx.userId) throw e.owner_id ? notFound('Check-in') : forbidden();
    if (e.state === 'upcoming') throw invalidState('This review period has not opened yet.');
    const c = await ensureCheckinRow(tx, ctx, goalId, periodId, ctx.userId);
    if (c.status === 'submitted' || c.status === 'reviewed') throw conflict('This check-in was already submitted. Ask your manager to reopen it if it needs correcting.');

    for (const q of policy.checkins.customQuestions) {
      if (q.required && !(d.answers?.[q.id] ?? '').trim()) throw invalid(`Please answer: ${q.label}`);
    }
    const allowed = new Set(policy.checkins.customQuestions.map((q) => q.id));
    for (const k of Object.keys(d.answers ?? {})) if (!allowed.has(k)) throw invalid(`Unknown question "${k}".`);

    const krs = await tx.query<any>('select * from key_results where org_id = $1 and goal_id = $2 and removed_at is null order by position for update', [ctx.orgId, goalId]);
    const provided = new Map(d.krValues.map((v) => [v.keyResultId, v.value]));
    for (const id of provided.keys()) if (!krs.some((k) => k.id === id)) throw notFound('Key result');
    const frozen: unknown[] = [];
    for (const k of krs) {
      const value = provided.has(k.id) ? provided.get(k.id)! : k.current_value;
      if (value == null) throw invalid(`Enter a value for "${k.title}".`);
      if (k.metric_type === 'boolean' && ![0, 1].includes(value)) throw invalid('Yes/no key results take 0 or 1.');
      if (provided.has(k.id) && value !== k.current_value) {
        const pct = keyResultProgress({ ...k, current_value: value });
        await tx.exec('update key_results set current_value = $3 where org_id = $1 and id = $2', [ctx.orgId, k.id, value]);
        await tx.exec(`insert into progress_updates (org_id, goal_id, key_result_id, value, previous_value, progress_pct, note, source, created_by) values ($1,$2,$3,$4,$5,$6,$7,'checkin',$8)`,
          [ctx.orgId, goalId, k.id, value, k.current_value, pct, `Check-in ${e.period_name}`, ctx.userId]);
      }
      frozen.push({ key_result_id: k.id, title: k.title, start: k.start_value, target: k.target_value, value, progress: keyResultProgress({ ...k, current_value: value }) });
    }
    const progress = (await loadProgress(tx, ctx.orgId, [goalId])).get(goalId)?.effective ?? null;
    const late = asOf > e.due_on;
    const revision = c.current_revision + 1;
    await tx.exec(
      `insert into checkin_revisions (org_id, checkin_id, revision, kr_values, progress, health, achievements, challenges, blockers, next_steps, reflection, answers, is_late, submitted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [ctx.orgId, c.id, revision, JSON.stringify(frozen), progress, d.health, d.achievements ?? null, d.challenges ?? null, d.blockers ?? null, d.nextSteps ?? null, d.reflection ?? null, JSON.stringify(d.answers ?? {}), late, ctx.userId]);
    await tx.exec(
      `update checkins set status = 'submitted', current_revision = $3, health = $4, progress_snapshot = $5, submitted_at = now(), is_late = $6, draft = null, reviewed_at = null, reviewed_by = null where org_id = $1 and id = $2`,
      [ctx.orgId, c.id, revision, d.health, progress, late]);
    await audit(tx, ctx, { action: revision > 1 ? 'checkin.resubmitted' : 'checkin.submitted', entityType: 'goal', entityId: goalId,
      after: { checkinId: c.id, period: e.period_name, revision, health: d.health, progress, late }, metadata: { periodId } });
    const owner = await tx.one<{ manager_id: string | null; full_name: string }>('select manager_id, full_name from users where org_id = $1 and id = $2', [ctx.orgId, ctx.userId]);
    if (owner?.manager_id) {
      await notify(tx, ctx, { userId: owner.manager_id, category: 'checkins', type: 'checkin.submitted', title: `Check-in submitted: ${e.title}`,
        body: `${owner.full_name} submitted their ${e.period_name} check-in (${d.health.replace('_', ' ')}${progress != null ? `, ${progress}% complete` : ''}).`,
        link: `/app/checkins/${goalId}/${periodId}`, entityType: 'goal', entityId: goalId, dedupeKey: `checkin-submitted:${c.id}:${revision}` });
    }
    return { checkinId: c.id, revision, progress, late };
  });
}

const reviewSchema = z.object({
  feedback: z.string().trim().min(3).max(4000),
  actionItems: z.array(z.object({ title: z.string().trim().min(2).max(300), dueDate: isoDate.optional(), assigneeId: uuid.optional() }).strict()).max(10).optional(),
}).strict();

export async function reviewCheckin(ctx: Ctx, checkinId: string, input: unknown) {
  parse(uuid, checkinId);
  const d = parse(reviewSchema, input);
  return withOrg(ctx.orgId, async (tx) => {
    const c = await tx.one<any>('select * from checkins where org_id = $1 and id = $2', [ctx.orgId, checkinId]);
    if (!c) throw notFound('Check-in');
    if (!(await canReadCheckin(tx, ctx, c.owner_id))) throw notFound('Check-in');
    if (!(await canReview(tx, ctx, c.owner_id))) throw forbidden('Only the owner\'s manager can review this check-in.');
    const locked = await tx.one<any>('select * from checkins where org_id = $1 and id = $2 for update', [ctx.orgId, checkinId]);
    if (!['submitted', 'reviewed'].includes(locked.status)) throw invalidState('There is no submitted check-in to review yet.');
    await tx.exec(`insert into checkin_feedback (org_id, checkin_id, revision, author_id, kind, body) values ($1,$2,$3,$4,'feedback',$5)`, [ctx.orgId, checkinId, locked.current_revision, ctx.userId, d.feedback]);
    await tx.exec(`update checkins set status = 'reviewed', reviewed_at = now(), reviewed_by = $3 where org_id = $1 and id = $2`, [ctx.orgId, checkinId, ctx.userId]);
    for (const a of d.actionItems ?? []) {
      const assignee = a.assigneeId ?? c.owner_id;
      if (assignee !== c.owner_id && assignee !== ctx.userId) throw invalid('Action items can be assigned to the owner or yourself.');
      await tx.exec(`insert into action_items (org_id, checkin_id, goal_id, assignee_id, title, due_date, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [ctx.orgId, checkinId, c.goal_id, assignee, a.title, a.dueDate ?? null, ctx.userId]);
    }
    await audit(tx, ctx, { action: 'checkin.reviewed', entityType: 'goal', entityId: c.goal_id, after: { checkinId, revision: locked.current_revision, actionItems: d.actionItems?.length ?? 0 }, metadata: { feedback: d.feedback } });
    const goal = await tx.one<{ title: string }>('select title from goals where org_id = $1 and id = $2', [ctx.orgId, c.goal_id]);
    await notify(tx, ctx, { userId: c.owner_id, category: 'feedback', type: 'checkin.feedback', title: `Feedback on your check-in: ${goal?.title}`, body: `${ctx.userName}: "${d.feedback.slice(0, 300)}"`,
      link: `/app/checkins/${c.goal_id}/${c.period_id}`, entityType: 'goal', entityId: c.goal_id, dedupeKey: `checkin-feedback:${checkinId}:${Date.now()}` });
    return { ok: true };
  });
}

export async function reopenCheckin(ctx: Ctx, checkinId: string, reason: string) {
  parse(uuid, checkinId);
  const why = parse(z.string().trim().min(5).max(1000), reason);
  return withOrg(ctx.orgId, async (tx) => {
    const c = await tx.one<any>('select * from checkins where org_id = $1 and id = $2', [ctx.orgId, checkinId]);
    if (!c || !(await canReadCheckin(tx, ctx, c.owner_id))) throw notFound('Check-in');
    if (!(await canReview(tx, ctx, c.owner_id))) throw forbidden('Only the owner\'s manager can reopen a check-in.');
    const locked = await tx.one<any>('select * from checkins where org_id = $1 and id = $2 for update', [ctx.orgId, checkinId]);
    if (!['submitted', 'reviewed'].includes(locked.status)) throw invalidState('Only submitted check-ins can be reopened.');
    await tx.exec(`insert into checkin_feedback (org_id, checkin_id, revision, author_id, kind, body) values ($1,$2,$3,$4,'reopen',$5)`, [ctx.orgId, checkinId, locked.current_revision, ctx.userId, why]);
    await tx.exec(`update checkins set status = 'reopened' where org_id = $1 and id = $2`, [ctx.orgId, checkinId]);
    await audit(tx, ctx, { action: 'checkin.reopened', entityType: 'goal', entityId: c.goal_id, metadata: { checkinId, reason: why, revision: locked.current_revision } });
    await notify(tx, ctx, { userId: c.owner_id, category: 'checkins', type: 'checkin.reopened', title: 'A check-in was reopened for correction', body: `${ctx.userName}: "${why}"`, link: `/app/checkins/${c.goal_id}/${c.period_id}`, entityType: 'goal', entityId: c.goal_id, dedupeKey: `checkin-reopened:${checkinId}:${locked.current_revision}` });
    return { ok: true };
  });
}

export async function listActionItems(ctx: Ctx, f: { status?: string } = {}) {
  return withOrg(ctx.orgId, (tx) => tx.query(
    `select a.id, a.title, a.due_date, a.status, a.goal_id, g.title as goal_title, a.created_by, cb.full_name as created_by_name, a.created_at
     from action_items a join goals g on g.org_id = a.org_id and g.id = a.goal_id join users cb on cb.org_id = a.org_id and cb.id = a.created_by
     where a.org_id = $1 and a.assignee_id = $2 and ($3::text is null or a.status = $3) order by a.status, a.due_date nulls last limit 200`, [ctx.orgId, ctx.userId, f.status ?? null]));
}

export async function setActionItemStatus(ctx: Ctx, id: string, status: 'open' | 'done' | 'cancelled') {
  parse(uuid, id);
  parse(z.enum(['open', 'done', 'cancelled']), status);
  return withOrg(ctx.orgId, async (tx) => {
    const a = await tx.one<any>('select * from action_items where org_id = $1 and id = $2 for update', [ctx.orgId, id]);
    if (!a || (a.assignee_id !== ctx.userId && a.created_by !== ctx.userId)) throw notFound('Action item');
    await tx.exec(`update action_items set status = $3, completed_at = case when $3 = 'done' then now() else null end where org_id = $1 and id = $2`, [ctx.orgId, id, status]);
    await audit(tx, ctx, { action: 'action_item.updated', entityType: 'goal', entityId: a.goal_id, before: { status: a.status }, after: { status }, metadata: { actionItemId: id } });
    return { ok: true };
  });
}

/**
 * Sends check-in reminders. One digest per person per bucket (not one per goal), deduplicated by key,
 * so running the sweep repeatedly never double-notifies. Also tells managers about overdue reports.
 */
export async function sendCheckinReminders(tx: Tx, orgId: string, asOf = todayUtc()) {
  const policy = await policyOf(tx, orgId);
  const rows = await tx.query<any>(
    `with e as (${EXPECTED_CHECKINS_SQL})
     select e.owner_id, e.period_id, e.period_name, e.due_on, e.state, count(*)::int as n, u.manager_id, u.full_name,
            ($2::date - e.due_on) as days_overdue, (e.due_on - $2::date) as days_left
     from e join users u on u.org_id = $1 and u.id = e.owner_id and u.status = 'active'
     where e.state in ('due', 'overdue', 'reopened') group by e.owner_id, e.period_id, e.period_name, e.due_on, e.state, u.manager_id, u.full_name`, [orgId, asOf]);
  let sent = 0;
  const overdueByManager = new Map<string, { period: string; periodId: string; bucket: number; people: Map<string, number> }>();
  for (const r of rows) {
    if (r.state === 'overdue') {
      const bucket = Math.floor(r.days_overdue / policy.checkins.overdueReminderEveryDays);
      if (await notify(tx, { orgId }, { userId: r.owner_id, category: 'checkins', type: 'checkin.overdue', title: `${r.n} overdue check-in${r.n > 1 ? 's' : ''} for ${r.period_name}`,
        body: `Your ${r.period_name} check-in${r.n > 1 ? 's were' : ' was'} due ${r.due_on}. Please submit ${r.n > 1 ? 'them' : 'it'} when you can.`, link: '/app/checkins', dedupeKey: `checkin-overdue:${r.period_id}:${bucket}` })) sent++;
      if (r.manager_id) {
        const m = overdueByManager.get(r.manager_id) ?? { period: r.period_name, periodId: r.period_id, bucket, people: new Map() };
        m.people.set(r.full_name, (m.people.get(r.full_name) ?? 0) + r.n);
        overdueByManager.set(r.manager_id, m);
      }
    } else if (policy.checkins.reminderDaysBefore.includes(r.days_left) || r.state === 'reopened') {
      if (await notify(tx, { orgId }, { userId: r.owner_id, category: 'checkins', type: 'checkin.due', title: r.state === 'reopened' ? 'A check-in needs your correction' : `${r.n} check-in${r.n > 1 ? 's' : ''} due ${r.days_left === 0 ? 'today' : `in ${r.days_left} day${r.days_left > 1 ? 's' : ''}`}`,
        body: `Your ${r.period_name} check-in${r.n > 1 ? 's are' : ' is'} due ${r.due_on}.`, link: '/app/checkins', dedupeKey: `checkin-due:${r.period_id}:${r.state === 'reopened' ? `reopened:${asOf}` : r.days_left}` })) sent++;
    }
  }
  for (const [managerId, m] of overdueByManager) {
    const names = [...m.people.entries()].slice(0, 5).map(([n, c]) => `${n} (${c})`).join(', ');
    if (await notify(tx, { orgId }, { userId: managerId, category: 'checkins', type: 'checkin.team_overdue', title: `${m.people.size} report${m.people.size > 1 ? 's have' : ' has'} overdue ${m.period} check-ins`,
      body: names, link: '/app/team', dedupeKey: `checkin-team-overdue:${m.periodId}:${m.bucket}` })) sent++;
  }
  return sent;
}
