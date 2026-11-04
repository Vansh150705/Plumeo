import { z } from 'zod';
import { route, json, sessionCookie, type HandlerArgs } from './framework';
import { config } from '../core/config';
import { AppError, forbidden, unauthenticated } from '../core/errors';
import { safeEqual } from '../core/crypto';
import { parse } from '../core/validation';
import { can, requirePerm } from '../core/context';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { lintGoal } from '@/lib/goal-rules';
import { withOrg, withSystem, pool } from '../db/pool';
import { currentMigration } from '../db/migrate';
import { changeOwnPassword, loginWithPassword, logout, redeemCredentialToken } from '../auth/login';
import { listMySessions, revokeSession, createSession } from '../auth/sessions';
import { finishSso, startSso } from '../auth/oidc';
import { PLATFORM_COOKIE, platformLogin, platformLogout, resolvePlatformSession } from '../auth/platform';
import { createOrganization, getOrg, getPolicy, listOrgsForPlatform, setOrgStatus, updateOrgName, updatePolicy } from '../services/orgs';
import { createUser, getUser, listUsers, resetUserPassword, setUserStatus, updateMyProfile, updateUser, anonymizeUser, myTeam } from '../services/users';
import { assignRole, createCustomRole, deleteCustomRole, listRoles, listUserRoles, revokeRole, updateCustomRole } from '../services/rbac';
import { archiveDepartment, archiveTeam, createDepartment, createTeam, listStructure, updateDepartment, updateTeam } from '../services/structure';
import { createCycle, listCycles, updateCycle, updatePeriod } from '../services/cycles';
import { cancelGoal, completeGoal, createGoal, deleteDraftGoal, getAlignment, getGoalDetail, listGoals, recordProgress, transferOwnership, updateGoal } from '../services/goals';
import { createDelegation, decideApproval, listApprovalQueue, listDelegations, revokeDelegation, submitGoal, withdrawSubmission } from '../services/approvals';
import { getVersion, proposeAmendment, withdrawAmendment } from '../services/amendments';
import { getCheckin, listActionItems, listMyCheckins, listTeamCheckins, reopenCheckin, reviewCheckin, saveCheckinDraft, setActionItemStatus, submitCheckin } from '../services/checkins';
import { archiveTemplate, createTemplate, createTemplateFromGoal, listTemplates } from '../services/templates';
import { deliveryStats, getPreferences, listNotifications, markRead, setPreferences } from '../services/notifications';
import { getAnalytics, managerWorkload } from '../services/analytics';
import { exportAuditCsv, exportCheckinsCsv, exportGoalsCsv, exportSummaryPdf } from '../services/exports';
import { searchAudit, verifyAuditChain } from '../services/audit';
import { createScimToken, createWebhook, deleteWebhook, getIdentityProvider, listScimTokens, listWebhooks, removeIdentityProvider, revokeScimToken, saveIdentityProvider, sendWebhookTest, setWebhookEnabled } from '../services/integrations';
import { suggestFeedback, suggestRefinement, summarizeGoalCheckins } from '../services/ai';
import { runScheduledJobs } from '../services/jobs';

