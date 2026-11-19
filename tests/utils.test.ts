import { describe, it, expect } from 'vitest';
import { fmtDate, fmtDateTime } from '@/lib/utils';

// These assertions must hold in every timezone, so run them under several to prove it.
describe('date formatting is timezone independent (UTC)', () => {
  it('formats a timestamp by its UTC calendar day', () => {
    // 22:00 UTC on 30 Jun is already 1 Jul in India (UTC+5:30); it must stay 30 Jun.
    expect(fmtDate('2026-06-30T22:00:00Z')).toBe('30 Jun 2026');
    expect(fmtDateTime('2026-06-30T22:00:00Z')).toBe('30 Jun 2026, 22:00');
  });

  it('keeps date-only values on the same day', () => {
    expect(fmtDate('2026-01-01')).toBe('1 Jan 2026');
    expect(fmtDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('zero-pads time and handles Date objects', () => {
    expect(fmtDateTime(new Date('2026-03-05T04:07:00Z'))).toBe('5 Mar 2026, 04:07');
  });

  it('returns a placeholder for empty or invalid input', () => {
    expect(fmtDate(null)).toBe('·');
    expect(fmtDate(undefined)).toBe('·');
    expect(fmtDate('not a date')).toBe('·');
    expect(fmtDateTime('')).toBe('·');
  });

  it('gives the same output regardless of the process timezone', () => {
    const original = process.env.TZ;
    const outputs = new Set<string>();
    try {
      for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        outputs.add(fmtDateTime('2026-06-30T22:00:00Z') + '|' + fmtDate('2026-06-30'));
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
    expect(outputs.size).toBe(1);
  });
});
