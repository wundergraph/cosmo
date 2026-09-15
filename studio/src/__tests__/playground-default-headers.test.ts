import { PLAYGROUND_DEFAULT_HEADERS_TEMPLATE } from '@/lib/constants';
import {
  defaultHeadersToJsonString,
  effectiveDefaultHeadersString,
  mergeDefaultHeaders,
  parseDefaultHeadersJson,
} from '@/lib/playground-headers';
import { describe, expect, test } from 'vitest';

describe('mergeDefaultHeaders', () => {
  test('returns the graph list when there are no personal headers', () => {
    const graph = [{ key: 'x-tenant-id', value: 'acme' }];
    expect(mergeDefaultHeaders(graph, [])).toEqual([{ key: 'x-tenant-id', value: 'acme' }]);
  });

  test('returns the personal list when there are no graph headers', () => {
    const personal = [{ key: 'Authorization', value: 'Bearer me' }];
    expect(mergeDefaultHeaders([], personal)).toEqual([{ key: 'Authorization', value: 'Bearer me' }]);
  });

  test('returns an empty list when both are empty', () => {
    expect(mergeDefaultHeaders([], [])).toEqual([]);
  });

  test('a personal entry overrides the graph value in place, preserving graph order', () => {
    const graph = [
      { key: 'x-tenant-id', value: 'acme' },
      { key: 'Authorization', value: 'Bearer team' },
      { key: 'x-trace', value: 'true' },
    ];
    const personal = [{ key: 'Authorization', value: 'Bearer me' }];

    expect(mergeDefaultHeaders(graph, personal)).toEqual([
      { key: 'x-tenant-id', value: 'acme' },
      { key: 'Authorization', value: 'Bearer me' },
      { key: 'x-trace', value: 'true' },
    ]);
  });

  test('key matching is case-insensitive and the personal spelling wins', () => {
    const graph = [{ key: 'authorization', value: 'Bearer team' }];
    const personal = [{ key: 'Authorization', value: 'Bearer me' }];

    expect(mergeDefaultHeaders(graph, personal)).toEqual([{ key: 'Authorization', value: 'Bearer me' }]);
  });

  test('personal-only keys are appended after the graph keys, in their own order', () => {
    const graph = [{ key: 'a', value: '1' }];
    const personal = [
      { key: 'b', value: '2' },
      { key: 'c', value: '3' },
    ];

    expect(mergeDefaultHeaders(graph, personal)).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' },
    ]);
  });

  test('entries with an empty or whitespace-only key are dropped from both levels', () => {
    const graph = [
      { key: '', value: 'ignored' },
      { key: 'a', value: '1' },
    ];
    const personal = [
      { key: '   ', value: 'ignored' },
      { key: 'b', value: '2' },
    ];

    expect(mergeDefaultHeaders(graph, personal)).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  test('does not mutate its inputs', () => {
    const graph = [{ key: 'a', value: '1' }];
    const personal = [{ key: 'a', value: '2' }];

    mergeDefaultHeaders(graph, personal);

    expect(graph).toEqual([{ key: 'a', value: '1' }]);
    expect(personal).toEqual([{ key: 'a', value: '2' }]);
  });
});

describe('defaultHeadersToJsonString', () => {
  test('serializes to a 2-space indented JSON object', () => {
    const result = defaultHeadersToJsonString([
      { key: 'x-tenant-id', value: 'acme' },
      { key: 'Authorization', value: 'Bearer me' },
    ]);

    expect(result).toBe('{\n  "x-tenant-id": "acme",\n  "Authorization": "Bearer me"\n}');
  });

  test('serializes an empty list to an empty object', () => {
    expect(defaultHeadersToJsonString([])).toBe('{}');
  });
});

