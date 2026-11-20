import type { AnalyticsRetentionFamily } from '@wundergraph/cosmo-shared';
import { z } from 'zod';
import type { AnalyticsToolContext } from './context.js';

/** A tool's window input: a relative `range`, or `from` and `to`. */
export type WindowInput = { range?: string; from?: string; to?: string };

/** A parsed window: hours back from now, or an explicit ISO 8601 date range. */
export type AnalyticsWindow =
  | { range: number; dateRange?: never }
  | { dateRange: { start: string; end: string }; range?: never };

/** Tool input fields for a time window. */
export const windowInput = {
  range: z
    .string()
    .optional()
    .describe('Relative window ending now, e.g. "1h", "24h", "7d". Defaults to "24h". Do not combine with from/to.'),
  from: z.string().optional().describe('Window start, ISO 8601 (e.g. "2026-10-30T00:00:00Z"). Requires "to".'),
  to: z.string().optional().describe('Window end, ISO 8601. Requires "from".'),
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function parseWindow(input: WindowInput): AnalyticsWindow {
  if (input.range && (input.from || input.to)) {
    throw new Error('Use either range or from/to.');
  }
  if (input.from || input.to) {
    if (!input.from || !input.to) {
      throw new Error('from and to must be given together.');
    }
    return { dateRange: { start: input.from, end: input.to } };
  }
  if (!input.range) {
    return { range: 24 };
  }
  const match = /^(\d+)(h|d)$/.exec(input.range);
  if (!match) {
    throw new Error('range must look like 24h or 7d.');
  }
  const amount = Number(match[1]);
  return { range: match[2] === 'd' ? amount * 24 : amount };
}

/**
 * Cuts a window to the days the plan retains, and to now, with a warning for each cut, worded like the controlplane's
 * for the query RPCs. A date range that ends before retention starts can't be read at all.
 */
export function retainWindow(
  window: AnalyticsWindow,
  limits: { retentionDays: number; family: AnalyticsRetentionFamily; now: Date },
): { window: AnalyticsWindow; warnings: string[] } {
  const retention = limits.family === 'tracing' ? 'tracing retention' : 'analytics retention';
  const clamped = `Window clamped to ${limits.retentionDays} days by your plan's ${retention}.`;
  if (!window.dateRange) {
    const maxHours = limits.retentionDays * 24;
    return window.range > maxHours ? { window: { range: maxHours }, warnings: [clamped] } : { window, warnings: [] };
  }
  const start = Date.parse(window.dateRange.start);
  const end = Date.parse(window.dateRange.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error('from and to must be ISO 8601 times, from before to.');
  }
  const retentionStart = limits.now.getTime() - limits.retentionDays * DAY_MS;
  if (end < retentionStart) {
    throw new Error(`The requested window is outside your plan's ${retention} (${limits.retentionDays} days).`);
  }
  const warnings: string[] = [];
  const range = { ...window.dateRange };
  if (start < retentionStart) {
    range.start = new Date(retentionStart).toISOString();
    warnings.push(clamped);
  }
  if (end > limits.now.getTime()) {
    range.end = limits.now.toISOString();
    warnings.push('The window ended in the future; it was clamped to now.');
  }
  return { window: { dateRange: range }, warnings };
}

/**
 * The tool's window, cut to what the plan retains for `family`. The older metrics RPCs shorten or empty a window
 * outside retention without saying so, so their tools cut it first and report the cut.
 */
export async function retainedWindow(
  ctx: Pick<AnalyticsToolContext, 'getCapabilities' | 'now'>,
  input: WindowInput,
  family: AnalyticsRetentionFamily,
): Promise<{ window: AnalyticsWindow; warnings: string[] }> {
  const window = parseWindow(input);
  const capabilities = await ctx.getCapabilities().catch(() => undefined);
  const retentionDays = capabilities?.retention.find((r) => r.family === family)?.effectiveDays;
  if (!retentionDays) {
    return { window, warnings: ["The plan's retention could not be read, so the window was not checked against it."] };
  }
  return retainWindow(window, { retentionDays, family, now: ctx.now() });
}

/** The window as the query RPCs take it. They clamp it to retention themselves and report the cut. */
export function queryWindow(input: WindowInput) {
  const window = parseWindow(input);
  return window.dateRange ? { start: window.dateRange.start, end: window.dateRange.end } : { rangeHours: window.range };
}

/** The window as the metrics RPCs take it: hours in `range`, or an explicit `dateRange`. */
export function metricsWindow(window: AnalyticsWindow) {
  return window.dateRange ? { dateRange: window.dateRange } : { range: window.range };
}

/** The window as GetDashboardAnalyticsView takes it: hours in `range`, or `startDate` and `endDate`. */
export function dashboardWindow(window: AnalyticsWindow) {
  return window.dateRange
    ? { startDate: window.dateRange.start, endDate: window.dateRange.end }
    : { range: window.range };
}

/**
 * The window as explicit start and end times, for the RPCs that take only dates (checks, compositions, changelog).
 * `defaultRange` applies when the input names no window.
 */
export function absoluteWindow(input: WindowInput, defaultRange: string, now: Date): { start: string; end: string } {
  const window = parseWindow(input.range || input.from || input.to ? input : { range: defaultRange });
  if (window.dateRange) {
    return window.dateRange;
  }
  return { start: new Date(now.getTime() - window.range * HOUR_MS).toISOString(), end: now.toISOString() };
}
