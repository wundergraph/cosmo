import { toUtcIso } from '../../../util.js';
import { QueryValidationError } from './errors.js';

export interface WindowInput {
  rangeHours?: number;
  start?: string;
  end?: string;
}

export interface Window {
  /** Unix seconds, inclusive. */
  start: number;
  end: number;
}

export interface ResolvedWindow {
  requested: Window;
  effective: Window;
  /** The start was moved forward to the retention limit, or the end back to now. */
  clamped: boolean;
}

const HOUR = 3600;
const DAY = 86_400;

/** Seconds since the epoch of an ISO 8601 time; `name` labels the field in the error. */
export const parseInstant = (value: string, name: string) => {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new QueryValidationError(`${name} "${value}" is not an ISO 8601 time.`);
  }
  return Math.floor(millis / 1000);
};

/**
 * Turns a requested window into the window that is queried: clamped to the plan's retention and to now, with the start
 * snapped down to the dataset's grain. A window entirely outside retention returns null.
 */
export function resolveWindow(input: {
  window: WindowInput;
  retentionDays: number;
  nowSeconds: number;
  grainSeconds: number;
  defaultRangeHours: number;
}): ResolvedWindow | null {
  const { window, retentionDays, nowSeconds, grainSeconds, defaultRangeHours } = input;
  const hasRange = window.rangeHours !== undefined;
  const hasDates = window.start !== undefined || window.end !== undefined;
  if (hasRange && hasDates) {
    throw new QueryValidationError('Use either a range or start/end, not both.');
  }
  let requested: Window;
  if (hasDates) {
    if (window.start === undefined || window.end === undefined) {
      throw new QueryValidationError('start and end must be given together.');
    }
    requested = { start: parseInstant(window.start, 'start'), end: parseInstant(window.end, 'end') };
    if (requested.start > requested.end) {
      throw new QueryValidationError('The window starts after it ends.');
    }
  } else {
    const hours = window.rangeHours ?? defaultRangeHours;
    if (!Number.isInteger(hours) || hours <= 0) {
      throw new QueryValidationError('range must be a positive number of hours.');
    }
    requested = { start: nowSeconds - hours * HOUR, end: nowSeconds };
  }

  const retentionStart = retentionStartOf(nowSeconds, retentionDays);
  if (requested.end < retentionStart) {
    return null;
  }
  const end = Math.min(requested.end, nowSeconds);
  let start = Math.max(requested.start, retentionStart);
  const clamped = start !== requested.start || end !== requested.end;
  if (grainSeconds > 1) {
    start = Math.floor(start / grainSeconds) * grainSeconds;
  }
  return { requested, effective: { start, end }, clamped };
}

export const TIME_BUCKET_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': HOUR,
  '6h': 6 * HOUR,
  '1d': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

export const GRAIN_SECONDS: Record<string, number> = { '5m': 300, '1d': DAY };

/** Seconds since the epoch as an ISO 8601 time without milliseconds. */
export const toIso = (seconds: number) => toUtcIso(new Date(seconds * 1000));

/** The oldest instant a plan's retention reaches back to. */
export const retentionStartOf = (nowSeconds: number, retentionDays: number) => nowSeconds - retentionDays * DAY;

/** How far a window's start snaps down for a dataset grain; 1 for grains that are rows, not time spans. */
export const grainSecondsOf = (grain: string) => GRAIN_SECONDS[grain] ?? 1;