const csvList = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const num = (v?: string) => (v == null || v === '' ? undefined : Number(v));
const bool = (v?: string) => v === 'true' || v === '1';
const file = (body: string | Buffer, type: string, name: string) =>
  new Response(body as BodyInit, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const setCookie = (res: Response, cookie: string) => { res.headers.append('set-cookie', cookie); return res; };

// ---------------------------------------------------------------------------
// Health (public)
// ---------------------------------------------------------------------------
route('GET', '/health', async () => ({ status: 'ok', time: new Date().toISOString() }), { public: true });
route('GET', '/ready', async () => {
  try {
    const r = await pool().query('select 1 as ok');
    const m = await currentMigration(pool());
    return { status: r.rows[0].ok === 1 ? 'ready' : 'degraded', migration: m };
  } catch {
    return new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Database unreachable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
}, { public: true });

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
const loginBody = z.object({ orgSlug: z.string().min(1).max(60), email: z.string().min(1).max(200), password: z.string().min(1).max(500) }).strict();
route('POST', '/auth/login', async ({ body, ip, req, requestId }) => {
  const d = parse(loginBody, body);
  const s = await loginWithPassword(d, { ip, userAgent: req.headers.get('user-agent') ?? undefined, requestId });
  return setCookie(json(200, { data: { ok: true } }), sessionCookie(s.token, s.expiresAt));
}, { public: true });

route('POST', '/auth/logout', async ({ ctx }) => {
  await logout(ctx);
  return setCookie(json(200, { data: { ok: true } }), sessionCookie(null));
});

route('POST', '/auth/signup', async ({ body, ip, requestId, req }) => {
  if (!config().allowSignup) throw forbidden('Self-service sign-up is disabled on this server. Ask the platform operator to create your organisation.');
  const org = await createOrganization(body, { requestId, ip });
  const input = body as { adminEmail: string; adminPassword: string; slug: string };
  const s = await loginWithPassword({ orgSlug: input.slug, email: input.adminEmail, password: input.adminPassword }, { ip, userAgent: req.headers.get('user-agent') ?? undefined, requestId });
  return setCookie(json(200, { data: { orgId: org.orgId, slug: org.slug } }), sessionCookie(s.token, s.expiresAt));
}, { public: true, limit: { max: 5, windowSec: 3600 } });

route('POST', '/auth/accept-invite', async ({ body, ip, requestId }) => {
  const d = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(500) }).strict(), body);
  const r = await redeemCredentialToken(d, { ip, requestId });
  const org = await withSystem((tx) => tx.one<{ slug: string }>('select slug from orgs where id = $1', [r.orgId]));
  return { ok: true, orgSlug: org?.slug };
}, { public: true });

route('GET', '/auth/me', async ({ ctx }) => {
  const [org, me, unread] = await Promise.all([
    getOrg(ctx),
    getUser(ctx, ctx.userId),
    withOrg(ctx.orgId, (tx) => tx.one<{ n: number }>('select count(*)::int as n from notifications where org_id = $1 and user_id = $2 and read_at is null', [ctx.orgId, ctx.userId])),
  ]);
  return { user: me, org, permissions: [...ctx.perms], roles: ctx.roleKeys, unreadNotifications: unread!.n };
});

route('POST', '/auth/password', async ({ ctx, body }) => changeOwnPassword(ctx, parse(z.object({ current: z.string().max(500), next: z.string().max(500) }).strict(), body)));
route('GET', '/auth/sessions', async ({ ctx }) => listMySessions(ctx));
route('DELETE', '/auth/sessions/:id', async ({ ctx, params }) => {
  const mine = await listMySessions(ctx);
  if (!mine.some((s: any) => s.id === params.id)) throw new AppError('not_found', 'Session not found.');
  await revokeSession(ctx.orgId, params.id);
  return { ok: true };
});

route('GET', '/auth/sso/start', async ({ query, ip }) => {
  const { url } = await startSso(query.org ?? '', { ip });
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
}, { public: true });

route('GET', '/auth/sso/callback', async ({ query, ip, req, requestId }) => {
  try {
    const s = await finishSso({ code: query.code, state: query.state, error: query.error }, { ip, userAgent: req.headers.get('user-agent') ?? undefined, requestId });
    return setCookie(new Response(null, { status: 302, headers: { location: `${config().APP_URL}/app` } }), sessionCookie(s.token, s.expiresAt));
  } catch (e) {
    const msg = e instanceof AppError ? e.message : 'Single sign-on failed.';
    return new Response(null, { status: 302, headers: { location: `${config().APP_URL}/login?error=${encodeURIComponent(msg)}` } });
  }
}, { public: true });

