'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

/**
 * MOCK MICROSOFT ENTRA ID (AZURE AD) SSO
 * ---------------------------------------------------------------------------
 * BRD §5.1 bonus. In a real deployment this entire file is replaced by a
 * call to Microsoft Graph's /me endpoint after an OAuth code exchange:
 *
 *   GET https://graph.microsoft.com/v1.0/me
 *   -> { id, userPrincipalName, displayName, jobTitle, department,
 *        memberOf: [{ displayName: 'Managers-L1' }, ...] }
 *
 * The contract here mirrors that response shape, so swapping mock → real is
 * one HTTP call away. Role mapping below is identical to what a real
 * production Entra integration would do.
 * ---------------------------------------------------------------------------
 */

export type EntraClaims = {
  oid: string;
  upn: string;
  displayName: string;
  department: string;
  jobTitle: string;
  memberOf: string[];      // Entra group display names
  managerOid: string | null;
};

/** Mock directory — what Microsoft Graph would return for our demo tenant. */
const MOCK_DIRECTORY: EntraClaims[] = [
  { oid: 'aad-9001', upn: 'priya.shah@atomquest.io',     displayName: 'Priya Shah',     department: 'HR',          jobTitle: 'HR Director',         memberOf: ['HR-Admins','All-Employees'],                managerOid: null },
  { oid: 'aad-9002', upn: 'arjun.mehta@atomquest.io',    displayName: 'Arjun Mehta',    department: 'Sales',       jobTitle: 'Sales Director',      memberOf: ['Managers-L1','Sales','All-Employees'],      managerOid: null },
  { oid: 'aad-9003', upn: 'lakshmi.r@atomquest.io',      displayName: 'Lakshmi Raman',  department: 'Engineering', jobTitle: 'Engineering Director',memberOf: ['Managers-L1','Engineering','All-Employees'],managerOid: null },
  { oid: 'aad-9004', upn: 'rohan.k@atomquest.io',        displayName: 'Rohan Kapoor',   department: 'Sales',       jobTitle: 'Account Executive',   memberOf: ['Sales','All-Employees'],                    managerOid: 'aad-9002' },
  { oid: 'aad-9005', upn: 'neha.iyer@atomquest.io',      displayName: 'Neha Iyer',      department: 'Sales',       jobTitle: 'Account Executive',   memberOf: ['Sales','All-Employees'],                    managerOid: 'aad-9002' },
  { oid: 'aad-9006', upn: 'kabir.malhotra@atomquest.io', displayName: 'Kabir Malhotra', department: 'Engineering', jobTitle: 'Senior Engineer',     memberOf: ['Engineering','All-Employees'],              managerOid: 'aad-9003' },
  { oid: 'aad-9007', upn: 'ananya.s@atomquest.io',       displayName: 'Ananya Sharma',  department: 'Engineering', jobTitle: 'Engineer',            memberOf: ['Engineering','All-Employees'],              managerOid: 'aad-9003' },
];

export async function getMockDirectory() {
  return MOCK_DIRECTORY;
}

/** Maps Entra group membership to our internal user_role. */
function roleFromGroups(groups: string[]): 'Admin' | 'Manager' | 'Employee' {
  if (groups.includes('HR-Admins')) return 'Admin';
  if (groups.includes('Managers-L1')) return 'Manager';
  return 'Employee';
}

/**
 * Simulates the post-OAuth callback. In production this runs server-side after
 * exchanging an authorization code for an id_token + access_token, calling
 * /me, then provisioning. Here we shortcut to the same outcome.
 */
export async function ssoSignIn(oid: string) {
  const claims = MOCK_DIRECTORY.find(u => u.oid === oid);
  if (!claims) throw new Error('USER_NOT_IN_DIRECTORY');

  const admin = createAdminClient();
  const supabase = createClient();

  // 1. Find-or-create auth.user by email
  let userId: string | null = null;
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing.users.find((u: any) => u.email === claims.upn);
  if (found) {
    userId = found.id;
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: claims.upn,
      password: 'demo-' + claims.oid,
      email_confirm: true,
      user_metadata: { entra_oid: claims.oid, full_name: claims.displayName },
    });
    if (error) throw error;
    userId = created.user.id;
  }

  // 2. Upsert the app-side user row WITH role derived from group membership
  const role = roleFromGroups(claims.memberOf);
  await admin.from('users').upsert({
    id: userId,
    entra_oid: claims.oid,
    upn: claims.upn,
    full_name: claims.displayName,
    role,
    department: claims.department,
    entra_groups: claims.memberOf,
  });

  // 3. Sync org hierarchy — resolve manager via Entra managerOid
  if (claims.managerOid) {
    const mgrClaims = MOCK_DIRECTORY.find(u => u.oid === claims.managerOid);
    if (mgrClaims) {
      const { data: mgrAuth } = await admin.from('users').select('id').eq('entra_oid', mgrClaims.oid).maybeSingle();
      if (mgrAuth) {
        await admin.from('users').update({ manager_id: mgrAuth.id }).eq('id', userId!);
      }
    }
  }

  // 4. Sign the user in (password sign-in using the deterministic demo pwd)
  await supabase.auth.signInWithPassword({
    email: claims.upn,
    password: 'demo-' + claims.oid,
  });

  revalidatePath('/');

  // Route to the right home based on role
  if (role === 'Admin')   redirect('/admin');
  if (role === 'Manager') redirect('/manager');
  redirect('/employee');
}

/** Re-syncs every user's manager chain + role from Entra. Admin-only. */
export async function syncEntraDirectory() {
  const admin = createAdminClient();
  // Pass 1: upsert all users
  for (const claims of MOCK_DIRECTORY) {
    const role = roleFromGroups(claims.memberOf);
    const { data: existing } = await admin.from('users').select('id').eq('entra_oid', claims.oid).maybeSingle();
    if (!existing) continue; // not provisioned yet
    await admin.from('users').update({
      role,
      department: claims.department,
      entra_groups: claims.memberOf,
      full_name: claims.displayName,
    }).eq('id', existing.id);
  }
  // Pass 2: resolve manager chain
  for (const claims of MOCK_DIRECTORY) {
    if (!claims.managerOid) continue;
    const { data: self } = await admin.from('users').select('id').eq('entra_oid', claims.oid).maybeSingle();
    const { data: mgr }  = await admin.from('users').select('id').eq('entra_oid', claims.managerOid).maybeSingle();
    if (self && mgr) await admin.from('users').update({ manager_id: mgr.id }).eq('id', self.id);
  }
  revalidatePath('/admin');
  return { ok: true, synced: MOCK_DIRECTORY.length };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/');
}
