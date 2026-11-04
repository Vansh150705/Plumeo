import type { Tx } from '../db/pool';

export async function loadAccess(tx: Tx, orgId: string, userId: string) {
  const rows = await tx.query<{ key: string; permissions: string[] }>(
    `select r.key, r.permissions from user_roles ur join roles r on r.org_id = ur.org_id and r.id = ur.role_id
     where ur.org_id = $1 and ur.user_id = $2`, [orgId, userId]);
  const perms = new Set<string>();
  for (const r of rows) for (const p of r.permissions) perms.add(p);
  return { perms, roleKeys: rows.map((r) => r.key) };
}

