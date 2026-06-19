/*
 * Fills a fresh database with demo data so the app looks alive on first open.
 * Run it after the migrations:  npm run seed
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
 * Safe to run more than once - it wipes its own demo sheets before re-creating them.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// the same seven people as lib/auth.ts MOCK_DIRECTORY - keep the two in sync
const DIRECTORY = [
  { oid: 'aad-9001', upn: 'priya.shah@plumeo.io',     name: 'Priya Shah',     dept: 'HR',          role: 'Admin',    groups: ['HR-Admins','All-Employees'], mgr: null },
  { oid: 'aad-9002', upn: 'arjun.mehta@plumeo.io',    name: 'Arjun Mehta',    dept: 'Sales',       role: 'Manager',  groups: ['Managers-L1','Sales','All-Employees'], mgr: null },
  { oid: 'aad-9003', upn: 'lakshmi.r@plumeo.io',      name: 'Lakshmi Raman',  dept: 'Engineering', role: 'Manager',  groups: ['Managers-L1','Engineering','All-Employees'], mgr: null },
  { oid: 'aad-9004', upn: 'rohan.k@plumeo.io',        name: 'Rohan Kapoor',   dept: 'Sales',       role: 'Employee', groups: ['Sales','All-Employees'], mgr: 'aad-9002' },
  { oid: 'aad-9005', upn: 'neha.iyer@plumeo.io',      name: 'Neha Iyer',      dept: 'Sales',       role: 'Employee', groups: ['Sales','All-Employees'], mgr: 'aad-9002' },
  { oid: 'aad-9006', upn: 'kabir.malhotra@plumeo.io', name: 'Kabir Malhotra', dept: 'Engineering', role: 'Employee', groups: ['Engineering','All-Employees'], mgr: 'aad-9003' },
  { oid: 'aad-9007', upn: 'ananya.s@plumeo.io',       name: 'Ananya Sharma',  dept: 'Engineering', role: 'Employee', groups: ['Engineering','All-Employees'], mgr: 'aad-9003' },
] as const;

const PWD = (oid: string) => `demo-${oid}`;

async function main() {
  console.log('🌱 Seeding Plumeo demo data...\n');

  // 1. create or find the auth users, then mirror them into public.users
  console.log('1/5 Provisioning users...');
  const oidToUserId: Record<string, string> = {};

  // List existing users (we paginate if needed; for 7 demo users this is fine)
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const byEmail = new Map(list.users.map(u => [u.email, u.id]));

  for (const d of DIRECTORY) {
    let userId = byEmail.get(d.upn);
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: d.upn,
        password: PWD(d.oid),
        email_confirm: true,
        user_metadata: { entra_oid: d.oid, full_name: d.name },
      });
      if (error) { console.error(`  ✗ ${d.name}: ${error.message}`); continue; }
      userId = data.user.id;
    } else {
      // Reset password so demo creds keep working
      await admin.auth.admin.updateUserById(userId, { password: PWD(d.oid) });
    }
    oidToUserId[d.oid] = userId!;

    await admin.from('users').upsert({
      id: userId!,
      entra_oid: d.oid,
      upn: d.upn,
      full_name: d.name,
      role: d.role,
      department: d.dept,
      entra_groups: d.groups,
    });
    console.log(`  ✓ ${d.name} (${d.role})`);
  }

  // Manager chain pass-2
  for (const d of DIRECTORY) {
    if (!d.mgr) continue;
    await admin.from('users').update({ manager_id: oidToUserId[d.mgr] }).eq('id', oidToUserId[d.oid]);
  }

  // 2. grab the active cycle the migration created
  console.log('\n2/5 Loading active cycle...');
  const { data: cycle } = await admin.from('cycles').select('*').eq('is_active', true).single();
  if (!cycle) { console.error('No active cycle. Run 0002 migration first.'); process.exit(1); }
  console.log(`  ✓ ${cycle.name}`);

  // 3. one goal sheet per person, each parked in a different workflow state
  console.log('\n3/5 Creating goal sheets in various states...');

  // clear out sheets from a previous run so re-seeding stays predictable
  for (const d of DIRECTORY) {
    if (d.role === 'Admin') continue;
    await admin.from('goal_sheets').delete().eq('employee_id', oidToUserId[d.oid]).eq('cycle_id', cycle.id);
  }

  const upsertSheet = async (employeeOid: string, status: 'Draft' | 'Submitted' | 'Returned' | 'Approved') => {
    const employeeId = oidToUserId[employeeOid];
    const now = new Date();
    const payload: any = { cycle_id: cycle.id, employee_id: employeeId, status };
    if (status === 'Submitted') payload.submitted_at = new Date(now.getTime() - 5 * 86400000).toISOString();
    if (status === 'Returned') {
      payload.submitted_at = new Date(now.getTime() - 9 * 86400000).toISOString();
      payload.returned_at  = new Date(now.getTime() - 6 * 86400000).toISOString();
      payload.return_comment = 'Targets look optimistic; split the ARR goal into two more measurable sub-goals.';
    }
    if (status === 'Approved') {
      payload.submitted_at = new Date(now.getTime() - 30 * 86400000).toISOString();
      payload.approved_at  = new Date(now.getTime() - 28 * 86400000).toISOString();
      payload.locked_at    = new Date(now.getTime() - 28 * 86400000).toISOString();
      payload.approved_by  = oidToUserId[DIRECTORY.find(d => d.oid === employeeOid)!.mgr!];
    }
    const { data } = await admin.from('goal_sheets').insert(payload).select().single();
    return data;
  };

  // both managers get an approved sheet
  const arjunSheet = await upsertSheet('aad-9002', 'Approved');
  const lakshmiSheet = await upsertSheet('aad-9003', 'Approved');

  // employees land in a mix of states so every screen has something to show
  const rohanSheet = await upsertSheet('aad-9004', 'Draft');         // Incomplete (80% weight, 4 goals)
  const nehaSheet = await upsertSheet('aad-9005', 'Submitted');      // Awaiting approval
  const kabirSheet = await upsertSheet('aad-9006', 'Approved');      // Locked + has check-ins
  const ananyaSheet = await upsertSheet('aad-9007', 'Returned');     // Returned with comment

  // 4. the goals themselves, plus a couple of quarters of check-ins for Kabir
  console.log('\n4/5 Creating goals + check-ins...');

  type GoalSpec = {
    thrust_area: string; title: string; description?: string;
    uom: 'Numeric' | 'Percentage' | 'Timeline' | 'Zero';
    direction: 'min' | 'max' | 'timeline' | 'zero';
    target_numeric?: number; target_date?: string; weightage: number;
  };
  const addGoals = async (sheetId: string, specs: GoalSpec[]) => {
    const ids: string[] = [];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const { data } = await admin.from('goals').insert({
        sheet_id: sheetId,
        thrust_area: s.thrust_area,
        title: s.title,
        description: s.description ?? null,
        uom: s.uom, direction: s.direction,
        target_numeric: s.target_numeric ?? null,
        target_date: s.target_date ?? null,
        weightage: s.weightage,
        display_order: i,
      }).select().single();
      if (data) ids.push(data.id);
    }
    return ids;
  };

  // Arjun (Sales Director)
  const arjunGoalIds = await addGoals(arjunSheet.id, [
    { thrust_area: 'Revenue Growth', title: 'Hit ₹12 Cr team ARR', uom: 'Numeric', direction: 'min', target_numeric: 12_00_00_000, weightage: 40 },
    { thrust_area: 'Customer Experience', title: 'Team NPS ≥ 55', uom: 'Numeric', direction: 'min', target_numeric: 55, weightage: 25 },
    { thrust_area: 'People & Culture', title: 'Attrition < 8%', uom: 'Percentage', direction: 'max', target_numeric: 8, weightage: 20 },
    { thrust_area: 'Operational Excellence', title: 'Pipeline coverage 3x by Q3', uom: 'Numeric', direction: 'min', target_numeric: 3, weightage: 15 },
  ]);

  // Lakshmi (Engineering Director)
  const lakshmiGoalIds = await addGoals(lakshmiSheet.id, [
    { thrust_area: 'Innovation & Technology', title: 'Ship 4 major features', uom: 'Numeric', direction: 'min', target_numeric: 4, weightage: 30 },
    { thrust_area: 'Safety & Quality', title: 'Zero P0 production incidents', uom: 'Zero', direction: 'zero', weightage: 25 },
    { thrust_area: 'Operational Excellence', title: 'p95 API latency ≤ 250ms', uom: 'Numeric', direction: 'max', target_numeric: 250, weightage: 20 },
    { thrust_area: 'People & Culture', title: 'Eng. attrition < 10%', uom: 'Percentage', direction: 'max', target_numeric: 10, weightage: 15 },
    { thrust_area: 'Cost Optimisation', title: 'Reduce infra spend 12%', uom: 'Percentage', direction: 'min', target_numeric: 12, weightage: 10 },
  ]);

  // Mark Lakshmi's "Ship 4 features" as a shared origin we can cascade later
  await admin.from('goals').update({ is_shared_origin: true }).eq('id', lakshmiGoalIds[0]);

  // Rohan: Draft, only 4 goals, weightage = 80 (left incomplete on purpose)
  await addGoals(rohanSheet.id, [
    { thrust_area: 'Revenue Growth', title: 'Close ₹3.5 Cr new ARR', uom: 'Numeric', direction: 'min', target_numeric: 3_50_00_000, weightage: 35 },
    { thrust_area: 'Customer Experience', title: 'Personal NPS ≥ 60', uom: 'Numeric', direction: 'min', target_numeric: 60, weightage: 20 },
    { thrust_area: 'Operational Excellence', title: 'Demo-to-close < 45 days', uom: 'Numeric', direction: 'max', target_numeric: 45, weightage: 15 },
    { thrust_area: 'Innovation & Technology', title: 'Author 6 case studies', uom: 'Numeric', direction: 'min', target_numeric: 6, weightage: 10 },
  ]);

  // Neha: Submitted, 5 goals
  const nehaGoalIds = await addGoals(nehaSheet.id, [
    { thrust_area: 'Revenue Growth', title: 'Close ₹4.2 Cr new ARR', uom: 'Numeric', direction: 'min', target_numeric: 4_20_00_000, weightage: 35 },
    { thrust_area: 'Customer Experience', title: 'Personal NPS ≥ 65', uom: 'Numeric', direction: 'min', target_numeric: 65, weightage: 20 },
    { thrust_area: 'Operational Excellence', title: 'Win-rate ≥ 30%', uom: 'Percentage', direction: 'min', target_numeric: 30, weightage: 20 },
    { thrust_area: 'Risk & Compliance', title: 'All contracts reviewed within 5 days', uom: 'Timeline', direction: 'timeline', target_date: '2027-03-31', weightage: 15 },
    { thrust_area: 'People & Culture', title: 'Mentor 2 SDRs to BDR promotion', uom: 'Numeric', direction: 'min', target_numeric: 2, weightage: 10 },
  ]);

  // Kabir: Approved and locked, 6 goals plus Q1 and Q2 check-ins
  const kabirGoalIds = await addGoals(kabirSheet.id, [
    { thrust_area: 'Innovation & Technology', title: 'Ship payments redesign by Q3', uom: 'Timeline', direction: 'timeline', target_date: '2027-01-31', weightage: 25 },
    { thrust_area: 'Safety & Quality', title: 'Zero P0 incidents owned', uom: 'Zero', direction: 'zero', weightage: 20 },
    { thrust_area: 'Operational Excellence', title: 'PR cycle time ≤ 24h', uom: 'Numeric', direction: 'max', target_numeric: 24, weightage: 20 },
    { thrust_area: 'Innovation & Technology', title: 'Author 3 internal RFCs', uom: 'Numeric', direction: 'min', target_numeric: 3, weightage: 15 },
    { thrust_area: 'Customer Experience', title: 'Support tickets closed/quarter ≥ 40', uom: 'Numeric', direction: 'min', target_numeric: 40, weightage: 10 },
    { thrust_area: 'People & Culture', title: 'Mentor 2 juniors', uom: 'Numeric', direction: 'min', target_numeric: 2, weightage: 10 },
  ]);

  // Push Lakshmi's shared "Ship 4 features" to Kabir + Ananya (with weight 15 each)
  await admin.from('goals').insert([
    {
      sheet_id: kabirSheet.id,
      thrust_area: 'Innovation & Technology',
      title: 'Ship 4 major features',
      uom: 'Numeric', direction: 'min', target_numeric: 4,
      weightage: 10,  // recipient overrode default
      shared_origin_id: lakshmiGoalIds[0],
      is_shared_origin: false,
      display_order: 6,
    },
  ]);

  // Check-ins for Kabir (Q1 + Q2)
  await admin.from('check_ins').insert([
    { goal_id: kabirGoalIds[0], quarter: 'Q1', progress_status: 'OnTrack', employee_comment: 'Design review wrapped; building in flight.', computed_score: null },
    { goal_id: kabirGoalIds[1], quarter: 'Q1', zero_achieved: true, progress_status: 'OnTrack', computed_score: 100 },
    { goal_id: kabirGoalIds[2], quarter: 'Q1', actual_numeric: 22, progress_status: 'OnTrack', employee_comment: 'Down from 38h last quarter.', computed_score: Math.round(24/22 * 100) },
    { goal_id: kabirGoalIds[3], quarter: 'Q1', actual_numeric: 1, progress_status: 'OnTrack', computed_score: Math.round(1/3 * 100) },
    { goal_id: kabirGoalIds[4], quarter: 'Q1', actual_numeric: 47, progress_status: 'Completed', computed_score: 100, manager_comment: 'Above target, well done.' },
    { goal_id: kabirGoalIds[5], quarter: 'Q1', actual_numeric: 2, progress_status: 'Completed', computed_score: 100 },

    { goal_id: kabirGoalIds[0], quarter: 'Q2', progress_status: 'OnTrack', actual_date: '2027-01-15', computed_score: 100 },
    { goal_id: kabirGoalIds[1], quarter: 'Q2', zero_achieved: true, progress_status: 'Completed', computed_score: 100 },
    { goal_id: kabirGoalIds[2], quarter: 'Q2', actual_numeric: 20, progress_status: 'Completed', computed_score: 100 },
    { goal_id: kabirGoalIds[3], quarter: 'Q2', actual_numeric: 3, progress_status: 'Completed', computed_score: 100 },
    { goal_id: kabirGoalIds[4], quarter: 'Q2', actual_numeric: 42, progress_status: 'Completed', computed_score: 100 },
    { goal_id: kabirGoalIds[5], quarter: 'Q2', actual_numeric: 2, progress_status: 'Completed', computed_score: 100 },
  ]);

  // Ananya: Returned with a comment, only 3 goals
  await addGoals(ananyaSheet.id, [
    { thrust_area: 'Innovation & Technology', title: 'Ship checkout v2', uom: 'Timeline', direction: 'timeline', target_date: '2027-02-28', weightage: 50 },
    { thrust_area: 'Operational Excellence', title: 'Reduce build time 40%', uom: 'Percentage', direction: 'min', target_numeric: 40, weightage: 30 },
    { thrust_area: 'People & Culture', title: 'Pair 4h/week', uom: 'Numeric', direction: 'min', target_numeric: 4, weightage: 20 },
  ]);

  // 5. a few notifications and escalation events so the inboxes feel real
  console.log('\n5/5 Seeding notifications + escalations...');
  const now = new Date();

  // Notifications across channels
  await admin.from('notifications').insert([
    {
      recipient_id: oidToUserId['aad-9002'], channel: 'Email',
      subject: 'Neha Iyer submitted her goal sheet',
      body: 'Neha Iyer (Sales) submitted 5 goals for your review.',
      deep_link: '/manager/approvals',
      sent_at: new Date(now.getTime() - 5 * 86400000).toISOString(),
    },
    {
      recipient_id: oidToUserId['aad-9002'], channel: 'Teams',
      subject: 'Neha Iyer submitted her goal sheet',
      body: 'Adaptive card delivered to MS Teams. Review in goal portal.',
      deep_link: '/manager/approvals',
      sent_at: new Date(now.getTime() - 5 * 86400000).toISOString(),
    },
    {
      recipient_id: oidToUserId['aad-9006'], channel: 'Email',
      subject: 'Your goal sheet was approved',
      body: 'Lakshmi Raman approved your goals. Your sheet is now locked for the cycle.',
      deep_link: '/employee',
      sent_at: new Date(now.getTime() - 28 * 86400000).toISOString(),
      read_at: new Date(now.getTime() - 27 * 86400000).toISOString(),
    },
    {
      recipient_id: oidToUserId['aad-9007'], channel: 'Email',
      subject: 'Your goal sheet was returned for rework',
      body: 'Lakshmi Raman sent your sheet back with a comment.',
      deep_link: '/employee',
      sent_at: new Date(now.getTime() - 6 * 86400000).toISOString(),
    },
    {
      recipient_id: oidToUserId['aad-9006'], channel: 'Teams',
      subject: 'New shared goal: "Ship 4 major features"',
      body: 'Lakshmi Raman pushed a departmental goal to your sheet. Weightage adjustable.',
      deep_link: '/employee',
      sent_at: new Date(now.getTime() - 25 * 86400000).toISOString(),
    },
    {
      recipient_id: oidToUserId['aad-9001'], channel: 'InApp',
      subject: 'Escalation: Approval pending',
      body: 'Neha Iyer: submitted 5 days ago, still awaiting approval.',
      deep_link: '/admin/escalations',
      sent_at: null,
    },
    {
      recipient_id: oidToUserId['aad-9001'], channel: 'InApp',
      subject: 'Escalation: Goal sheet not submitted',
      body: 'Rohan Kapoor: still in Draft 12 days after the cycle opened.',
      deep_link: '/admin/escalations',
      sent_at: null,
    },
  ]);

  // Escalation events
  const { data: rules } = await admin.from('escalation_rules').select('*');
  const approvalRule = rules?.find(r => r.trigger_type === 'approval_pending' && r.escalate_to === 'Manager');
  const draftRule = rules?.find(r => r.trigger_type === 'goal_not_submitted' && r.escalate_to === 'Employee');
  if (approvalRule) {
    await admin.from('escalation_events').insert({
      rule_id: approvalRule.id,
      subject_id: oidToUserId['aad-9005'],
      sheet_id: nehaSheet.id,
      level: 'Manager',
      reason: 'Submitted 5 days ago, still awaiting approval.',
    });
  }
  if (draftRule) {
    await admin.from('escalation_events').insert({
      rule_id: draftRule.id,
      subject_id: oidToUserId['aad-9004'],
      sheet_id: rohanSheet.id,
      level: 'Employee',
      reason: 'Still in Draft 12 days after cycle opened.',
    });
  }

  console.log('\n✅ Seed complete!');
  console.log('\n📋 Demo credentials:');
  console.log('   Admin    →  priya.shah@plumeo.io       (password: demo-aad-9001)');
  console.log('   Manager  →  arjun.mehta@plumeo.io      (password: demo-aad-9002)');
  console.log('   Employee →  rohan.k@plumeo.io          (password: demo-aad-9004)');
  console.log('\nOr just click any tile in the SSO directory on the landing page, no password entry needed.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
