import { dispatch } from '@/server/http/framework';
import '@/server/http/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: Request) => dispatch(req, '/api/v1');
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
