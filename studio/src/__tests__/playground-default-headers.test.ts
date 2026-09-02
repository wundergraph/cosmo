import { PLAYGROUND_DEFAULT_HEADERS_TEMPLATE } from '@/lib/constants';
import {
  defaultHeadersToJsonString,
  effectiveDefaultHeadersString,
  mergeDefaultHeaders,
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
