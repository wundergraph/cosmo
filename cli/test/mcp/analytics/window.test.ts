import { describe, expect, test } from 'vitest';
import { parseWindow, retainWindow } from '../../../src/commands/mcp/analytics/window.js';

const now = new Date('2026-10-31T12:00:00Z');
const limits = { retentionDays: 7, family: 'analytics' as const, now };

describe('retainWindow', () => {
  test('keeps a window the plan retains', () => {
    expect(retainWindow({ range: 72 }, limits)).toEqual({ window: { range: 72 }, warnings: [] });
    expect(retainWindow({ dateRange: { start: '2026-10-30T00:00:00Z', end: '2026-10-31T00:00:00Z' } }, limits)).toEqual(
      { window: { dateRange: { start: '2026-10-30T00:00:00Z', end: '2026-10-31T00:00:00Z' } }, warnings: [] },
    );
  });

  test('cuts a range longer than retention, and says so', () => {
    expect(retainWindow({ range: 720 }, limits)).toEqual({
      window: { range: 168 },
      warnings: ["Window clamped to 7 days by your plan's analytics retention."],
    });
  });

  test('cuts the start of a date range to retention and the end to now', () => {
    expect(retainWindow({ dateRange: { start: '2026-10-01T00:00:00Z', end: '2026-11-02T00:00:00Z' } }, limits)).toEqual(
      {
        window: { dateRange: { start: '2026-10-24T12:00:00.000Z', end: '2026-10-31T12:00:00.000Z' } },
        warnings: [
          "Window clamped to 7 days by your plan's analytics retention.",
          'The window ended in the future; it was clamped to now.',
        ],
      },
    );
  });

  test('refuses a date range entirely outside retention', () => {
    expect(() =>
      retainWindow({ dateRange: { start: '2026-09-01T00:00:00Z', end: '2026-09-02T00:00:00Z' } }, limits),
    ).toThrow(new Error("The requested window is outside your plan's analytics retention (7 days)."));
  });

  test('names tracing retention for trace data', () => {
    expect(retainWindow({ range: 720 }, { ...limits, family: 'tracing' })).toEqual({
      window: { range: 168 },
      warnings: ["Window clamped to 7 days by your plan's tracing retention."],
    });
  });
});

describe('parseWindow', () => {
  test('turns a day range into hours', () => {
    expect(parseWindow({ range: '7d' })).toEqual({ range: 168 });
  });

  test('turns an hour range into hours', () => {
    expect(parseWindow({ range: '12h' })).toEqual({ range: 12 });
  });

  test('passes an explicit window through as a date range', () => {
    expect(parseWindow({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })).toEqual({
      dateRange: { start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' },
    });
  });

  test('defaults to the last 24 hours', () => {
    expect(parseWindow({})).toEqual({ range: 24 });
  });

  test('rejects mixing range and from/to', () => {
    expect(() => parseWindow({ range: '7d', from: '2026-10-01T00:00:00Z' })).toThrow(
      new Error('Use either range or from/to.'),
    );
  });

  test('rejects a malformed range', () => {
    expect(() => parseWindow({ range: 'week' })).toThrow(new Error('range must look like 24h or 7d.'));
  });
});
