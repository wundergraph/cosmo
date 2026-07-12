import { describe, expect, it } from 'vitest';

import {
  traceDurationNanoseconds,
  traceNodeChildren,
  traceNodeHasTiming,
  traceNodeIsPlannedOnly,
} from './trace-rendering';

describe('ART wire rendering helpers', () => {
  it('accepts a root-only defer initial trace with null fetches', () => {
    const trace = {
      version: '1',
      info: {
        parse_stats: { duration_since_start_nanoseconds: 0, duration_nanoseconds: 5 },
        normalize_stats: { duration_since_start_nanoseconds: 5, duration_nanoseconds: 5 },
        validate_stats: { duration_since_start_nanoseconds: 10, duration_nanoseconds: 5 },
        planner_stats: { duration_since_start_nanoseconds: 15, duration_nanoseconds: 5 },
      },
      fetches: null,
    };

    expect(traceNodeChildren(trace.fetches ?? undefined)).toEqual([]);
    expect(traceDurationNanoseconds(trace)).toBe(20);
  });

  it('keeps plan-only fetches topology without inventing timing', () => {
    const fetch = { kind: 'Single', fetch: { kind: 'Single', source_name: 'products' } };
    expect(traceNodeHasTiming(fetch.fetch)).toBe(false);
    expect(traceDurationNanoseconds({ info: {}, fetches: fetch })).toBe(0);
  });

  it('reads timing from a root Single wrapper', () => {
    const trace = {
      info: {},
      fetches: {
        kind: 'Single',
        fetch: {
          kind: 'Entity',
          source_name: 'products',
          trace: { duration_since_start_nanoseconds: 20, duration_load_nanoseconds: 30 },
        },
      },
    };

    expect(traceDurationNanoseconds(trace)).toBe(50);
    expect(traceNodeHasTiming(trace.fetches.fetch)).toBe(true);
  });

  it('propagates a skipped defer state to planned descendants', () => {
    const wrapper = {
      kind: 'Sequence',
      defer: { id: 1, label: 'Slow', path: [], status: 'skipped' },
      children: [{ kind: 'Single', fetch: { kind: 'Single', source_name: 'slow' } }],
    };
    const child = traceNodeChildren(wrapper)[0]?.fetch;

    expect(traceNodeIsPlannedOnly(wrapper)).toBe(true);
    expect(traceNodeIsPlannedOnly(child, traceNodeIsPlannedOnly(wrapper))).toBe(true);
    expect(traceNodeHasTiming(child)).toBe(false);
  });
});
