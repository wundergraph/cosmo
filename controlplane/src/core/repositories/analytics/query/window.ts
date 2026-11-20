import { createHash } from 'node:crypto';

export class QueryValidationError extends Error {}

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

const parseInstant = (value: string, name: string) => {
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

  const retentionStart = nowSeconds - retentionDays * DAY;
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

export const toIso = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

interface CursorState {
  offset: number;
  start: number;
  end: number;
  fingerprint: string;
}

/** A fingerprint of everything that defines a query except the window and the page. */
export const queryFingerprint = (query: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(query, (_, value) => (typeof value === 'bigint' ? value.toString() : value)))
    .digest('base64url')
    .slice(0, 16);

/** Cursors are opaque: they freeze the window and carry the position, and only fit the query they came from. */
export const encodeCursor = (state: CursorState) => Buffer.from(JSON.stringify(state)).toString('base64url');

export function decodeCursor(cursor: string, fingerprint: string): CursorState {
  let state: CursorState;
  try {
    state = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new QueryValidationError('The cursor is not valid.');
  }
  if (
    !state ||
    !Number.isInteger(state.offset) ||
    state.offset < 0 ||
    !Number.isInteger(state.start) ||
    !Number.isInteger(state.end) ||
    typeof state.fingerprint !== 'string'
  ) {
    throw new QueryValidationError('The cursor is not valid.');
  }
  if (state.fingerprint !== fingerprint) {
    throw new QueryValidationError('The cursor belongs to a different query; repeat the query without it.');
  }
  return state;
}

/**
 * The window a cursor pins. The cursor is held by the client, so its window is accepted only as far as the plan's
 * retention and now allow, exactly like a requested window.
 */
export function clampCursorWindow(
  pinned: Window,
  limits: { retentionDays: number; nowSeconds: number; grainSeconds: number },
): Window {
  if (pinned.start > pinned.end) {
    throw new QueryValidationError('The cursor is not valid.');
  }
  const retentionStart = limits.nowSeconds - limits.retentionDays * DAY;
  if (pinned.end < retentionStart) {
    throw new QueryValidationError(
      "The cursor's window is outside your plan's retention; repeat the query without the cursor.",
    );
  }
  let start = Math.max(pinned.start, retentionStart);
  if (limits.grainSeconds > 1) {
    start = Math.floor(start / limits.grainSeconds) * limits.grainSeconds;
  }
  return { start, end: Math.min(pinned.end, limits.nowSeconds) };
}

/** A trace search cursor: the last trace's sort value (digits) and ID, the pinned window and the search's fingerprint. */
export interface TraceCursorState {
  value: string;
  traceId: string;
  start: number;
  end: number;
  fingerprint: string;
}

export const encodeTraceCursor = (state: TraceCursorState) => Buffer.from(JSON.stringify(state)).toString('base64url');

export function decodeTraceCursor(cursor: string, fingerprint: string): TraceCursorState {
  let state: TraceCursorState;
  try {
    state = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new QueryValidationError('The cursor is not valid.');
  }
  if (
    !state ||
    typeof state.value !== 'string' ||
    !/^\d+$/.test(state.value) ||
    typeof state.traceId !== 'string' ||
    !Number.isInteger(state.start) ||
    !Number.isInteger(state.end) ||
    typeof state.fingerprint !== 'string'
  ) {
    throw new QueryValidationError('The cursor is not valid.');
  }
  if (state.fingerprint !== fingerprint) {
    throw new QueryValidationError('The cursor belongs to a different search; repeat the search without it.');
  }
  return state;
}
