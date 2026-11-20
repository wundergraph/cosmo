import { describe, expect, test } from 'vitest';
import type { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { QueryBudgetError } from '../../src/core/repositories/analytics/query/errors.js';
import { TraceRepository } from '../../src/core/repositories/analytics/TraceRepository.js';
import { TraceSearchRepository } from '../../src/core/repositories/analytics/TraceSearchRepository.js';

const spanRow = (spanId: string, parentSpanId: string, statusCode = 'STATUS_CODE_UNSET') => ({
  timestamp: '2026-11-20 10:00:00.000000000',
  traceId: 't1',
  spanId,
  parentSpanId,
  spanName: 'Engine - Fetch',
  spanKind: 'SPAN_KIND_CLIENT',
  duration: '1000',
  serviceName: 'cosmo-router',
  statusCode,
  statusMessage: '',
  scopeName: 'cosmo.router',
  organizationId: 'org-1',
  federatedGraphId: 'g-1',
  rawAttributes: {},
  resourceAttributes: {},
  eventTimestamps: [],
  eventNames: [],
  eventAttributes: [],
});

describe('TraceRepository', () => {
  test('summarizes every span it read, even when it returns fewer', async () => {
    const client = {
      database: 'cosmo',
      queryPromise: () =>
        Promise.resolve([spanRow('a', ''), spanRow('b', 'a'), spanRow('c', 'a', 'STATUS_CODE_ERROR')]),
    } as unknown as ClickHouseClient;

    const trace = await new TraceRepository(client).getTrace({
      traceId: 't1',
      organizationId: 'org-1',
      federatedGraphId: 'g-1',
      retentionDays: 7,
      maxSpans: 2,
    });

    expect(trace.spans.map((span) => span.spanID)).toEqual(['a', 'b']);
    expect(trace.summarySpans.map((span) => span.spanId)).toEqual(['a', 'b', 'c']);
    expect([trace.truncated, trace.totalSpans]).toEqual([true, 3]);
  });
});

describe('TraceSearchRepository', () => {
  test('checks the row budget before a search on request filters alone', async () => {
    let queried = false;
    const client = {
      database: 'cosmo',
      estimateRows: () => Promise.resolve(5_000_000),
      queryPromise: () => {
        queried = true;
        return Promise.resolve([]);
      },
    } as unknown as ClickHouseClient;

    await expect(
      new TraceSearchRepository(client, 1_000_000).search({
        organizationId: 'org-1',
        graphId: 'g-1',
        window: { start: 0, end: 3600 },
        requestFilters: [],
        operationFilters: [],
        needsRootSpans: false,
        spanConditions: [],
        sort: 'timestamp',
        limit: 20,
      }),
    ).rejects.toThrow(
      new QueryBudgetError(
        'This search would read about 5,000,000 sampled requests (limit 1,000,000). Narrow the window (e.g. 6h) or add a filter such as operationName or clientName.',
      ),
    );
    expect(queried).toBe(false);
  });
});
