import { z } from 'zod';

export type AnalyticsWindow = { range?: number; dateRange?: { start: string; end: string } };

/** Tool input fields for a time window. */
export const windowInput = {
  range: z
    .string()
    .optional()
    .describe('Relative window ending now, e.g. "1h", "24h", "7d". Defaults to "24h". Do not combine with from/to.'),
  from: z.string().optional().describe('Window start, ISO 8601 (e.g. "2026-10-30T00:00:00Z"). Requires "to".'),
  to: z.string().optional().describe('Window end, ISO 8601. Requires "from".'),
};

/**
 * Turns the tool's window input into the controlplane's `range` (hours) or `dateRange`.
 * The controlplane clamps either to the plan's retention.
 */
export function parseWindow(input: { range?: string; from?: string; to?: string }): AnalyticsWindow {
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
