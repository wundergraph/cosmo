import { parse } from 'graphql';
import { describe, expect, it } from 'vitest';

import { getTraceHeader, isSelectedSubscription, traceHeaderIncludes } from './trace-metadata';

describe('trace request metadata', () => {
  it('finds non-empty trace headers case-insensitively', () => {
    expect(getTraceHeader('{"x-Wg-TrAcE":"exclude_load_stats"}')).toBe('exclude_load_stats');
    expect(traceHeaderIncludes('{"x-wg-trace":"EXCLUDE_LOAD_STATS"}', 'exclude_load_stats')).toBe(true);
  });

  it('ignores empty or invalid header objects', () => {
    expect(getTraceHeader('{"x-wg-trace":"  "}')).toBeUndefined();
    expect(getTraceHeader('not json')).toBeUndefined();
  });

  it('filters non-string array entries before checking trace options', () => {
    expect(getTraceHeader('{"X-WG-TRACE":[1,"exclude_load_stats",null]}')).toEqual(['exclude_load_stats']);
    expect(traceHeaderIncludes('{"X-WG-TRACE":[1,"exclude_load_stats"]}', 'exclude_load_stats')).toBe(true);
  });

  it('detects the selected subscription in a multi-operation document', () => {
    const document = parse('query First { __typename } subscription Selected { event }');
    expect(isSelectedSubscription(document, 'Selected')).toBe(true);
    expect(isSelectedSubscription(document, 'First')).toBe(false);
  });
});
