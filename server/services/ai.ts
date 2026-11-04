import { z } from 'zod';
import { withOrg } from '../db/pool';
import { type Ctx } from '../core/context';
import { AppError, forbidden } from '../core/errors';
import { config } from '../core/config';
import { parse, uuid } from '../core/validation';
import { resolvePolicy } from '@/lib/policy';
import { audit } from './audit';
import { rateLimit } from '../auth/ratelimit';
import { getVisibleGoal } from './goal-access';

/**
 * Bounded, transparent AI assistance (Groq, optional). Principles:
 *  - Opt-in per organisation (policy.ai.enabled) and requires GROQ_API_KEY.
 *  - Grounded: the prompt contains only the goal text / key results the caller can already see — never names, emails or ratings.
 *  - Suggestion only: output is returned to the user to edit; the AI cannot submit, approve, reject, score or rate anyone.
 *  - Auditable: each request is logged (type, goal) without storing the generated content.
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function groqChat(system: string, user: string): Promise<string> {
  const key = config().GROQ_API_KEY;
  if (!key) throw new AppError('bad_request', 'AI assistance is not configured on this server.');
  const res = await fetch(GROQ_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: config().GROQ_MODEL, temperature: 0.3, max_tokens: 700, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new AppError('bad_request', 'The AI service is unavailable right now. Please try again.');
  return (await res.json())?.choices?.[0]?.message?.content ?? '';
}

async function gate(ctx: Ctx) {
  await rateLimit('ai', ctx.userId, 30, 3600);
  const enabled = await withOrg(ctx.orgId, async (tx) => resolvePolicy((await tx.one<{ settings: unknown }>('select settings from org_policies where org_id = $1', [ctx.orgId]))?.settings).ai.enabled);
  if (!enabled) throw forbidden('AI assistance is turned off for your organisation.');
}

const NOTICE = 'AI-generated suggestion. Review and edit it; nothing is submitted or decided automatically.';
const SYSTEM = `You help employees write clear, measurable goals. Respond ONLY with compact JSON matching the requested shape. Never invent facts, names or numbers that are not implied by the input; use "[target]" placeholders when unsure. Do not evaluate people.`;

function parseJson(raw: string): any {
  try { return JSON.parse(raw); } catch { throw new AppError('bad_request', 'The AI returned an unexpected response. Try again.'); }
}

const draftSchema = z.object({ title: z.string().trim().max(300).default(''), description: z.string().trim().max(2000).default(''), goalId: uuid.optional() }).strict();

export async function suggestRefinement(ctx: Ctx, input: unknown) {
  const d = parse(draftSchema, input);
  if (!d.title && !d.description) throw new AppError('validation_failed', 'Add a rough title or description first.');
  await gate(ctx);
  const raw = await groqChat(SYSTEM, `Rewrite this draft goal to be specific, measurable and time-bound. Return {"title": string (<=120 chars), "description": string (2-3 sentences), "keyResults": [{"title": string, "metricType": "number"|"percent"|"currency"|"boolean", "startValue": number, "targetValue": number}] (2-4 items; use realistic placeholders)}.\nTitle: ${d.title}\nDescription: ${d.description}`);
  const out = parseJson(raw);
  await withOrg(ctx.orgId, (tx) => audit(tx, ctx, { action: 'ai.suggestion_requested', entityType: 'goal', entityId: d.goalId ?? null, metadata: { type: 'refine' } }));
  return { notice: NOTICE, suggestion: { title: String(out.title ?? '').slice(0, 200), description: String(out.description ?? '').slice(0, 2000), keyResults: Array.isArray(out.keyResults) ? out.keyResults.slice(0, 4) : [] } };
}

export async function summarizeGoalCheckins(ctx: Ctx, goalId: string) {
  parse(uuid, goalId);
  await gate(ctx);
  const data = await withOrg(ctx.orgId, async (tx) => {
    const g = await getVisibleGoal(tx, ctx, goalId);
    const revs = await tx.query<any>(
      `select p.name as period, r.health, r.progress, r.achievements, r.challenges, r.blockers, r.next_steps from checkins c
       join review_periods p on p.org_id = c.org_id and p.id = c.period_id
       join checkin_revisions r on r.org_id = c.org_id and r.checkin_id = c.id and r.revision = c.current_revision
       where c.org_id = $1 and c.goal_id = $2 and c.status in ('submitted','reviewed') order by p.sequence`, [ctx.orgId, goalId]);
    return { g, revs };
  });
  if (data.revs.length === 0) throw new AppError('validation_failed', 'There are no submitted check-ins to summarise yet.');
  const raw = await groqChat(SYSTEM, `Summarise the progress of this goal across its check-ins in 3-5 sentences, noting trend, blockers and next steps. Do not rate or judge the person. Return {"summary": string}.\nGoal: ${data.g.title}\n${JSON.stringify(data.revs)}`);
  await withOrg(ctx.orgId, (tx) => audit(tx, ctx, { action: 'ai.suggestion_requested', entityType: 'goal', entityId: goalId, metadata: { type: 'checkin_summary', checkins: data.revs.length } }));
  return { notice: NOTICE, summary: String(parseJson(raw).summary ?? '').slice(0, 2000) };
}

export async function suggestFeedback(ctx: Ctx, goalId: string, periodId: string) {
  parse(uuid, goalId); parse(uuid, periodId);
  await gate(ctx);
  const rev = await withOrg(ctx.orgId, async (tx) => {
    await getVisibleGoal(tx, ctx, goalId);
    return tx.one<any>(
      `select g.title, r.health, r.progress, r.achievements, r.challenges, r.blockers, r.next_steps from checkins c join goals g on g.org_id = c.org_id and g.id = c.goal_id
       join checkin_revisions r on r.org_id = c.org_id and r.checkin_id = c.id and r.revision = c.current_revision where c.org_id = $1 and c.goal_id = $2 and c.period_id = $3`, [ctx.orgId, goalId, periodId]);
  });
  if (!rev) throw new AppError('validation_failed', 'That check-in has not been submitted.');
  const raw = await groqChat(SYSTEM, `Draft constructive, specific manager feedback (2-4 sentences) the manager can edit, plus up to 2 follow-up action suggestions. Do not rate the person. Return {"feedback": string, "actions": [string]}.\n${JSON.stringify(rev)}`);
  const out = parseJson(raw);
  await withOrg(ctx.orgId, (tx) => audit(tx, ctx, { action: 'ai.suggestion_requested', entityType: 'goal', entityId: goalId, metadata: { type: 'feedback' } }));
  return { notice: NOTICE, feedback: String(out.feedback ?? '').slice(0, 2000), actions: (Array.isArray(out.actions) ? out.actions : []).slice(0, 2).map(String) };
}