// ---------------------------------------------------------------------------
// Platform (super administrators): organisation lifecycle only
// ---------------------------------------------------------------------------
async function platformAdmin(req: Request) {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`${PLATFORM_COOKIE}=([^;]+)`));
  const s = await resolvePlatformSession(m ? decodeURIComponent(m[1]) : null);
  if (!s) throw unauthenticated();
  return s;
}
route('POST', '/platform/login', async ({ body, ip }) => {
  const d = parse(z.object({ email: z.string().max(200), password: z.string().max(500) }).strict(), body);
  const s = await platformLogin(d.email, d.password, ip);
  return setCookie(json(200, { data: { ok: true } }), `${PLATFORM_COOKIE}=${s.token}; Path=/; HttpOnly; SameSite=Strict; Expires=${s.expiresAt.toUTCString()}${config().secureCookies ? '; Secure' : ''}`);
}, { public: true });
route('POST', '/platform/logout', async ({ req }) => {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`${PLATFORM_COOKIE}=([^;]+)`));
  if (m) await platformLogout(decodeURIComponent(m[1]));
  return setCookie(json(200, { data: { ok: true } }), `${PLATFORM_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}, { public: true });
route('GET', '/platform/orgs', async ({ req }) => { await platformAdmin(req); return listOrgsForPlatform(); }, { public: true });
route('POST', '/platform/orgs', async ({ req, body, requestId, ip }) => { await platformAdmin(req); return createOrganization(body, { requestId, ip }); }, { public: true });
route('POST', '/platform/orgs/:id/status', async ({ req, params, body, requestId }) => {
  const admin = await platformAdmin(req);
  const d = parse(z.object({ status: z.enum(['active', 'suspended']) }).strict(), body);
  return setOrgStatus(params.id, d.status, admin.admin_id, requestId);
}, { public: true });

// ---------------------------------------------------------------------------
// Organisation, policy, structure, cycles
// ---------------------------------------------------------------------------
route('GET', '/org', async ({ ctx }) => getOrg(ctx));
route('PATCH', '/org', async ({ ctx, body }) => updateOrgName(ctx, (body as any)?.name));
route('GET', '/policy', async ({ ctx }) => getPolicy(ctx));
route('PUT', '/policy', async ({ ctx, body }) => {
  const { policy, expectedVersion } = (body ?? {}) as { policy?: unknown; expectedVersion?: number };
  return updatePolicy(ctx, policy ?? {}, expectedVersion);
});
route('GET', '/permissions', async () => ({ permissions: PERMISSIONS, systemRoles: SYSTEM_ROLES, all: ALL_PERMISSIONS }));

route('GET', '/structure', async ({ ctx }) => listStructure(ctx));
route('POST', '/departments', async ({ ctx, body }) => createDepartment(ctx, body));
route('PATCH', '/departments/:id', async ({ ctx, params, body }) => updateDepartment(ctx, params.id, body));
route('DELETE', '/departments/:id', async ({ ctx, params }) => archiveDepartment(ctx, params.id), { noBody: true });
route('POST', '/teams', async ({ ctx, body }) => createTeam(ctx, body));
route('PATCH', '/teams/:id', async ({ ctx, params, body }) => updateTeam(ctx, params.id, body));
route('DELETE', '/teams/:id', async ({ ctx, params }) => archiveTeam(ctx, params.id), { noBody: true });

route('GET', '/cycles', async ({ ctx }) => listCycles(ctx));
route('POST', '/cycles', async ({ ctx, body }) => createCycle(ctx, body));
route('PATCH', '/cycles/:id', async ({ ctx, params, body }) => updateCycle(ctx, params.id, body));
route('PATCH', '/periods/:id', async ({ ctx, params, body }) => updatePeriod(ctx, params.id, body));

// ---------------------------------------------------------------------------
// People and roles
// ---------------------------------------------------------------------------
route('GET', '/users', async ({ ctx, query }) => listUsers(ctx, { q: query.q, status: query.status, departmentId: query.departmentId, teamId: query.teamId, managerId: query.managerId, limit: num(query.limit), offset: num(query.offset) }));
route('POST', '/users', async ({ ctx, body }) => createUser(ctx, body));
route('GET', '/users/:id', async ({ ctx, params }) => getUser(ctx, params.id));
route('PATCH', '/users/:id', async ({ ctx, params, body }) => updateUser(ctx, params.id, body));
route('POST', '/users/:id/status', async ({ ctx, params, body }) => setUserStatus(ctx, params.id, parse(z.object({ status: z.enum(['active', 'suspended', 'deactivated']) }).strict(), body).status));
route('POST', '/users/:id/anonymize', async ({ ctx, params }) => anonymizeUser(ctx, params.id), { noBody: true });
route('POST', '/users/:id/reset-password', async ({ ctx, params }) => resetUserPassword(ctx, params.id), { noBody: true });
route('GET', '/users/:id/roles', async ({ ctx, params }) => listUserRoles(ctx, params.id));
route('POST', '/users/:id/roles', async ({ ctx, params, body }) => assignRole(ctx, params.id, parse(z.object({ role: z.string().max(60) }).strict(), body).role));
route('DELETE', '/users/:id/roles/:role', async ({ ctx, params }) => revokeRole(ctx, params.id, params.role), { noBody: true });
route('PATCH', '/me', async ({ ctx, body }) => updateMyProfile(ctx, body));
route('GET', '/me/team', async ({ ctx }) => myTeam(ctx));
route('GET', '/roles', async ({ ctx }) => { requirePerm(ctx, 'roles.manage', 'users.manage', 'users.read'); return listRoles(ctx); });
route('POST', '/roles', async ({ ctx, body }) => createCustomRole(ctx, body));
route('PATCH', '/roles/:id', async ({ ctx, params, body }) => updateCustomRole(ctx, params.id, body));
route('DELETE', '/roles/:id', async ({ ctx, params }) => deleteCustomRole(ctx, params.id), { noBody: true });

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
route('GET', '/goals', async ({ ctx, query }) => listGoals(ctx, {
  cycleId: query.cycleId, level: csvList(query.level), status: csvList(query.status), priority: csvList(query.priority), risk: csvList(query.risk),
  ownerId: query.ownerId, departmentId: query.departmentId, teamId: query.teamId, parentGoalId: query.parentGoalId, q: query.q, mine: bool(query.mine),
  dueBefore: query.dueBefore, dueAfter: query.dueAfter, sort: query.sort, order: query.order as any, limit: num(query.limit), offset: num(query.offset),
}));
route('POST', '/goals', async ({ ctx, body }) => createGoal(ctx, body), { idempotent: true });
route('GET', '/goals/alignment', async ({ ctx, query }) => getAlignment(ctx, query.cycleId ?? '', { includeInactive: bool(query.includeInactive) }));
route('POST', '/goals/lint', async ({ body }) => {
  const d = parse(z.object({ title: z.string().max(200), description: z.string().max(5000).nullish(), expectedOutcome: z.string().max(2000).nullish(), keyResults: z.array(z.object({ title: z.string().max(300) }).passthrough()).max(20).default([]) }).strict(), body);
  return lintGoal({ title: d.title, description: d.description, expected_outcome: d.expectedOutcome }, d.keyResults as any);
});
route('GET', '/goals/:id', async ({ ctx, params }) => getGoalDetail(ctx, params.id));
route('PATCH', '/goals/:id', async ({ ctx, params, body }) => updateGoal(ctx, params.id, body));
route('DELETE', '/goals/:id', async ({ ctx, params }) => deleteDraftGoal(ctx, params.id), { noBody: true });
route('POST', '/goals/:id/submit', async ({ ctx, params, body }) => submitGoal(ctx, params.id, (body as any)?.expectedVersion));
route('POST', '/goals/:id/withdraw', async ({ ctx, params }) => withdrawSubmission(ctx, params.id), { noBody: true });
route('POST', '/goals/:id/complete', async ({ ctx, params, body }) => completeGoal(ctx, params.id, (body as any)?.note));
route('POST', '/goals/:id/cancel', async ({ ctx, params, body }) => cancelGoal(ctx, params.id, (body as any)?.reason ?? ''));
route('POST', '/goals/:id/transfer', async ({ ctx, params, body }) => transferOwnership(ctx, params.id, (body as any)?.newOwnerId ?? '', (body as any)?.reason ?? ''));
route('POST', '/goals/:id/progress', async ({ ctx, params, body }) => recordProgress(ctx, params.id, body));
route('POST', '/goals/:id/amendments', async ({ ctx, params, body }) => proposeAmendment(ctx, params.id, body));
route('GET', '/goals/:id/versions/:version', async ({ ctx, params }) => getVersion(ctx, params.id, Number(params.version)));
route('POST', '/amendments/:id/withdraw', async ({ ctx, params }) => withdrawAmendment(ctx, params.id), { noBody: true });

route('GET', '/approvals', async ({ ctx, query }) => listApprovalQueue(ctx, query.scope === 'all' ? 'all' : 'mine'));
route('POST', '/approvals/:id/decision', async ({ ctx, params, body }) => decideApproval(ctx, params.id, body));
route('GET', '/delegations', async ({ ctx }) => listDelegations(ctx));
route('POST', '/delegations', async ({ ctx, body }) => createDelegation(ctx, body));
route('DELETE', '/delegations/:id', async ({ ctx, params }) => revokeDelegation(ctx, params.id), { noBody: true });

route('GET', '/templates', async ({ ctx, query }) => listTemplates(ctx, { level: query.level, departmentId: query.departmentId }));
route('POST', '/templates', async ({ ctx, body }) => createTemplate(ctx, body));
route('POST', '/templates/from-goal', async ({ ctx, body }) => createTemplateFromGoal(ctx, (body as any)?.goalId ?? '', (body as any)?.name ?? ''));
route('DELETE', '/templates/:id', async ({ ctx, params }) => archiveTemplate(ctx, params.id), { noBody: true });

// ---------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------
route('GET', '/checkins', async ({ ctx, query }) => listMyCheckins(ctx, query.asOf));
route('GET', '/checkins/team', async ({ ctx, query }) => listTeamCheckins(ctx, { periodId: query.periodId, state: query.state, asOf: query.asOf }));
route('GET', '/checkins/action-items', async ({ ctx, query }) => listActionItems(ctx, { status: query.status }));
route('PATCH', '/checkins/action-items/:id', async ({ ctx, params, body }) => setActionItemStatus(ctx, params.id, (body as any)?.status));
route('GET', '/checkins/:goalId/:periodId', async ({ ctx, params, query }) => getCheckin(ctx, params.goalId, params.periodId, query.asOf));
route('PUT', '/checkins/:goalId/:periodId', async ({ ctx, params, body }) => saveCheckinDraft(ctx, params.goalId, params.periodId, body));
route('POST', '/checkins/:goalId/:periodId/submit', async ({ ctx, params, body }) => submitCheckin(ctx, params.goalId, params.periodId, body), { idempotent: true });
route('POST', '/checkins/:id/review', async ({ ctx, params, body }) => reviewCheckin(ctx, params.id, body));
route('POST', '/checkins/:id/reopen', async ({ ctx, params, body }) => reopenCheckin(ctx, params.id, (body as any)?.reason ?? ''));

// ---------------------------------------------------------------------------
// Notifications, analytics, exports, audit
// ---------------------------------------------------------------------------
route('GET', '/notifications', async ({ ctx, query }) => listNotifications(ctx, { unreadOnly: bool(query.unread), limit: num(query.limit), offset: num(query.offset) }));
route('POST', '/notifications/read', async ({ ctx, body }) => markRead(ctx, (body as any)?.ids ?? 'all'));
route('GET', '/notification-preferences', async ({ ctx }) => getPreferences(ctx));
route('PUT', '/notification-preferences', async ({ ctx, body }) => setPreferences(ctx, body));

const analyticsQuery = (q: Record<string, string>) => ({ cycleId: q.cycleId, departmentId: q.departmentId, teamId: q.teamId, ownerId: q.ownerId, periodId: q.periodId, status: csvList(q.status), level: csvList(q.level), asOf: q.asOf });
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
route('GET', '/analytics', async ({ ctx, query }) => getAnalytics(ctx, clean(analyticsQuery(query))));
route('GET', '/analytics/workload', async ({ ctx }) => managerWorkload(ctx));

route('GET', '/exports/goals.csv', async ({ ctx, query }) => file(await exportGoalsCsv(ctx, { cycleId: query.cycleId, status: csvList(query.status), level: csvList(query.level), departmentId: query.departmentId, teamId: query.teamId, ownerId: query.ownerId }), 'text/csv; charset=utf-8', 'goals.csv'), { limit: { max: 10, windowSec: 60, scope: 'export' } });
route('GET', '/exports/checkins.csv', async ({ ctx, query }) => file(await exportCheckinsCsv(ctx, { periodId: query.periodId, asOf: query.asOf }), 'text/csv; charset=utf-8', 'checkins.csv'), { limit: { max: 10, windowSec: 60, scope: 'export' } });
route('GET', '/exports/audit.csv', async ({ ctx, query }) => file(await exportAuditCsv(ctx, { action: query.action, entityType: query.entityType, entityId: query.entityId, actorId: query.actorId, from: query.from, to: query.to, q: query.q }), 'text/csv; charset=utf-8', 'audit.csv'), { limit: { max: 5, windowSec: 60, scope: 'export' } });
route('GET', '/exports/summary.pdf', async ({ ctx, query }) => file(await exportSummaryPdf(ctx, clean(analyticsQuery(query))), 'application/pdf', 'plumeo-summary.pdf'), { limit: { max: 10, windowSec: 60, scope: 'export' } });

route('GET', '/audit', async ({ ctx, query }) => searchAudit(ctx, { q: query.q, action: query.action, entityType: query.entityType, entityId: query.entityId, actorId: query.actorId, from: query.from, to: query.to, limit: num(query.limit), beforeSeq: num(query.beforeSeq) }));
route('GET', '/audit/verify', async ({ ctx }) => verifyAuditChain(ctx));

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
route('GET', '/integrations/sso', async ({ ctx }) => (await getIdentityProvider(ctx)) ?? null);
route('PUT', '/integrations/sso', async ({ ctx, body }) => saveIdentityProvider(ctx, body));
route('DELETE', '/integrations/sso', async ({ ctx }) => removeIdentityProvider(ctx), { noBody: true });
route('GET', '/integrations/scim-tokens', async ({ ctx }) => listScimTokens(ctx));
route('POST', '/integrations/scim-tokens', async ({ ctx, body }) => createScimToken(ctx, (body as any)?.name));
route('DELETE', '/integrations/scim-tokens/:id', async ({ ctx, params }) => revokeScimToken(ctx, params.id), { noBody: true });
route('GET', '/integrations/webhooks', async ({ ctx }) => listWebhooks(ctx));
route('POST', '/integrations/webhooks', async ({ ctx, body }) => createWebhook(ctx, body));
route('PATCH', '/integrations/webhooks/:id', async ({ ctx, params, body }) => setWebhookEnabled(ctx, params.id, !!(body as any)?.enabled));
route('DELETE', '/integrations/webhooks/:id', async ({ ctx, params }) => deleteWebhook(ctx, params.id), { noBody: true });
route('POST', '/integrations/webhooks/:id/test', async ({ ctx, params }) => sendWebhookTest(ctx, params.id), { noBody: true });
route('GET', '/integrations/deliveries', async ({ ctx }) => { requirePerm(ctx, 'integrations.manage'); return deliveryStats(ctx); });
route('GET', '/integrations/capabilities', async ({ ctx }) => {
  requirePerm(ctx, 'integrations.manage');
  const { mailEnabled } = await import('../services/mailer');
  return { email: mailEnabled(), ai: !!config().GROQ_API_KEY, scimBaseUrl: `${config().APP_URL}/api/scim/v2`, ssoRedirectUri: `${config().APP_URL}/api/v1/auth/sso/callback` };
});

// ---------------------------------------------------------------------------
// AI assistance (opt-in, advisory only)
// ---------------------------------------------------------------------------
route('POST', '/ai/refine', async ({ ctx, body }) => suggestRefinement(ctx, body));
route('POST', '/ai/checkin-summary', async ({ ctx, body }) => summarizeGoalCheckins(ctx, (body as any)?.goalId ?? ''));
route('POST', '/ai/feedback', async ({ ctx, body }) => suggestFeedback(ctx, (body as any)?.goalId ?? '', (body as any)?.periodId ?? ''));

// ---------------------------------------------------------------------------
// Scheduled work (called by a scheduler with the shared secret, or by the bundled worker)
// ---------------------------------------------------------------------------
async function cronAuth(a: HandlerArgs) {
  const secret = config().CRON_SECRET;
  const given = a.req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !safeEqual(secret, given)) throw new AppError('unauthenticated', 'Invalid scheduler credentials.');
}
route('POST', '/jobs/run', async (a) => { await cronAuth(a); return runScheduledJobs(); }, { public: true, noBody: true });
route('GET', '/jobs/run', async (a) => { await cronAuth(a); return runScheduledJobs(); }, { public: true });

export { can, createSession };
