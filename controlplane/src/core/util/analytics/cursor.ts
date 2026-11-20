import { createHash } from 'node:crypto';
import { QueryValidationError } from '../../repositories/analytics/query/errors.js';
import { retentionStartOf, type Window } from '../../repositories/analytics/query/window.js';

/** A QueryAnalytics cursor: the next row offset, the pinned window and the query's fingerprint. */
export interface CursorState {
  offset: number;
  start: number;
  end: number;
  fingerprint: string;
}

/** A trace search cursor: the last trace's sort value (digits) and ID, the pinned window and the search's fingerprint. */
export interface TraceCursorState {
  value: string;
  traceId: string;
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
export const encodeCursor = (state: CursorState | TraceCursorState) =>
  Buffer.from(JSON.stringify(state)).toString('base64url');

/** A cursor's JSON, or a validation error when it isn't one of ours. */
function parseCursor<T>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new QueryValidationError('The cursor is not valid.');
  }
}

export function decodeCursor(cursor: string, fingerprint: string): CursorState {
  const state = parseCursor<CursorState>(cursor);
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

export function decodeTraceCursor(cursor: string, fingerprint: string): TraceCursorState {
  const state = parseCursor<TraceCursorState>(cursor);
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
  const retentionStart = retentionStartOf(limits.nowSeconds, limits.retentionDays);
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
