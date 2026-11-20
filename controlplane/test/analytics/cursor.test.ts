import { describe, expect, test } from 'vitest';
import { clampCursorWindow, decodeTraceCursor, encodeCursor } from '../../src/core/util/analytics/cursor.js';
import { QueryValidationError } from '../../src/core/repositories/analytics/query/errors.js';

// Retention starts at 1_000_000 - 7 days = 395_200.
const limits = { retentionDays: 7, nowSeconds: 1_000_000, grainSeconds: 300 };

describe('Cursor windows', () => {
  test('keep a window inside retention', () => {
    expect(clampCursorWindow({ start: 400_200, end: 500_000 }, limits)).toEqual({ start: 400_200, end: 500_000 });
  });

  test('are cut to the retention limit and to now, like a requested window', () => {
    expect(clampCursorWindow({ start: 100, end: 2_000_000 }, limits)).toEqual({ start: 395_100, end: 1_000_000 });
  });

  test('are refused when entirely outside retention, or inverted', () => {
    expect(() => clampCursorWindow({ start: 100, end: 200 }, limits)).toThrow(
      new QueryValidationError(
        "The cursor's window is outside your plan's retention; repeat the query without the cursor.",
      ),
    );
    expect(() => clampCursorWindow({ start: 500_000, end: 400_000 }, limits)).toThrow(
      new QueryValidationError('The cursor is not valid.'),
    );
  });
});

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('Trace search cursors', () => {
  const state = { value: '1795158281000000000', traceId: 't1', start: 400_000, end: 500_000, fingerprint: 'fp' };

  test('round-trip', () => {
    expect(decodeTraceCursor(encodeCursor(state), 'fp')).toEqual(state);
  });

  test('carry integer window bounds and a numeric sort value', () => {
    const invalid = new QueryValidationError('The cursor is not valid.');
    expect(() => decodeTraceCursor(encode({ ...state, start: 'x' }), 'fp')).toThrow(invalid);
    expect(() => decodeTraceCursor(encode({ ...state, end: 1.5 }), 'fp')).toThrow(invalid);
    expect(() => decodeTraceCursor(encode({ ...state, value: '1e9' }), 'fp')).toThrow(invalid);
    expect(() => decodeTraceCursor(encode({ ...state, traceId: 7 }), 'fp')).toThrow(invalid);
    expect(() => decodeTraceCursor('%%%', 'fp')).toThrow(invalid);
  });

  test('only fit the search they came from', () => {
    expect(() => decodeTraceCursor(encodeCursor(state), 'other')).toThrow(
      new QueryValidationError('The cursor belongs to a different search; repeat the search without it.'),
    );
  });
});
