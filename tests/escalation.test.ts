import { describe, expect, it } from 'vitest';
import { sweepEscalations } from '@/lib/escalation';

/** A tiny in-memory stand-in for the Supabase query builder: just the calls the sweep makes. */
function fakeDb(tables: Record<string, any[]>) {
  const inserted: Record<string, any[]> = {};
  const db = {
    inserted,
    from(name: string) {
      let rows = tables[name] ?? [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => r[c] >= v)), q),
        limit: () => q,
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        insert: (vals: any) => {
          (inserted[name] ??= []).push(...[].concat(vals));
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
  return db;
}

const DAY = 86400000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const HR = { id: 'hr', role: 'Admin', full_name: 'HR', manager_id: null };
const DIRECTOR = { id: 'dir', role: 'Manager', full_name: 'Director', manager_id: null };
const MANAGER = { id: 'mgr', role: 'Manager', full_name: 'Manager', manager_id: 'dir' };
const emp = (id: string) => ({ id, role: 'Employee', full_name: `Emp ${id}`, manager_id: 'mgr' });

function world(extra: Record<string, any[]> = {}) {
  return {
    users: [HR, DIRECTOR, MANAGER, emp('a'), emp('b'), emp('c')],
    cycles: [
      {
        id: 'cy', is_active: true, goal_window_start: ago(40), goal_window_end: ahead(20),
        q1_open: ago(30), q1_close: ahead(30), q2_open: ahead(60), q2_close: ahead(90),
        q3_open: ahead(120), q3_close: ahead(150), q4_open: ahead(180), q4_close: ahead(210),
      },
    ],
    escalation_rules: [
      { id: 'r-draft', name: 'Draft too long', trigger_type: 'goal_not_submitted', threshold_days: 7, escalate_to: 'Manager', is_active: true },
      { id: 'r-appr', name: 'Approval stuck', trigger_type: 'approval_pending', threshold_days: 3, escalate_to: 'SkipLevel', is_active: true },
      { id: 'r-chk', name: 'Check-in overdue', trigger_type: 'checkin_overdue', threshold_days: 10, escalate_to: 'HR', is_active: true },
    ],
    goal_sheets: [
      { id: 's-a', cycle_id: 'cy', status: 'Draft', submitted_at: null, employee: emp('a') },
      { id: 's-b', cycle_id: 'cy', status: 'Submitted', submitted_at: ago(5), employee: emp('b') },
      { id: 's-c', cycle_id: 'cy', status: 'Approved', submitted_at: ago(20), employee: emp('c') },
    ],
    goals: [
      { id: 'g1', sheet_id: 's-c' },
      { id: 'g2', sheet_id: 's-c' },
    ],
    check_ins: [{ goal_id: 'g1', quarter: 'Q1' }], // g2 has no Q1 check-in
    escalation_events: [],
    ...extra,
  };
}

describe('sweepEscalations', () => {
  it('fires all three rule types, including overdue check-ins, and notifies the right people', async () => {
    const db = fakeDb(world());
    const { triggered } = await sweepEscalations(db as any);

    expect(triggered).toBe(3);
    const byRule = Object.fromEntries(db.inserted.escalation_events.map((e) => [e.rule_id, e]));
    expect(byRule['r-draft'].subject_id).toBe('a');
    expect(byRule['r-appr'].subject_id).toBe('b');
    expect(byRule['r-chk'].subject_id).toBe('c');
    expect(byRule['r-chk'].reason).toMatch(/1 of 2 goals have no Q1 check-in/);

    const recipients = Object.fromEntries(db.inserted.notifications.map((n) => [n.payload.rule_id, n.recipient_id]));
    expect(recipients['r-draft']).toBe('mgr'); // Manager level
    expect(recipients['r-appr']).toBe('dir'); // SkipLevel = the manager's manager
    expect(recipients['r-chk']).toBe('hr'); // HR level
    expect(db.inserted.notifications.every((n) => n.channel === 'InApp')).toBe(true);
  });

  it('does not re-fire an event that already fired in the last 24h', async () => {
    const db = fakeDb(world({ escalation_events: [{ rule_id: 'r-draft', subject_id: 'a', triggered_at: ago(0) }] }));
    const { triggered } = await sweepEscalations(db as any);
    expect(triggered).toBe(2);
    expect(db.inserted.escalation_events.some((e) => e.rule_id === 'r-draft')).toBe(false);
  });

  it('does not flag a check-in as overdue when every goal has one', async () => {
    const db = fakeDb(world({ check_ins: [{ goal_id: 'g1', quarter: 'Q1' }, { goal_id: 'g2', quarter: 'Q1' }] }));
    await sweepEscalations(db as any);
    expect(db.inserted.escalation_events.some((e) => e.rule_id === 'r-chk')).toBe(false);
  });

  it('does nothing without an active cycle or rules', async () => {
    expect((await sweepEscalations(fakeDb(world({ cycles: [] })) as any)).triggered).toBe(0);
    expect((await sweepEscalations(fakeDb(world({ escalation_rules: [] })) as any)).triggered).toBe(0);
  });
});
