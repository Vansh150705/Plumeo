/*
 * The goal validation and scoring rules live here, and only here, so the instant
 * feedback in the browser and the checks on the server can never drift apart.
 * Keep this file pure: no React, no Next.js, no Supabase imports.
 */

import type { Goal, CheckIn, UomType, UomDirection } from './types';

// validation rules

export const MIN_WEIGHTAGE = 10;
export const MAX_WEIGHTAGE = 100;
export const MAX_GOALS_PER_SHEET = 8;
export const REQUIRED_TOTAL_WEIGHTAGE = 100;

export type ValidationIssue = {
  code:
    | 'WEIGHTAGE_TOTAL'
    | 'WEIGHTAGE_MIN'
    | 'WEIGHTAGE_MAX'
    | 'GOAL_COUNT'
    | 'MISSING_TITLE'
    | 'MISSING_TARGET'
    | 'MISSING_THRUST';
  message: string;
  goalId?: string;
};

/** Check a whole sheet against every rule; returns a list of problems (empty = good to submit). */
export function validateSheet(goals: Goal[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Goal count ceiling
  if (goals.length === 0) {
    issues.push({ code: 'GOAL_COUNT', message: 'Add at least one goal before submitting.' });
  } else if (goals.length > MAX_GOALS_PER_SHEET) {
    issues.push({
      code: 'GOAL_COUNT',
      message: `Maximum ${MAX_GOALS_PER_SHEET} goals per sheet (currently ${goals.length}).`,
    });
  }

  // Per-goal checks
  for (const g of goals) {
    if (!g.title?.trim()) {
      issues.push({ code: 'MISSING_TITLE', message: 'Every goal needs a title.', goalId: g.id });
    }
    if (!g.thrust_area) {
      issues.push({ code: 'MISSING_THRUST', message: 'Pick a thrust area.', goalId: g.id });
    }
    if (g.weightage < MIN_WEIGHTAGE) {
      issues.push({
        code: 'WEIGHTAGE_MIN',
        message: `Weightage must be ≥ ${MIN_WEIGHTAGE}% (currently ${g.weightage}%).`,
        goalId: g.id,
      });
    }
    if (g.weightage > MAX_WEIGHTAGE) {
      issues.push({
        code: 'WEIGHTAGE_MAX',
        message: `Weightage cannot exceed ${MAX_WEIGHTAGE}%.`,
        goalId: g.id,
      });
    }
    if (g.uom === 'Timeline') {
      if (!g.target_date) {
        issues.push({ code: 'MISSING_TARGET', message: 'Timeline goals need a deadline.', goalId: g.id });
      }
    } else if (g.uom === 'Zero') {
      // Zero target is implicit (0); always valid
    } else if (g.target_numeric == null) {
      issues.push({ code: 'MISSING_TARGET', message: 'Numeric target required.', goalId: g.id });
    }
  }

  // Total weightage exactness
  const total = goals.reduce((s, g) => s + (Number(g.weightage) || 0), 0);
  if (goals.length > 0 && total !== REQUIRED_TOTAL_WEIGHTAGE) {
    issues.push({
      code: 'WEIGHTAGE_TOTAL',
      message: `Total weightage must equal ${REQUIRED_TOTAL_WEIGHTAGE}% (currently ${total}%).`,
    });
  }

  return issues;
}

export const totalWeightage = (goals: Goal[]): number =>
  goals.reduce((s, g) => s + (Number(g.weightage) || 0), 0);

export const canSubmit = (goals: Goal[]): boolean => validateSheet(goals).length === 0;

// scoring formulas
/*
 * Turn one goal + one check-in into a 0-100 score. There are four shapes:
 *   higher-is-better numbers -> achievement / target
 *   lower-is-better numbers  -> target / achievement
 *   timeline                 -> hit the deadline = 100, else 0
 *   zero-based               -> stayed at zero = 100, else 0
 * Returns null when the numbers we need aren't in yet, so the UI can show a dot.
 */
export function computeScore(
  goal: Pick<Goal, 'uom' | 'direction' | 'target_numeric' | 'target_date'>,
  checkIn: Pick<CheckIn, 'actual_numeric' | 'actual_date' | 'zero_achieved'>,
): number | null {
  const { uom, direction, target_numeric, target_date } = goal;
  const { actual_numeric, actual_date, zero_achieved } = checkIn;

  if (uom === 'Zero') {
    if (zero_achieved == null) return null;
    return zero_achieved ? 100 : 0;
  }

  if (uom === 'Timeline') {
    if (!target_date || !actual_date) return null;
    return new Date(actual_date) <= new Date(target_date) ? 100 : 0;
  }

  // Numeric or Percentage
  if (target_numeric == null || actual_numeric == null) return null;
  if (direction === 'min') {
    // higher is better: achievement over target
    if (target_numeric === 0) return actual_numeric >= 0 ? 100 : 0;
    return clamp((actual_numeric / target_numeric) * 100, 0, 150);
  }
  if (direction === 'max') {
    // lower is better: target over achievement
    if (actual_numeric === 0) return target_numeric >= 0 ? 100 : 0;
    return clamp((target_numeric / actual_numeric) * 100, 0, 150);
  }
  return null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// which quarter (if any) is open for check-ins right now
export type CycleWindows = {
  goal_window_start: string;
  goal_window_end: string;
  q1_open: string; q1_close: string;
  q2_open: string; q2_close: string;
  q3_open: string; q3_close: string;
  q4_open: string; q4_close: string;
};

export function activeQuarter(cycle: CycleWindows, now = new Date()): 'Q1' | 'Q2' | 'Q3' | 'Q4' | null {
  const t = now.getTime();
  if (t >= new Date(cycle.q1_open).getTime() && t <= new Date(cycle.q1_close).getTime()) return 'Q1';
  if (t >= new Date(cycle.q2_open).getTime() && t <= new Date(cycle.q2_close).getTime()) return 'Q2';
  if (t >= new Date(cycle.q3_open).getTime() && t <= new Date(cycle.q3_close).getTime()) return 'Q3';
  if (t >= new Date(cycle.q4_open).getTime() && t <= new Date(cycle.q4_close).getTime()) return 'Q4';
  return null;
}

export function isGoalSettingWindowOpen(cycle: CycleWindows, now = new Date()): boolean {
  const t = now.getTime();
  return t >= new Date(cycle.goal_window_start).getTime() && t <= new Date(cycle.goal_window_end).getTime();
}

// display helpers
export function formatTarget(goal: Pick<Goal, 'uom' | 'target_numeric' | 'target_date'>): string {
  if (goal.uom === 'Zero') return '0';
  if (goal.uom === 'Timeline') return goal.target_date ?? '·';
  if (goal.uom === 'Percentage') return goal.target_numeric != null ? `${goal.target_numeric}%` : '·';
  return goal.target_numeric != null ? goal.target_numeric.toLocaleString() : '·';
}

export function uomLabel(uom: UomType, direction: UomDirection): string {
  if (uom === 'Zero') return 'Zero-based';
  if (uom === 'Timeline') return 'Timeline';
  return `${uom === 'Percentage' ? '%' : 'Numeric'} (${direction === 'min' ? 'Higher better' : 'Lower better'})`;
}
