import { describe, expect, test } from 'vitest';
import { validateDateRanges } from '../src/core/util.js';

const now = new Date('2026-10-31T12:00:00Z');

describe('validateDateRanges', () => {
  test('caps range hours at the limit', () => {
    expect(validateDateRanges({ limit: 7, range: 24 * 30, now })).toEqual({
      range: 168,
      dateRange: undefined,
      outOfRetention: false,
    });
  });

  test('moves a start before the window to the window start', () => {
    expect(
      validateDateRanges({
        limit: 7,
        dateRange: { start: '2026-10-01T00:00:00Z', end: '2026-10-30T00:00:00Z' },
        now,
      }),
    ).toEqual({
      range: undefined,
      dateRange: { start: '2026-10-24T12:00:00Z', end: '2026-10-30T00:00:00Z' },
      outOfRetention: false,
    });
  });

  test('a window entirely before retention is out of retention', () => {
    expect(
      validateDateRanges({
        limit: 7,
        dateRange: { start: '2026-10-01T00:00:00Z', end: '2026-10-10T00:00:00Z' },
        now,
      }),
    ).toEqual({ range: undefined, dateRange: undefined, outOfRetention: true });
  });

  test('a start after the end is out of retention', () => {
    expect(
      validateDateRanges({
        limit: 7,
        dateRange: { start: '2026-10-30T00:00:00Z', end: '2026-10-29T00:00:00Z' },
        now,
      }),
    ).toEqual({ range: undefined, dateRange: undefined, outOfRetention: true });
  });

  test('a future end is clamped to now', () => {
    expect(
      validateDateRanges({
        limit: 7,
        dateRange: { start: '2026-10-30T00:00:00Z', end: '2027-01-01T00:00:00Z' },
        now,
      }).dateRange,
    ).toEqual({ start: '2026-10-30T00:00:00Z', end: '2026-10-31T12:00:00Z' });
  });

  test('does not mutate the input', () => {
    const input = { start: '2026-10-01T00:00:00Z', end: '2026-10-30T00:00:00Z' };
    validateDateRanges({ limit: 7, dateRange: input, now });
    expect(input).toEqual({ start: '2026-10-01T00:00:00Z', end: '2026-10-30T00:00:00Z' });
  });
});
