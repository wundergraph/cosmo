import { describe, expect, test } from 'vitest';
import {
  mergedEntrySummary,
  type ResponseCacheEntry,
  type ResponseCacheTrace,
} from '../src/components/playground/response-cache-trace';

const trace = (entries: Partial<ResponseCacheEntry>[]) => ({ entries }) as unknown as ResponseCacheTrace;

describe('mergedEntrySummary', () => {
  test('groups aliased entries by path, falling back to alias, and counts served entries', () => {
    const summary = mergedEntrySummary(
      trace([
        { alias: 'a', path: 'p', served: true },
        { alias: 'a2', path: 'p', served: false },
        { alias: 'b', served: true },
        { served: true },
        { alias: 'c', path: '', served: false },
      ]),
    );

    expect(summary).toEqual([
      { name: 'p', total: 2, served: 1 },
      { name: 'b', total: 1, served: 1 },
      { name: 'c', total: 1, served: 0 },
    ]);
  });
});
