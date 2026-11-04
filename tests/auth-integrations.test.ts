import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { setupTestDb, teardownTestDb, makeOrg, activeCycle, goalInput, PASSWORD, ctxFor, type TestOrg } from './helpers';
import { resetConfigForTests } from '@/server/core/config';
import { withOrg, withSystem } from '@/server/db/pool';
import { AppError } from '@/server/core/errors';
import { changeOwnPassword, loginWithPassword, logout, redeemCredentialToken } from '@/server/auth/login';
import { createSession, resolveSession, revokeUserSessions } from '@/server/auth/sessions';
import { finishSso, startSso } from '@/server/auth/oidc';
import { createUser, resetUserPassword, setUserStatus } from '@/server/services/users';
import { saveIdentityProvider, createScimToken, revokeScimToken, createWebhook, listWebhooks, sendWebhookTest, WEBHOOK_EVENTS } from '@/server/services/integrations';
import { authenticateScim, scimCreateUser, scimDeleteUser, scimGetUser, scimListUsers, scimPatchUser, scimReplaceUser, ScimError, SCIM_ENTERPRISE } from '@/server/services/scim';
import { notify, processDeliveries, listNotifications, markRead, setPreferences, getPreferences } from '@/server/services/notifications';
import { setMailTransportForTests } from '@/server/services/mailer';
import { createGoal } from '@/server/services/goals';
import { submitGoal, decideApproval } from '@/server/services/approvals';
import { updatePolicy } from '@/server/services/orgs';
import { runScheduledJobs } from '@/server/services/jobs';
import { encryptSecret, decryptSecret, hashPassword, verifyPassword, passwordProblem } from '@/server/core/crypto';

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : e instanceof ScimError ? `scim${e.status}` : `error:${e.message}`));
const meta = (ip = '10.0.0.1') => ({ ip, userAgent: 'vitest', requestId: 'r-' + randomUUID().slice(0, 6) });
let org: TestOrg, other: TestOrg;

// ---- tiny fake OpenID provider --------------------------------------------------------------
let idp: http.Server, idpUrl = '', signKey: CryptoKey, jwk: any;
const codes = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown> }>();
let audienceOverride: string | null = null;

async function startIdp() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  signKey = privateKey; jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = http.createServer(async (req, res) => {
    const u = new URL(req.url!, idpUrl);
    if (u.pathname === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ issuer: idpUrl, authorization_endpoint: `${idpUrl}/authorize`, token_endpoint: `${idpUrl}/token`, jwks_uri: `${idpUrl}/jwks` }));
    }
    if (u.pathname === '/jwks') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ keys: [jwk] })); }
    if (u.pathname === '/token' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      const p = new URLSearchParams(body);
      const entry = codes.get(p.get('code') ?? '');
      const verifierOk = entry && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === entry.challenge;
      if (!entry || !verifierOk || p.get('client_secret') !== 'idp-secret') { res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
      codes.delete(p.get('code')!);
      const jwt = await new SignJWT({ ...entry.claims, nonce: entry.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(idpUrl).setAudience(audienceOverride ?? 'plumeo-client').setIssuedAt().setExpirationTime('5m').sign(signKey);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ id_token: jwt, access_token: 'x', token_type: 'Bearer' }));
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  idpUrl = `http://127.0.0.1:${(idp.address() as any).port}`;
}

