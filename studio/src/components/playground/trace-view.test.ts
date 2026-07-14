import { parse } from 'graphql';
import { describe, expect, it } from 'vitest';

import { getTraceHeader, isSelectedSubscription, traceHeaderIncludes } from './trace-metadata';

describe('TraceView request metadata', () => {
  it.each([
    ['lowercase', '{"x-wg-trace":"true"}', 'true'],
    ['mixed case', '{"x-Wg-TrAcE":"exclude_load_stats"}', 'exclude_load_stats'],
    ['array value', '{"X-wg-TRACE":["true","exclude_load_stats"]}', ['true', 'exclude_load_stats']],
  ])('finds a non-empty %s trace header case-insensitively', (_name, headers, expected) => {
    expect(getTraceHeader(headers)).toEqual(expected);
  });

  it.each(['{}', '{"x-wg-trace":""}', '{"X-WG-TRACE":"   "}', '{"x-wg-trace":[]}'])(
    'ignores a missing or empty trace header: %s',
    (headers) => {
      expect(getTraceHeader(headers)).toBeUndefined();
    },
  );

  it('detects exclude_load_stats through a differently-cased header name', () => {
    expect(traceHeaderIncludes('{"x-Wg-TrAcE":"EXCLUDE_LOAD_STATS"}', 'exclude_load_stats')).toBe(true);
  });

  it('uses the active operation name instead of the first definition', () => {
    const document = parse(`
      query First { __typename }
      subscription Selected { event }
    `);

    expect(isSelectedSubscription(document, 'Selected')).toBe(true);
    expect(isSelectedSubscription(document, 'First')).toBe(false);
  });
});
