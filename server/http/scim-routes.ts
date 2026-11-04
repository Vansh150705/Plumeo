import { clientIp } from './framework';
import { logger } from '../core/logger';
import {
  SCIM_ERROR, ScimError, authenticateScim, scimCreateUser, scimDeleteUser, scimGetUser, scimListUsers, scimPatchUser, scimReplaceUser, scimServiceProviderConfig,
} from '../services/scim';

const res = (status: number, body: unknown) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/scim+json', 'cache-control': 'no-store' } });
const err = (status: number, detail: string, scimType?: string) => res(status, { schemas: [SCIM_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) });

/** SCIM 2.0 endpoint: /api/scim/v2/{ServiceProviderConfig,Users,Users/:id}. Bearer-token authenticated, tenant bound to the token. */
export async function handleScim(req: Request, requestId: string, prefix = '/api/scim/v2'): Promise<Response> {
  try {
    const parts = new URL(req.url).pathname.slice(prefix.length).split('/').filter(Boolean);
    const ctx = await authenticateScim(req.headers.get('authorization'), requestId, clientIp(req));
    const url = new URL(req.url);
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await req.json().catch(() => { throw new ScimError(400, 'Invalid JSON', 'invalidSyntax'); }) : undefined;
    if (parts[0] === 'ServiceProviderConfig' && req.method === 'GET') return res(200, scimServiceProviderConfig());
    if (parts[0] === 'Users') {
      if (parts.length === 1 && req.method === 'GET') return res(200, await scimListUsers(ctx, { filter: url.searchParams.get('filter') ?? undefined, startIndex: Number(url.searchParams.get('startIndex')) || 1, count: url.searchParams.get('count') ? Number(url.searchParams.get('count')) : 100 }));
      if (parts.length === 1 && req.method === 'POST') return res(201, await scimCreateUser(ctx, body));
      if (parts.length === 2 && req.method === 'GET') return res(200, await scimGetUser(ctx, parts[1]));
      if (parts.length === 2 && req.method === 'PUT') return res(200, await scimReplaceUser(ctx, parts[1], body));
      if (parts.length === 2 && req.method === 'PATCH') return res(200, await scimPatchUser(ctx, parts[1], body));
      if (parts.length === 2 && req.method === 'DELETE') { await scimDeleteUser(ctx, parts[1]); return res(204, null); }
    }
    return err(404, 'Resource type not supported. Only Users are implemented.');
  } catch (e) {
    if (e instanceof ScimError) return err(e.status, e.message, e.scimType);
    logger.error('scim.unhandled', { requestId, err: e });
    return err(500, 'Internal error');
  }
}
