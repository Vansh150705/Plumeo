import { randomUUID } from 'node:crypto';
import { handleScim } from '@/server/http/scim-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: Request) => handleScim(req, randomUUID());
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
