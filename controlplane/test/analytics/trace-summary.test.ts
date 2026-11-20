import { describe, expect, test } from 'vitest';
import { summarizeTrace, type SummarySpan } from '../../src/core/repositories/analytics/traceSummary.js';

const ms = (value: number) => BigInt(value) * 1_000_000n;

const span = (
  spanId: string,
  parentSpanId: string,
  spanName: string,
  startMs: number,
  endMs: number,
  extra: Partial<SummarySpan> = {},
): SummarySpan => ({
  spanId,
  parentSpanId,
  spanName,
  start: ms(1000) + ms(startMs),
  durationNs: ms(endMs - startMs),
  statusCode: 'STATUS_CODE_UNSET',
  statusMessage: '',
  attributes: {},
  events: [],
  ...extra,
});

// A request whose execute phase fetches two subgraphs in parallel, then one more: the slow, failing inventory fetch
// is on the critical path, the faster parallel products fetch is not.
const trace: SummarySpan[] = [
  span('root', '', 'query GetOrder', 0, 100),
  span('parse', 'root', 'Operation - Parse', 0, 5),
  span('normalize', 'root', 'Operation - Normalize', 5, 10),
  span('plan', 'root', 'Operation - Plan', 10, 20),
  span('execute', 'root', 'Operation - Execute', 20, 100),
  span('fetch-a', 'execute', 'Engine - Fetch', 25, 60, { attributes: { 'wg.subgraph.name': 'products' } }),
  span('fetch-b', 'execute', 'Engine - Fetch', 25, 90, {
    attributes: { 'wg.subgraph.name': 'inventory', 'http.status_code': '500' },
    statusCode: 'STATUS_CODE_ERROR',
    statusMessage: 'Failed to fetch from Subgraph',
    events: [
      {
        name: 'Downstream error 1',
        attributes: { 'wg.subgraph.error.extended_code': 'NOT_FOUND', 'wg.subgraph.error.message': 'no stock' },
      },
    ],
  }),
  span('http-b', 'fetch-b', 'query inventory', 26, 89, {
    events: [{ name: 'exception', attributes: { 'exception.type': 'Error', 'exception.message': 'boom' } }],
  }),
  span('fetch-c', 'execute', 'Engine - Fetch', 90, 98, { attributes: { 'wg.subgraph.name': 'products' } }),
];

describe('summarizeTrace', () => {
  const summary = summarizeTrace(trace, true);

  test('adds up time per router phase', () => {
    expect(summary.phases).toEqual([
      { name: 'Operation - Parse', count: 1, totalDurationNs: ms(5) },
      { name: 'Operation - Normalize', count: 1, totalDurationNs: ms(5) },
      { name: 'Operation - Plan', count: 1, totalDurationNs: ms(10) },
      { name: 'Operation - Execute', count: 1, totalDurationNs: ms(80) },
    ]);
    expect(summary.durationNs).toBe(ms(100));
    expect(summary.spanCount).toBe(9);
  });

  test('walks the critical path through the fetch that ends last, and it covers the whole request', () => {
    expect(summary.criticalPath.map((s) => [s.spanId, s.subgraphName, s.selfDurationNs])).toEqual([
      ['root', '', 0n],
      ['execute', '', ms(7)],
      ['fetch-c', 'products', ms(8)],
      ['fetch-b', 'inventory', ms(2)],
      ['http-b', 'inventory', ms(63)],
      ['plan', '', ms(10)],
      ['normalize', '', ms(5)],
      ['parse', '', ms(5)],
    ]);
    expect(summary.criticalPath.reduce((sum, s) => sum + s.selfDurationNs, 0n)).toBe(ms(100));
  });

  test('reports each subgraph’s fetches and its share of the critical path', () => {
    expect(summary.subgraphs).toEqual([
      {
        subgraphName: 'inventory',
        fetches: 1,
        totalDurationNs: ms(65),
        maxDurationNs: ms(65),
        criticalPathNs: ms(65),
        errors: 1,
      },
      {
        subgraphName: 'products',
        fetches: 2,
        totalDurationNs: ms(43),
        maxDurationNs: ms(35),
        criticalPathNs: ms(8),
        errors: 0,
      },
    ]);
  });

  test('lists status errors, downstream subgraph errors and exceptions, attributed to the subgraph', () => {
    expect(summary.errors).toEqual([
      {
        spanId: 'fetch-b',
        spanName: 'Engine - Fetch',
        subgraphName: 'inventory',
        kind: 'status',
        message: 'Failed to fetch from Subgraph',
        code: '500',
      },
      {
        spanId: 'fetch-b',
        spanName: 'Engine - Fetch',
        subgraphName: 'inventory',
        kind: 'downstream',
        message: 'no stock',
        code: 'NOT_FOUND',
      },
      {
        spanId: 'http-b',
        spanName: 'query inventory',
        subgraphName: 'inventory',
        kind: 'exception',
        message: 'boom',
        code: 'Error',
      },
    ]);
  });

  test('handles a trace without its root (the span started elsewhere) and an empty trace', () => {
    const orphan = summarizeTrace([span('only', 'missing-parent', 'Engine - Fetch', 0, 10)], false);
    expect(orphan.criticalPath).toEqual([
      { spanId: 'only', spanName: 'Engine - Fetch', subgraphName: '', selfDurationNs: ms(10) },
    ]);
    expect(orphan.eventsAvailable).toBe(false);
    expect(summarizeTrace([], true).criticalPath).toEqual([]);
  });
});

describe('timestampToNanoseconds', () => {
  test('reads ClickHouse DateTime64(9) values as UTC, whatever the server time zone', async () => {
    const { timestampToNanoseconds } = await import('../../src/core/repositories/analytics/util.js');
    expect(timestampToNanoseconds('2026-11-20 10:00:00.000000123')).toBe(1_795_168_800_000_000_123n);
    expect(timestampToNanoseconds('2026-11-20 10:00:00')).toBe(1_795_168_800_000_000_000n);
  });
});