describe('effectiveDefaultHeadersString', () => {
  test('falls back to the built-in template when both levels are empty', () => {
    expect(effectiveDefaultHeadersString([], [])).toBe(PLAYGROUND_DEFAULT_HEADERS_TEMPLATE);
  });

  test('falls back to the built-in template when every entry has a blank key', () => {
    expect(effectiveDefaultHeadersString([{ key: '', value: 'x' }], [{ key: '   ', value: 'y' }])).toBe(
      PLAYGROUND_DEFAULT_HEADERS_TEMPLATE,
    );
  });

  test('returns the merged JSON when either level is configured', () => {
    expect(effectiveDefaultHeadersString([{ key: 'x-tenant-id', value: 'acme' }], [])).toBe(
      '{\n  "x-tenant-id": "acme"\n}',
    );
  });

  test('applies the personal override to the merged JSON', () => {
    const result = effectiveDefaultHeadersString(
      [
        { key: 'x-tenant-id', value: 'acme' },
        { key: 'authorization', value: 'Bearer team' },
      ],
      [{ key: 'Authorization', value: 'Bearer me' }],
    );

    expect(result).toBe('{\n  "x-tenant-id": "acme",\n  "Authorization": "Bearer me"\n}');
  });
});

describe('parseDefaultHeadersJson', () => {
  test('parses a JSON object into ordered entries', () => {
    expect(parseDefaultHeadersJson('{"x-tenant-id": "acme", "Authorization": "Bearer me"}')).toEqual({
      success: true,
      entries: [
        { key: 'x-tenant-id', value: 'acme' },
        { key: 'Authorization', value: 'Bearer me' },
      ],
    });
  });

  test.each(['', '   ', '\n'])('treats blank text (%j) as no headers', (text) => {
    expect(parseDefaultHeadersJson(text)).toEqual({ success: true, entries: [] });
  });

  test('accepts an empty object', () => {
    expect(parseDefaultHeadersJson('{}')).toEqual({ success: true, entries: [] });
  });

  test('rejects text that is not JSON', () => {
    expect(parseDefaultHeadersJson('{"a": }')).toEqual({ success: false, error: 'Not valid JSON' });
  });

  test.each(['[]', '"a string"', '42', 'null'])('rejects JSON that is not an object (%s)', (text) => {
    expect(parseDefaultHeadersJson(text)).toEqual({ success: false, error: 'Headers must be a JSON object' });
  });

  test('rejects an empty key', () => {
    expect(parseDefaultHeadersJson('{"": "1"}')).toEqual({
      success: false,
      error: '"" is not a valid HTTP header name',
    });
  });

  test('rejects a key that is not a valid header name', () => {
    expect(parseDefaultHeadersJson('{"bad header": "1"}')).toEqual({
      success: false,
      error: '"bad header" is not a valid HTTP header name',
    });
  });

  test.each([
    ['a number', '{"X-A": 3}', '3'],
    ['a boolean', '{"X-A": true}', 'true'],
  ])('stores a value that is %s as its text', (_label, text, expected) => {
    expect(parseDefaultHeadersJson(text)).toEqual({ success: true, entries: [{ key: 'X-A', value: expected }] });
  });

  test.each([
    ['null', '{"X-A": null}'],
    ['an object', '{"X-A": {}}'],
    ['an array', '{"X-A": []}'],
  ])('rejects a value that is %s', (_label, text) => {
    expect(parseDefaultHeadersJson(text)).toEqual({
      success: false,
      error: 'The value of "X-A" must be a string, number or boolean',
    });
  });

  test('rejects two keys that differ only in case', () => {
    expect(parseDefaultHeadersJson('{"X-A": "1", "x-a": "2"}')).toEqual({
      success: false,
      error: '"x-a" is listed more than once',
    });
  });

  test('round-trips what defaultHeadersToJsonString produces', () => {
    const entries = [
      { key: 'x-tenant-id', value: 'acme' },
      { key: 'Authorization', value: 'Bearer me' },
    ];

    expect(parseDefaultHeadersJson(defaultHeadersToJsonString(entries))).toEqual({ success: true, entries });
  });
});
