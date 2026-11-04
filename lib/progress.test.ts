import { describe, expect, it } from 'vitest';
import { classifyRisk, computeEffectiveProgress, expectedProgress, keyResultProgress, ownProgress } from './progress';

const kr = (o: Partial<Parameters<typeof keyResultProgress>[0]> = {}) => ({ start_value: 0, target_value: 100, current_value: 50, direction: 'increase' as const, weight: 1, ...o });

describe('keyResultProgress', () => {
  it('measures increase targets from the starting value', () => {
    expect(keyResultProgress(kr({ start_value: 20, target_value: 120, current_value: 70 }))).toBe(50);
  });
  it('measures decrease targets (lower is better)', () => {
    expect(keyResultProgress(kr({ direction: 'decrease', start_value: 10, target_value: 2, current_value: 6 }))).toBe(50);
  });
  it('clamps to 0..100 and treats no recorded value as 0', () => {
    expect(keyResultProgress(kr({ current_value: 500 }))).toBe(100);
    expect(keyResultProgress(kr({ current_value: -5 }))).toBe(0);
    expect(keyResultProgress(kr({ current_value: null }))).toBe(0);
  });
  it('treats boolean key results as all-or-nothing', () => {
    expect(keyResultProgress(kr({ metric_type: 'boolean', start_value: 0, target_value: 1, current_value: 1 }))).toBe(100);
    expect(keyResultProgress(kr({ metric_type: 'boolean', start_value: 0, target_value: 1, current_value: 0 }))).toBe(0);
  });
});

describe('ownProgress', () => {
  it('is the weighted average of key results', () => {
    expect(ownProgress([kr({ current_value: 100, weight: 3 }), kr({ current_value: 0, weight: 1 })])).toBe(75);
  });
  it('is unknown (null) when nothing is measurable, never a fabricated number', () => {
    expect(ownProgress([], 'active')).toBeNull();
    expect(ownProgress([], 'completed')).toBe(100);
  });
});

describe('computeEffectiveProgress (rollup)', () => {
  const g = (id: string, parent: string | null, o: any = {}) => ({ id, parent_goal_id: parent, weight: 1, status: 'active', progress_mode: 'own' as const, own: 0, ...o });
  it('derives a rollup parent from approved children only, weighted', () => {
    const m = computeEffectiveProgress([
      g('p', null, { progress_mode: 'rollup', own: 99 }),
      g('a', 'p', { own: 100, weight: 3 }), g('b', 'p', { own: 20, weight: 1 }),
      g('draft', 'p', { own: 0, status: 'draft' }), g('cancelled', 'p', { own: 0, status: 'cancelled' }),
    ]);
    expect(m.get('p')!.effective).toBe(80);
    expect(m.get('p')!.contributors).toBe(2);
  });
  it('never lets a parent change a child, and an "own" parent ignores children', () => {
    const m = computeEffectiveProgress([g('p', null, { own: 10 }), g('c', 'p', { own: 90 })]);
    expect(m.get('p')!.effective).toBe(10);
    expect(m.get('c')!.effective).toBe(90);
  });
  it('supports multi-level rollup and null when no child is measurable', () => {
    const m = computeEffectiveProgress([
      g('co', null, { progress_mode: 'rollup' }), g('d', 'co', { progress_mode: 'rollup' }), g('i', 'd', { own: 40 }), g('x', 'co', { progress_mode: 'rollup' }),
    ]);
    expect(m.get('d')!.effective).toBe(40);
    expect(m.get('co')!.effective).toBe(40);
    expect(m.get('x')!.effective).toBeNull();
  });
});

describe('risk', () => {
  const opts = { tolerance: 20, stalledAfterDays: 30, today: new Date('2026-07-01T12:00:00Z') };
  it('expected progress is linear over the goal window', () => {
    expect(expectedProgress('2026-01-01', '2026-12-31', new Date('2026-07-02T00:00:00Z'))).toBeCloseTo(50, 0);
  });
  it('classifies overdue, at risk, stalled, on track', () => {
    const base = { status: 'active', start_date: '2026-01-01', due_date: '2026-12-31', progress: 50, last_activity_at: '2026-06-25T00:00:00Z' };
    expect(classifyRisk({ ...base, due_date: '2026-06-01' }, opts)).toBe('overdue');
    expect(classifyRisk({ ...base, progress: 10 }, opts)).toBe('at_risk');
    expect(classifyRisk({ ...base, latest_health: 'off_track' }, opts)).toBe('at_risk');
    expect(classifyRisk({ ...base, last_activity_at: '2026-04-01T00:00:00Z' }, opts)).toBe('stalled');
    expect(classifyRisk(base, opts)).toBe('on_track');
    expect(classifyRisk({ ...base, status: 'completed' }, opts)).toBe('done');
    expect(classifyRisk({ ...base, progress: null }, opts)).toBe('unknown');
  });
});
