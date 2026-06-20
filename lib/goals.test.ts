import { describe, it, expect } from 'vitest';
import {
  validateSheet,
  computeScore,
  totalWeightage,
  canSubmit,
  activeQuarter,
  isGoalSettingWindowOpen,
  formatTarget,
  uomLabel,
  MAX_GOALS_PER_SHEET,
} from './goals';
import type { Goal, CheckIn } from './types';

// ---------------------------------------------------------------------------
// Test factories — keep each test focused on the one field it exercises.
// ---------------------------------------------------------------------------

let seq = 0;
function makeGoal(overrides: Partial<Goal> = {}): Goal {
  seq += 1;
  return {
    id: `goal-${seq}`,
    sheet_id: 'sheet-1',
    thrust_area: 'Revenue Growth',
    title: 'Grow ARR',
    description: null,
    uom: 'Numeric',
    direction: 'min', // "higher is better" in this codebase's convention
    target_numeric: 100,
    target_date: null,
    weightage: 100,
    is_shared_origin: false,
    shared_origin_id: null,
    display_order: 0,
    ...overrides,
  };
}

function makeCheckIn(overrides: Partial<CheckIn> = {}): Pick<
  CheckIn,
  'actual_numeric' | 'actual_date' | 'zero_achieved'
> {
  return {
    actual_numeric: null,
    actual_date: null,
    zero_achieved: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateSheet
// ---------------------------------------------------------------------------

describe('validateSheet', () => {
  it('accepts a single valid goal summing to 100', () => {
    expect(validateSheet([makeGoal({ weightage: 100 })])).toEqual([]);
  });

  it('accepts multiple goals that sum to exactly 100', () => {
    const goals = [
      makeGoal({ weightage: 40 }),
      makeGoal({ weightage: 35 }),
      makeGoal({ weightage: 25 }),
    ];
    expect(validateSheet(goals)).toEqual([]);
    expect(canSubmit(goals)).toBe(true);
  });

  it('flags an empty sheet', () => {
    const issues = validateSheet([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('GOAL_COUNT');
  });

  it('flags more than the max number of goals', () => {
    const goals = Array.from({ length: MAX_GOALS_PER_SHEET + 1 }, () =>
      makeGoal({ weightage: 10 }),
    );
    expect(validateSheet(goals).some((i) => i.code === 'GOAL_COUNT')).toBe(true);
  });

  it('flags a missing title', () => {
    const issues = validateSheet([makeGoal({ title: '   ' })]);
    expect(issues.some((i) => i.code === 'MISSING_TITLE')).toBe(true);
  });

  it('flags a missing thrust area', () => {
    const issues = validateSheet([makeGoal({ thrust_area: '' })]);
    expect(issues.some((i) => i.code === 'MISSING_THRUST')).toBe(true);
  });

  it('flags weightage below the minimum', () => {
    const issues = validateSheet([makeGoal({ weightage: 5 })]);
    expect(issues.some((i) => i.code === 'WEIGHTAGE_MIN')).toBe(true);
  });

  it('flags weightage above the maximum', () => {
    const issues = validateSheet([makeGoal({ weightage: 120 })]);
    expect(issues.some((i) => i.code === 'WEIGHTAGE_MAX')).toBe(true);
  });

  it('flags a total weightage that does not equal 100', () => {
    const goals = [makeGoal({ weightage: 40 }), makeGoal({ weightage: 40 })];
    const issues = validateSheet(goals);
    expect(issues.some((i) => i.code === 'WEIGHTAGE_TOTAL')).toBe(true);
  });

  it('requires a deadline for Timeline goals', () => {
    const issues = validateSheet([
      makeGoal({ uom: 'Timeline', direction: 'timeline', target_numeric: null, target_date: null }),
    ]);
    expect(issues.some((i) => i.code === 'MISSING_TARGET')).toBe(true);
  });

  it('accepts a Timeline goal that has a deadline', () => {
    const issues = validateSheet([
      makeGoal({ uom: 'Timeline', direction: 'timeline', target_numeric: null, target_date: '2027-01-31' }),
    ]);
    expect(issues).toEqual([]);
  });

  it('treats a Zero goal as always having a valid target', () => {
    const issues = validateSheet([
      makeGoal({ uom: 'Zero', direction: 'zero', target_numeric: null }),
    ]);
    expect(issues).toEqual([]);
  });

  it('requires a numeric target for Numeric/Percentage goals', () => {
    const issues = validateSheet([makeGoal({ uom: 'Percentage', target_numeric: null })]);
    expect(issues.some((i) => i.code === 'MISSING_TARGET')).toBe(true);
  });

  it('attaches the goal id to per-goal issues', () => {
    const goal = makeGoal({ title: '', weightage: 100 });
    const issue = validateSheet([goal]).find((i) => i.code === 'MISSING_TITLE');
    expect(issue?.goalId).toBe(goal.id);
  });
});

describe('totalWeightage', () => {
  it('sums weightage across goals', () => {
    expect(totalWeightage([makeGoal({ weightage: 30 }), makeGoal({ weightage: 70 })])).toBe(100);
  });

  it('treats non-numeric weightage as zero', () => {
    expect(totalWeightage([makeGoal({ weightage: NaN as unknown as number })])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeScore — the four scoring shapes
// ---------------------------------------------------------------------------

describe('computeScore', () => {
  describe('Zero-based', () => {
    const goal = { uom: 'Zero', direction: 'zero', target_numeric: null, target_date: null } as const;

    it('returns 100 when zero was achieved', () => {
      expect(computeScore(goal, makeCheckIn({ zero_achieved: true }))).toBe(100);
    });

    it('returns 0 when zero was not achieved', () => {
      expect(computeScore(goal, makeCheckIn({ zero_achieved: false }))).toBe(0);
    });

    it('returns null when not yet captured', () => {
      expect(computeScore(goal, makeCheckIn({ zero_achieved: null }))).toBeNull();
    });
  });

  describe('Timeline', () => {
    const goal = {
      uom: 'Timeline',
      direction: 'timeline',
      target_numeric: null,
      target_date: '2027-01-31',
    } as const;

    it('returns 100 when delivered on or before the deadline', () => {
      expect(computeScore(goal, makeCheckIn({ actual_date: '2027-01-15' }))).toBe(100);
      expect(computeScore(goal, makeCheckIn({ actual_date: '2027-01-31' }))).toBe(100);
    });

    it('returns 0 when delivered after the deadline', () => {
      expect(computeScore(goal, makeCheckIn({ actual_date: '2027-02-01' }))).toBe(0);
    });

    it('returns null when either date is missing', () => {
      expect(computeScore(goal, makeCheckIn({ actual_date: null }))).toBeNull();
      expect(
        computeScore({ ...goal, target_date: null }, makeCheckIn({ actual_date: '2027-01-15' })),
      ).toBeNull();
    });
  });

  describe('Numeric — higher is better (direction "min")', () => {
    const goal = { uom: 'Numeric', direction: 'min', target_numeric: 100, target_date: null } as const;

    it('scores achievement over target as a percentage', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 80 }))).toBe(80);
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 100 }))).toBe(100);
    });

    it('caps overachievement at 150', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 1000 }))).toBe(150);
    });

    it('handles a zero target as a special case', () => {
      const zeroTarget = { ...goal, target_numeric: 0 };
      expect(computeScore(zeroTarget, makeCheckIn({ actual_numeric: 5 }))).toBe(100);
      expect(computeScore(zeroTarget, makeCheckIn({ actual_numeric: -1 }))).toBe(0);
    });

    it('returns null when the actual is missing', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: null }))).toBeNull();
    });
  });

  describe('Numeric — lower is better (direction "max")', () => {
    const goal = { uom: 'Numeric', direction: 'max', target_numeric: 100, target_date: null } as const;

    it('scores target over achievement as a percentage', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 100 }))).toBe(100);
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 200 }))).toBe(50);
    });

    it('caps strong performance at 150', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 10 }))).toBe(150);
    });

    it('handles a zero achievement as a special case', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: 0 }))).toBe(100);
    });

    it('returns null when the actual is missing', () => {
      expect(computeScore(goal, makeCheckIn({ actual_numeric: null }))).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Cycle windows
// ---------------------------------------------------------------------------

describe('cycle windows', () => {
  const cycle = {
    goal_window_start: '2026-05-01T00:00:00Z',
    goal_window_end: '2026-06-30T23:59:59Z',
    q1_open: '2026-07-01T00:00:00Z', q1_close: '2026-07-31T23:59:59Z',
    q2_open: '2026-10-01T00:00:00Z', q2_close: '2026-10-31T23:59:59Z',
    q3_open: '2027-01-01T00:00:00Z', q3_close: '2027-01-31T23:59:59Z',
    q4_open: '2027-03-01T00:00:00Z', q4_close: '2027-04-30T23:59:59Z',
  };

  it('detects the active quarter', () => {
    expect(activeQuarter(cycle, new Date('2026-07-15T00:00:00Z'))).toBe('Q1');
    expect(activeQuarter(cycle, new Date('2027-01-10T00:00:00Z'))).toBe('Q3');
  });

  it('returns null outside every quarter window', () => {
    expect(activeQuarter(cycle, new Date('2026-08-15T00:00:00Z'))).toBeNull();
  });

  it('detects the goal-setting window', () => {
    expect(isGoalSettingWindowOpen(cycle, new Date('2026-05-15T00:00:00Z'))).toBe(true);
    expect(isGoalSettingWindowOpen(cycle, new Date('2026-07-15T00:00:00Z'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

describe('display helpers', () => {
  it('formats targets per unit of measure', () => {
    expect(formatTarget({ uom: 'Zero', target_numeric: null, target_date: null })).toBe('0');
    expect(formatTarget({ uom: 'Timeline', target_numeric: null, target_date: '2027-01-31' })).toBe('2027-01-31');
    expect(formatTarget({ uom: 'Percentage', target_numeric: 95, target_date: null })).toBe('95%');
    expect(formatTarget({ uom: 'Numeric', target_numeric: 1000, target_date: null })).toBe('1,000');
  });

  it('labels units of measure', () => {
    expect(uomLabel('Zero', 'zero')).toBe('Zero-based');
    expect(uomLabel('Timeline', 'timeline')).toBe('Timeline');
    expect(uomLabel('Percentage', 'min')).toContain('Higher better');
    expect(uomLabel('Numeric', 'max')).toContain('Lower better');
  });
});
