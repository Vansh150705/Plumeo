import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { withOrg, withSystem } from '../db/pool';
import { AppError } from '../core/errors';
import { config } from '../core/config';
import { decryptSecret, randomToken, sha256 } from '../core/crypto';
import { logger } from '../core/logger';
import { audit } from '../services/audit';
import { grantRoleUnchecked } from '../services/rbac';
import { assertIssuerAllowed } from '../services/integrations';
import { createSession } from './sessions';
import { rateLimit } from './ratelimit';
import type { Ctx } from '../core/context';

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function discover(issuer: string): Promise<Discovery> {
  assertIssuerAllowed(issuer);
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.doc;
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!res.ok) throw new AppError('bad_request', 'Could not reach the identity provider.');
  const doc = (await res.json()) as Discovery;
  if (doc.issuer?.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new AppError('bad_request', 'Identity provider issuer mismatch.');
  for (const u of [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri]) assertIssuerAllowed(u);
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

export const redirectUri = () => `${config().APP_URL}/api/v1/auth/sso/callback`;
const b64url = (b: Buffer) => b.toString('base64url');

/** Step 1: build the IdP authorization URL (Authorization Code + PKCE + state + nonce). */
export async function startSso(orgSlug: string, meta: { ip?: string }) {
  await rateLimit('sso-start', meta.ip ?? 'unknown', 30, 600);
  const idp = await withSystem((tx) => tx.one<any>(
    `select i.*, o.id as oid from identity_providers i join orgs o on o.id = i.org_id where o.slug = $1 and o.status = 'active' and i.enabled`, [orgSlug.toLowerCase()]));
  if (!idp) throw new AppError('not_found', 'Single sign-on is not set up for that organisation.');
  const d = await discover(idp.issuer);
  const state = randomToken(24), nonce = randomToken(24), verifier = b64url(randomBytes(48));
  await withOrg(idp.oid, (tx) => tx.exec(
    `insert into auth_flows (org_id, state_hash, nonce, code_verifier, expires_at) values ($1,$2,$3,$4, now() + interval '10 minutes')`, [idp.oid, sha256(state), nonce, verifier]));
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: idp.client_id, redirect_uri: redirectUri(), scope: idp.scopes, state, nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString() };
}

/** Step 2: exchange the code, verify the ID token, then link / provision the user and open a session. */
export async function finishSso(params: { code?: string; state?: string; error?: string }, meta: { ip?: string; userAgent?: string; requestId: string }) {
  if (params.error || !params.code || !params.state) throw new AppError('unauthenticated', 'Single sign-on was cancelled or failed.');
  await rateLimit('sso-cb', meta.ip ?? 'unknown', 60, 600);
  const flow = await withSystem((tx) => tx.one<any>(
    `delete from auth_flows where state_hash = $1 and expires_at > now() returning org_id, nonce, code_verifier`, [sha256(params.state!)]));
  if (!flow) throw new AppError('unauthenticated', 'This sign-in attempt has expired. Please start again.');
  const idp = await withOrg(flow.org_id, (tx) => tx.one<any>('select * from identity_providers where org_id = $1 and enabled', [flow.org_id]));
  if (!idp) throw new AppError('unauthenticated', 'Single sign-on is not enabled.');
  const d = await discover(idp.issuer);

  const body = new URLSearchParams({ grant_type: 'authorization_code', code: params.code, redirect_uri: redirectUri(), client_id: idp.client_id, client_secret: decryptSecret(idp.client_secret_enc), code_verifier: flow.code_verifier });
  const tokenRes = await fetch(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!tokenRes.ok) { logger.warn('sso.token_exchange_failed', { status: tokenRes.status }); throw new AppError('unauthenticated', 'The identity provider rejected the sign-in.'); }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw new AppError('unauthenticated', 'The identity provider did not return an ID token.');

  let jwks = jwksCache.get(d.jwks_uri);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(d.jwks_uri), { cooldownDuration: 30_000 }); jwksCache.set(d.jwks_uri, jwks); }
  let claims: Record<string, any>;
  try {
    const v = await jwtVerify(tokens.id_token, jwks, { issuer: idp.issuer.replace(/\/$/, ''), audience: idp.client_id, clockTolerance: 30 });
    claims = v.payload as Record<string, any>;
  } catch (e) {
    logger.warn('sso.id_token_invalid', { err: e });
    throw new AppError('unauthenticated', 'The identity provider\'s response could not be verified.');
  }
  if (claims.nonce !== flow.nonce) throw new AppError('unauthenticated', 'Sign-in could not be verified (nonce).');
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase();
  if (!claims.sub || !email.includes('@')) throw new AppError('unauthenticated', 'The identity provider did not share an email address.');
  if (claims.email_verified === false) throw new AppError('unauthenticated', 'Your email address is not verified with the identity provider.');
  const domain = email.split('@')[1];
  if (idp.allowed_domains.length && !idp.allowed_domains.includes(domain)) throw new AppError('forbidden', 'Your email domain is not allowed for this organisation.');

  const orgId: string = flow.org_id;
  const user = await withOrg(orgId, async (tx) => {
    let u = await tx.one<any>('select id, full_name, status, oidc_subject from users where org_id = $1 and oidc_subject = $2 for update', [orgId, claims.sub]);
    const sysCtx: Ctx = { orgId, userId: '00000000-0000-0000-0000-000000000000', userName: 'SSO', perms: new Set(), roleKeys: [], requestId: meta.requestId, actorType: 'system', ip: meta.ip };
    if (!u) {
      u = await tx.one<any>('select id, full_name, status, oidc_subject from users where org_id = $1 and email = $2 for update', [orgId, email]);
      if (u) {
        if (u.oidc_subject && u.oidc_subject !== claims.sub) throw new AppError('forbidden', 'This account is linked to a different identity.');
        await tx.exec(`update users set oidc_subject = $3, status = case when status = 'invited' then 'active' else status end where org_id = $1 and id = $2`, [orgId, u.id, claims.sub]);
        if (u.status === 'invited') u.status = 'active';
        await audit(tx, sysCtx, { action: 'auth.sso_linked', entityType: 'user', entityId: u.id });
      } else if (idp.jit_provisioning) {
        const name = String(claims.name ?? email.split('@')[0]).slice(0, 120);
        u = await tx.one<any>(`insert into users (org_id, email, full_name, status, oidc_subject) values ($1,$2,$3,'active',$4) returning id, full_name, status`, [orgId, email, name, claims.sub]);
        await grantRoleUnchecked(tx, orgId, u.id, 'employee', null);
        await audit(tx, sysCtx, { action: 'user.created', entityType: 'user', entityId: u.id, after: { roles: ['employee'], source: 'sso_jit' } });
      } else {
        throw new AppError('forbidden', 'No Plumeo account exists for your email. Ask your administrator to add you.');
      }
    }
    if (u.status !== 'active') throw new AppError('forbidden', 'This account is not active.');
    return u;
  });
  const session = await createSession(orgId, user.id, 'oidc', meta);
  await withOrg(orgId, async (tx) => {
    await tx.exec('update users set last_login_at = now() where org_id = $1 and id = $2', [orgId, user.id]);
    await audit(tx, { orgId, userId: user.id, userName: user.full_name, perms: new Set(), roleKeys: [], requestId: meta.requestId, actorType: 'user', ip: meta.ip }, { action: 'auth.login', entityType: 'user', entityId: user.id, metadata: { method: 'oidc' } });
  });
  return session;
}