/** Plays the browser: follow the authorize URL, the user "signs in", and the IdP issues a code. */
function idpAuthorize(authUrl: string, claims: Record<string, unknown>) {
  const u = new URL(authUrl);
  const code = randomUUID();
  codes.set(code, { nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')!, claims });
  return { code, state: u.searchParams.get('state')! };
}

// ---- webhook receiver -----------------------------------------------------------------------
let hook: http.Server, hookUrl = ''; const hookHits: any[] = []; let hookStatus = 200;
async function startHook() {
  hook = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; hookHits.push({ url: req.url, body: JSON.parse(b || '{}') }); res.statusCode = hookStatus; res.end('ok'); });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(hook.address() as any).port}`;
}

beforeAll(async () => {
  process.env.OIDC_ALLOW_INSECURE_HTTP = 'true';
  await startIdp(); await startHook();
  process.env.WEBHOOK_EXTRA_HOSTS = new URL(hookUrl).host;
  await setupTestDb();
  org = await makeOrg('authco'); other = await makeOrg('otherco');
});
afterAll(async () => { idp.close(); hook.close(); setMailTransportForTests(null); await teardownTestDb(); });

describe('crypto primitives', () => {
  it('hashes passwords with scrypt, verifies in constant shape, and encrypts secrets with AES-GCM', async () => {
    const h = await hashPassword('a decent passphrase 123');
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword('a decent passphrase 123', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    const enc = encryptSecret('top-secret'); expect(enc).not.toContain('top-secret');
    expect(decryptSecret(enc)).toBe('top-secret');
    expect(() => decryptSecret(enc.slice(0, -3) + 'AAA')).toThrow();
    expect(passwordProblem('short')).toBeTruthy(); expect(passwordProblem('aaaaaaaaaaaaaaaa')).toBeTruthy(); expect(passwordProblem(PASSWORD)).toBeNull();
  });
});

describe('password sign-in, sessions and account lifecycle', () => {
  it('signs in, resolves the session into a permission-bearing context and signs out', async () => {
    const s = await loginWithPassword({ orgSlug: 'authco', email: 'admin@authco.test', password: PASSWORD }, meta());
    const ctx = await resolveSession(s.token, { requestId: 'x' });
    expect(ctx).toMatchObject({ orgId: org.orgId, userName: 'Ada Admin' });
    expect(ctx!.perms.has('org.manage')).toBe(true);
    await logout(ctx!);
    expect(await resolveSession(s.token, { requestId: 'x' })).toBeNull();
    // the token itself is never stored
    const stored = await withOrg(org.orgId, (tx) => tx.query(`select token_hash from sessions`));
    expect(stored.every((r: any) => r.token_hash !== s.token)).toBe(true);
  });

  it('gives the same error for wrong password, unknown user and unknown organisation', async () => {
    const msgs = await Promise.all([
      loginWithPassword({ orgSlug: 'authco', email: 'admin@authco.test', password: 'nope-nope-nope' }, meta('10.0.1.1')).catch((e) => e.message),
      loginWithPassword({ orgSlug: 'authco', email: 'ghost@authco.test', password: PASSWORD }, meta('10.0.1.2')).catch((e) => e.message),
      loginWithPassword({ orgSlug: 'nowhere', email: 'admin@authco.test', password: PASSWORD }, meta('10.0.1.3')).catch((e) => e.message),
    ]);
    expect(new Set(msgs).size).toBe(1);
  });

  it('locks an account after repeated failures — even for the right password — and audits the attempts', async () => {
    const u = await org.add('Locky Person');
    for (let i = 0; i < 8; i++) await loginWithPassword({ orgSlug: 'authco', email: u.email, password: 'wrong-wrong-wrong' }, meta(`10.1.0.${i}`)).catch(() => {});
    const err: any = await loginWithPassword({ orgSlug: 'authco', email: u.email, password: PASSWORD }, meta('10.1.9.9')).catch((e) => e);
    expect(err.message).toMatch(/locked/i);
    const failed = await withOrg(org.orgId, (tx) => tx.query(`select 1 from audit_events where action = 'auth.login_failed' and entity_id = $1`, [u.id]));
    expect(failed.length).toBe(8);
  });

  it('rate-limits repeated attempts against one account regardless of source address', async () => {
    const results: string[] = [];
    for (let i = 0; i < 14; i++) results.push(await code(loginWithPassword({ orgSlug: 'authco', email: 'ratelimit@authco.test', password: 'whatever-whatever' }, meta(`10.2.0.${i}`))));
    expect(results).toContain('rate_limited');
  });

  it('expires sessions by idle time and absolute lifetime, and revokes them on deactivation or password change', async () => {
    const u = await org.add('Session Person');
    const a = await createSession(org.orgId, u.id, 'password', {}); const b = await createSession(org.orgId, u.id, 'password', {});
    await withOrg(org.orgId, (tx) => tx.exec(`update sessions set last_seen_at = now() - interval '9 hours' where id = $1`, [a.sessionId]));
    expect(await resolveSession(a.token, { requestId: 'x' })).toBeNull();          // idle > 8h default
    await withOrg(org.orgId, (tx) => tx.exec(`update sessions set expires_at = now() - interval '1 second' where id = $1`, [b.sessionId]));
    expect(await resolveSession(b.token, { requestId: 'x' })).toBeNull();          // absolute expiry
    const c = await createSession(org.orgId, u.id, 'password', {}); const d = await createSession(org.orgId, u.id, 'password', {});
    const ctx = (await resolveSession(c.token, { requestId: 'x' }))!;
    expect(await code(changeOwnPassword(ctx, { current: 'not-my-password', next: 'A brand new passphrase 77' }))).toBe('forbidden');
    const r = await changeOwnPassword(ctx, { current: PASSWORD, next: 'A brand new passphrase 77' });
    expect(r.otherSessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(d.token, { requestId: 'x' })).toBeNull();          // other session killed
    expect(await resolveSession(c.token, { requestId: 'x' })).not.toBeNull();      // current one survives
    await loginWithPassword({ orgSlug: 'authco', email: u.email, password: 'A brand new passphrase 77' }, meta('10.3.0.1'));
    await revokeUserSessions({ exec: (s, p) => withOrg(org.orgId, (tx) => tx.exec(s, p)) }, org.orgId, u.id);
    expect(await resolveSession(c.token, { requestId: 'x' })).toBeNull();
  });

  it('honours a shorter idle timeout from organisation policy', async () => {
    await updatePolicy(org.admin, { security: { sessionIdleMinutes: 15 } });
    const u = await org.add('Idle Person');
    const s = await createSession(org.orgId, u.id, 'password', {});
    await withOrg(org.orgId, (tx) => tx.exec(`update sessions set last_seen_at = now() - interval '20 minutes' where id = $1`, [s.sessionId]));
    expect(await resolveSession(s.token, { requestId: 'x' })).toBeNull();
    await updatePolicy(org.admin, {});
  });

  it('invitation and reset links are single-use, expire, and enforce the password policy', async () => {
    const created = await createUser(org.admin, { email: 'newhire@authco.test', fullName: 'New Hire' });
    expect(await code(loginWithPassword({ orgSlug: 'authco', email: 'newhire@authco.test', password: PASSWORD }, meta('10.4.0.1')))).toBe('unauthenticated'); // not active yet
    expect(await code(redeemCredentialToken({ token: created.inviteToken!, password: 'short' }, meta()))).toBe('validation_failed');
    await redeemCredentialToken({ token: created.inviteToken!, password: PASSWORD }, meta());
    expect(await code(redeemCredentialToken({ token: created.inviteToken!, password: PASSWORD }, meta()))).toBe('unauthenticated'); // already used
    await loginWithPassword({ orgSlug: 'authco', email: 'newhire@authco.test', password: PASSWORD }, meta('10.4.0.2'));
    const reset = await resetUserPassword(org.admin, created.id);
    await withOrg(org.orgId, (tx) => tx.exec(`update credential_tokens set expires_at = now() - interval '1 minute' where user_id = $1 and used_at is null`, [created.id]));
    expect(await code(redeemCredentialToken({ token: reset.token, password: PASSWORD }, meta()))).toBe('unauthenticated'); // expired
    const tokens = await withOrg(org.orgId, (tx) => tx.query(`select token_hash from credential_tokens where user_id = $1`, [created.id]));
    expect(tokens.every((t: any) => t.token_hash !== reset.token)).toBe(true);
  });

  it('suspended organisations cannot sign in', async () => {
    const { setOrgStatus } = await import('@/server/services/orgs');
    await setOrgStatus(other.orgId, 'suspended', randomUUID(), 'r');
    expect(await code(loginWithPassword({ orgSlug: 'otherco', email: 'admin@otherco.test', password: PASSWORD }, meta('10.5.0.1')))).toBe('unauthenticated');
    await setOrgStatus(other.orgId, 'active', randomUUID(), 'r');
    expect(await code(loginWithPassword({ orgSlug: 'otherco', email: 'admin@otherco.test', password: PASSWORD }, meta('10.5.0.2')))).toBe('ok');
  });
});

describe('single sign-on (OIDC, tested against a local fake provider)', () => {
  beforeAll(async () => {
    resetConfigForTests();
    await saveIdentityProvider(org.admin, { issuer: idpUrl, clientId: 'plumeo-client', clientSecret: 'idp-secret', allowedDomains: ['authco.test'], jitProvisioning: false, enforceSso: false, enabled: true });
  });

  it('never stores the client secret in clear text', async () => {
    const row = await withOrg(org.orgId, (tx) => tx.one<any>('select client_secret_enc from identity_providers'));
    expect(row.client_secret_enc).not.toContain('idp-secret');
    expect(decryptSecret(row.client_secret_enc)).toBe('idp-secret');
  });

  it('completes Authorization Code + PKCE, links the existing account and opens a session', async () => {
    const u = await org.add('Sso Person');
    const { url } = await startSso('authco', {});
    const { code, state } = idpAuthorize(url, { sub: 'idp|123', email: u.email, name: 'Sso Person', email_verified: true });
    const s = await finishSso({ code, state }, meta());
    const ctx = await resolveSession(s.token, { requestId: 'x' });
    expect(ctx!.userId).toBe(u.id);
    const linked = await withOrg(org.orgId, (tx) => tx.one<any>('select oidc_subject from users where id = $1', [u.id]));
    expect(linked.oidc_subject).toBe('idp|123');
    // the state is single use
    expect(await code2(finishSso({ code: 'x', state }, meta()))).toBe('unauthenticated');
  });

  it('rejects bad logins: tampered nonce, wrong audience, unverified email, foreign domain, unknown user', async () => {
    const u = await org.add('Strict Person');
    let flow = await startSso('authco', {});
    let a = idpAuthorize(flow.url, { sub: 'idp|9', email: u.email });
    codes.get(a.code)!.nonce = 'attacker-nonce';
    expect(await code2(finishSso(a, meta()))).toBe('unauthenticated');

    audienceOverride = 'someone-elses-client';
    flow = await startSso('authco', {}); a = idpAuthorize(flow.url, { sub: 'idp|9', email: u.email });
    expect(await code2(finishSso(a, meta()))).toBe('unauthenticated');
    audienceOverride = null;

    flow = await startSso('authco', {}); a = idpAuthorize(flow.url, { sub: 'idp|9', email: u.email, email_verified: false });
    expect(await code2(finishSso(a, meta()))).toBe('unauthenticated');

    flow = await startSso('authco', {}); a = idpAuthorize(flow.url, { sub: 'idp|9', email: 'attacker@evil.test' });
    expect(await code2(finishSso(a, meta()))).toBe('forbidden');

    flow = await startSso('authco', {}); a = idpAuthorize(flow.url, { sub: 'idp|10', email: 'nobody@authco.test' });
    expect(await code2(finishSso(a, meta()))).toBe('forbidden');            // no JIT, no account
  });

  it('refuses a PKCE downgrade (code redeemed with a different verifier)', async () => {
    const u = await org.add('Pkce Person');
    const flow = await startSso('authco', {});
    const a = idpAuthorize(flow.url, { sub: 'idp|77', email: u.email });
    codes.get(a.code)!.challenge = 'not-the-real-challenge';
    expect(await code2(finishSso(a, meta()))).toBe('unauthenticated');
  });

  it('provisions users just-in-time only when the admin enabled it, and never reuses a subject for another account', async () => {
    await saveIdentityProvider(org.admin, { issuer: idpUrl, clientId: 'plumeo-client', allowedDomains: ['authco.test'], jitProvisioning: true, enforceSso: false, enabled: true });
    const flow = await startSso('authco', {});
    const a = idpAuthorize(flow.url, { sub: 'idp|jit', email: 'jit.person@authco.test', name: 'Jit Person' });
    const s = await finishSso(a, meta());
    const ctx = (await resolveSession(s.token, { requestId: 'x' }))!;
    expect(ctx.roleKeys).toEqual(['employee']);
    const other2 = await org.add('Hijack Target');
    const f2 = await startSso('authco', {}); const a2 = idpAuthorize(f2.url, { sub: 'idp|jit', email: other2.email });
    const s2 = await finishSso(a2, meta());
    expect((await resolveSession(s2.token, { requestId: 'x' }))!.userId).toBe(ctx.userId);   // the subject → its own account, never the claimed email's
  });

  it('cannot enforce SSO before it has been proven, and enforcement spares administrators (break-glass)', async () => {
    const e1 = await code(saveIdentityProvider(other.admin, { issuer: idpUrl, clientId: 'plumeo-client', clientSecret: 'idp-secret', allowedDomains: [], jitProvisioning: false, enforceSso: true, enabled: true }));
    expect(e1).toBe('conflict');
    await saveIdentityProvider(org.admin, { issuer: idpUrl, clientId: 'plumeo-client', allowedDomains: ['authco.test'], jitProvisioning: true, enforceSso: true, enabled: true });
    const u = await org.add('Password Person');
    expect(await code(loginWithPassword({ orgSlug: 'authco', email: u.email, password: PASSWORD }, meta('10.6.0.1')))).toBe('forbidden');
    expect(await code(loginWithPassword({ orgSlug: 'authco', email: 'admin@authco.test', password: PASSWORD }, meta('10.6.0.2')))).toBe('ok');
    await saveIdentityProvider(org.admin, { issuer: idpUrl, clientId: 'plumeo-client', allowedDomains: [], jitProvisioning: false, enforceSso: false, enabled: true });
  });

  it('rejects non-https issuers outside development', async () => {
    process.env.OIDC_ALLOW_INSECURE_HTTP = 'false'; resetConfigForTests();
    expect(await code(saveIdentityProvider(org.admin, { issuer: 'http://idp.example.com', clientId: 'c', clientSecret: 's', allowedDomains: [], jitProvisioning: false, enforceSso: false, enabled: true }))).toBe('validation_failed');
    process.env.OIDC_ALLOW_INSECURE_HTTP = 'true'; resetConfigForTests();
  });
});
const code2 = code;

describe('SCIM 2.0 provisioning', () => {
  let tokenA: string, scim: any;
  beforeAll(async () => { tokenA = (await createScimToken(org.admin, 'Entra provisioning')).token; scim = await authenticateScim(`Bearer ${tokenA}`, 'r'); });

  it('authenticates per-organisation bearer tokens and rejects bad, revoked and missing ones', async () => {
    expect(scim.orgId).toBe(org.orgId);
    expect(await code(authenticateScim(null, 'r'))).toBe('scim401');
    expect(await code(authenticateScim('Bearer plm_scim_' + 'x'.repeat(30), 'r'))).toBe('scim401');
    const t2 = await createScimToken(org.admin, 'temp');
    await revokeScimToken(org.admin, (await withOrg(org.orgId, (tx) => tx.one<any>(`select id from scim_tokens where name = 'temp'`))).id);
    expect(await code(authenticateScim(`Bearer ${t2.token}`, 'r'))).toBe('scim401');
    const row = await withOrg(org.orgId, (tx) => tx.one<any>(`select token_hash from scim_tokens where name = 'Entra provisioning'`));
    expect(row.token_hash).not.toContain(tokenA);
  });

  it('creates, reads, filters, updates, deactivates users — with manager mapping and audit', async () => {
    const boss = await scimCreateUser(scim, { userName: 'Boss.Person@authco.test', name: { givenName: 'Boss', familyName: 'Person' }, externalId: 'ext-boss', title: 'Director' });
    expect(boss).toMatchObject({ userName: 'boss.person@authco.test', active: true, externalId: 'ext-boss' });
    const rep = await scimCreateUser(scim, { userName: 'rep@authco.test', displayName: 'Rep Person', [SCIM_ENTERPRISE]: { employeeNumber: '42', manager: { value: boss.id } } });
    expect(rep[SCIM_ENTERPRISE]).toMatchObject({ employeeNumber: '42', manager: { value: boss.id } });
    expect(await code(scimCreateUser(scim, { userName: 'rep@authco.test', displayName: 'Dup' }))).toBe('scim409');
    const list = await scimListUsers(scim, { filter: 'userName eq "REP@authco.test"' });
    expect(list.totalResults).toBe(1);
    expect(await code(scimListUsers(scim, { filter: 'userName co "x"' }))).toBe('scim400');
    const patched = await scimPatchUser(scim, rep.id, { Operations: [{ op: 'Replace', path: 'title', value: 'Analyst' }, { op: 'replace', path: 'active', value: 'False' }] });
    expect(patched).toMatchObject({ title: 'Analyst', active: false });
    const replaced = await scimReplaceUser(scim, rep.id, { userName: 'rep@authco.test', displayName: 'Rep Renamed', active: true });
    expect(replaced).toMatchObject({ displayName: 'Rep Renamed', active: true });
    await scimDeleteUser(scim, boss.id);
    expect((await scimGetUser(scim, boss.id)).active).toBe(false);
    const events = await withOrg(org.orgId, (tx) => tx.query(`select action, actor_type, actor_id from audit_events where actor_type = 'scim' order by seq`));
    expect(events.map((e: any) => e.action)).toEqual(expect.arrayContaining(['user.created', 'user.updated', 'user.deactivated', 'user.reactivated']));
    expect(events.every((e: any) => e.actor_id === null)).toBe(true);
  });

  it('deactivation through SCIM kills live sessions immediately', async () => {
    const u = await org.add('Leaver');
    const s = await createSession(org.orgId, u.id, 'password', {});
    await scimPatchUser(scim, u.id, { Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(await resolveSession(s.token, { requestId: 'x' })).toBeNull();
  });

  it('is tenant-scoped: one organisation\'s token cannot see or modify another\'s users', async () => {
    const otherUser = await other.add('Other Tenant Person');
    expect(await code(scimGetUser(scim, otherUser.id))).toBe('scim404');
    expect(await code(scimPatchUser(scim, otherUser.id, { Operations: [{ op: 'replace', path: 'active', value: false }] }))).toBe('scim404');
    const all = await scimListUsers(scim, {});
    expect(all.Resources.some((r: any) => r.id === otherUser.id)).toBe(false);
  });

  it('refuses unsupported patch paths rather than silently ignoring them', async () => {
    const u = await org.add('Patch Target');
    expect(await code(scimPatchUser(scim, u.id, { Operations: [{ op: 'replace', path: 'roles', value: 'org_admin' }] }))).toBe('scim400');
  });
});

describe('notifications and reliable delivery', () => {
  let userA: any;
  beforeAll(async () => { userA = await org.add('Notified Person'); });

  it('de-duplicates by event key and honours per-category preferences', async () => {
    const n = (key?: string) => withOrg(org.orgId, (tx) => notify(tx, { orgId: org.orgId }, { userId: userA.id, category: 'goals', type: 't', title: 'Hello', body: 'World', dedupeKey: key }));
    expect(await n('same')).toBe(true); expect(await n('same')).toBe(false); expect(await n('other')).toBe(true);
    expect((await listNotifications(await userA.ctx(), {})).data).toHaveLength(2);
    await setPreferences(await userA.ctx(), [{ category: 'goals', in_app: false, email: false }]);
    expect(await n('muted')).toBe(true);
    expect((await listNotifications(await userA.ctx(), {})).data).toHaveLength(2);       // nothing new
    expect((await getPreferences(await userA.ctx())).find((p) => p.category === 'goals')).toMatchObject({ in_app: false });
    await setPreferences(await userA.ctx(), [{ category: 'goals', in_app: true, email: true }]);
    await markRead(await userA.ctx(), 'all');
    expect((await listNotifications(await userA.ctx(), { unreadOnly: true })).unread).toBe(0);
  });

  it('users only ever see and mark their own notifications', async () => {
    const mine = (await listNotifications(await userA.ctx(), {})).data[0];
    const intruder = await org.add('Nosy Person');
    expect((await listNotifications(await intruder.ctx(), {})).data).toHaveLength(0);
    expect((await markRead(await intruder.ctx(), [mine.id])).updated).toBe(0);
  });

  it('delivers email exactly once per recipient even with competing workers, and records status', async () => {
    const sent: string[] = [];
    setMailTransportForTests({ sendMail: async (m: any) => { sent.push(m.to + '|' + m.subject); } });
    const users = await Promise.all(Array.from({ length: 12 }, (_, i) => org.add(`Mail Person ${i}`)));
    await withOrg(org.orgId, async (tx) => { for (const [i, u] of users.entries()) await notify(tx, { orgId: org.orgId }, { userId: u.id, category: 'approvals', type: 't', title: `Subject ${i}`, body: 'Body', link: '/app/approvals', dedupeKey: `bulk:${i}` }); });
    const runs = await Promise.all([processDeliveries(50), processDeliveries(50), processDeliveries(50)]);
    expect(runs.reduce((a, r) => a + r.sent, 0)).toBeGreaterThanOrEqual(12);
    const mine = sent.filter((s) => s.includes('Subject'));
    expect(mine).toHaveLength(12);
    expect(new Set(mine).size).toBe(12);                                                  // no duplicates
    const st = await withOrg(org.orgId, (tx) => tx.query(`select status, count(*)::int as n from notification_deliveries where channel = 'email' group by status`));
    expect(st.some((r: any) => r.status === 'sent')).toBe(true);
    setMailTransportForTests(null);
  });

  it('retries failures with backoff and dead-letters after the attempt limit', async () => {
    let calls = 0;
    setMailTransportForTests({ sendMail: async () => { calls++; throw new Error('smtp down'); } });
    const u = await org.add('Unlucky Person');
    await withOrg(org.orgId, (tx) => notify(tx, { orgId: org.orgId }, { userId: u.id, category: 'org', type: 't', title: 'Retry me', body: 'b', dedupeKey: 'retry' }));
    let now = new Date();
    for (let i = 0; i < 7; i++) { await processDeliveries(50, now); now = new Date(now.getTime() + 7 * 3600_000); }
    const row = await withOrg(org.orgId, (tx) => tx.one<any>(`select status, attempts, last_error from notification_deliveries where user_id = $1`, [u.id]));
    expect(row).toMatchObject({ status: 'dead', attempts: 6, last_error: 'smtp down' });
    expect(calls).toBeGreaterThanOrEqual(6);
    setMailTransportForTests(null);
  });

  it('does not queue email when SMTP is not configured (status is honest, in-app still works)', async () => {
    const u = await org.add('No Smtp Person');
    await withOrg(org.orgId, (tx) => notify(tx, { orgId: org.orgId }, { userId: u.id, category: 'org', type: 't', title: 'In-app only', body: 'b', dedupeKey: 'noemail' }));
    expect((await listNotifications(await u.ctx(), {})).data).toHaveLength(1);
    expect(await withOrg(org.orgId, (tx) => tx.query(`select 1 from notification_deliveries where user_id = $1`, [u.id]))).toHaveLength(0);
  });

  it('posts organisation-level events to Slack/Teams webhooks, protects the URL and blocks SSRF targets', async () => {
    expect(await code(createWebhook(org.admin, { kind: 'slack', name: 'evil', url: 'http://169.254.169.254/latest/meta-data', events: ['goal.activated'] }))).toBe('validation_failed');
    expect(await code(createWebhook(org.admin, { kind: 'slack', name: 'evil', url: 'https://evil.example.com/hook', events: ['goal.activated'] }))).toBe('validation_failed');
    expect(await code(createWebhook(org.admin, { kind: 'teams', name: 'evil', url: 'https://hooks.slack.com/services/x', events: ['goal.activated'] }))).toBe('validation_failed');
    const w = await createWebhook(org.admin, { kind: 'slack', name: 'Company channel', url: `${hookUrl}/services/T000/B000/secret-part`, events: [...WEBHOOK_EVENTS] });
    const listed = JSON.stringify(await listWebhooks(org.admin));
    expect(listed).not.toContain('secret-part');
    const raw = await withOrg(org.orgId, (tx) => tx.one<any>('select url_enc from webhook_integrations where id = $1', [w.id]));
    expect(raw.url_enc).not.toContain('secret-part');

    await sendWebhookTest(org.admin, w.id);
    // a company goal being approved announces itself — and only org-level text, never personal data
    const hr = await org.add('Hannah HR', { roles: ['hr_admin'] });
    const { id } = await createGoal(await hr.ctx(), goalInput(await activeCycle(org.orgId), { level: 'company', title: 'Triple our customer base this year' }));
    await submitGoal(await hr.ctx(), id);
    const req = await withOrg(org.orgId, async (tx) => (await tx.one<any>(`select id from approval_requests where goal_id = $1 and status = 'pending'`, [id]))!.id);
    await decideApproval(org.admin, req, { decision: 'approve' });
    hookHits.length = 0;
    const r = await processDeliveries(50);
    expect(r.sent).toBeGreaterThanOrEqual(2);
    const texts = hookHits.map((h) => h.body.text).join('\n');
    expect(texts).toContain('connected');
    expect(texts).toContain('Triple our customer base this year');
    expect(texts).not.toMatch(/@authco\.test/);
    expect(hookHits[0].url).toBe('/services/T000/B000/secret-part');
  });

  it('retries failing webhooks and the scheduled job processes the outbox, sweeps reminders and purges old data', async () => {
    hookStatus = 500;
    const w = (await listWebhooks(org.admin))[0] as any;
    await sendWebhookTest(org.admin, w.id);
    const r1 = await processDeliveries(50);
    expect(r1.failed).toBeGreaterThanOrEqual(1);
    hookStatus = 200;
    const r2 = await processDeliveries(50, new Date(Date.now() + 10 * 60_000));
    expect(r2.sent).toBeGreaterThanOrEqual(1);
    await withOrg(org.orgId, (tx) => tx.exec(`insert into notifications (org_id, user_id, category, type, title, body, read_at, created_at) values ($1,$2,'org','old','old','old', now() - interval '200 days', now() - interval '200 days')`, [org.orgId, userA.id]));
    const job = await runScheduledJobs();
    expect(job).toMatchObject({ skipped: false });
    expect((job as any).purged).toBeGreaterThanOrEqual(1);
    const run = await withSystem((tx) => tx.one<any>(`select last_status from job_runs where name = 'scheduled'`));
    expect(run.last_status).toBe('ok');
  });
});
