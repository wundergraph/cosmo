import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AnalyticsOperator,
  type GetTraceRequest,
  type SearchTracesRequest,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { registerSearchTracesTool } from '../../../src/commands/mcp/analytics/tools/search-traces.js';
import { registerGetTraceTool } from '../../../src/commands/mcp/analytics/tools/get-trace.js';
import { fakeContext } from './fake-context.js';

const okResponse = { response: { code: EnumStatusCode.OK } };

const searchWith = async (input: Record<string, unknown>) => {
  let request: SearchTracesRequest | undefined;
  const { ctx, tools } = fakeContext({
    searchTraces: (req) => {
      request = req;
      return {
        ...okResponse,
        traces: [
          {
            traceId: 't1',
            spanId: 'root',
            timestamp: '2026-10-31T11:00:00Z',
            durationNs: BigInt(53_000_000_000),
            operationName: 'GetOrder',
            clientName: 'web',
            sortDurationNs: BigInt(52_000_000_000),
            matchedSpans: [
              {
                spanId: 's9',
                spanName: 'Engine - Fetch',
                subgraphName: 'products',
                durationNs: BigInt(52_000_000_000),
                condition: 0,
              },
            ],
          },
        ],
        meta: {
          dataset: 'spans',
          completeness: 'sampled',
          observedSamplingRatio: 0.05,
          effectiveWindow: { start: '2026-10-30T12:00:00Z', end: '2026-10-31T12:00:00Z' },
          warnings: [],
          graphs: [{ name: 'shop', namespace: 'default' }],
          nextCursor: 'next',
          truncated: true,
        },
      };
    },
  });
  registerSearchTracesTool(ctx);
  const result = await tools.get('search_traces')!.handler({ graph: 'shop', namespace: 'default', ...input });
  return { request, result };
};

describe('search_traces', () => {
  test('sends span conditions in nanoseconds and request filters as predicates', async () => {
    const { request } = await searchWith({
      operationName: 'GetOrder',
      featureFlag: 'beta',
      attributes: [{ field: 'attr:wg.operation.variables', operator: 'contains', value: 'user-42' }],
      spanConditions: [{ spanName: 'Engine - Fetch', subgraph: 'products', minDurationMs: 50_000 }],
      sort: 'slowest',
      range: '7d',
    });

    expect(request?.requestFilters.map((f) => [f.field, f.operator, f.values])).toEqual([
      ['operationName', AnalyticsOperator.EQ, ['GetOrder']],
      ['featureFlag', AnalyticsOperator.EQ, ['beta']],
      ['attr:wg.operation.variables', AnalyticsOperator.CONTAINS, ['user-42']],
    ]);
    expect(request?.spanConditions.map((c) => [c.spanName, c.subgraphName, c.minDurationNs, c.spanNamePrefix])).toEqual(
      [['Engine - Fetch', 'products', BigInt(50_000_000_000), false]],
    );
    expect(request?.sort).toBe('duration');
    expect(request?.window?.rangeHours).toBe(168);
  });

  test('returns traces in milliseconds with the matched spans, the cursor and the observed sampling ratio', async () => {
    const { result } = await searchWith({ spanConditions: [{ spanName: 'Engine - Fetch' }], sort: 'slowest' });
    const content = result.structuredContent as any;

    expect(content.data.traces).toEqual([
      {
        traceId: 't1',
        spanId: 'root',
        timestamp: '2026-10-31T11:00:00Z',
        durationMs: 53_000,
        operationName: 'GetOrder',
        operationType: '',
        operationHash: '',
        persistedOperationId: '',
        clientName: 'web',
        clientVersion: '',
        httpStatusCode: '',
        hasError: false,
        statusMessage: '',
        slowestMatchMs: 52_000,
        matchedSpans: [
          {
            spanId: 's9',
            spanName: 'Engine - Fetch',
            subgraph: 'products',
            operationName: '',
            durationMs: 52_000,
            condition: 0,
          },
        ],
      },
    ]);
    expect(content.meta.completeness).toBe('sampled');
    expect(content.meta.observedSamplingRatio).toBe(0.05);
    expect(content.meta.nextCursor).toBe('next');
    expect(content.meta.studioUrl).toBe('https://cosmo.wundergraph.com/acme/default/graph/shop/analytics/traces');
  });

  test('caps the page size at 100', async () => {
    const { request } = await searchWith({ limit: 500 });

    expect(request?.limit).toBe(100);
  });
});

const traceWith = async (input: Record<string, unknown>, variables: string) => {
  let request: GetTraceRequest | undefined;
  const { ctx, tools } = fakeContext({
    getFederatedGraphByName: () => ({ ...okResponse, graph: { id: 'graph-1' } }),
    getTrace: (req) => {
      request = req;
      return {
        ...okResponse,
        spans: [
          {
            traceID: req.id,
            spanID: 'root',
            spanName: 'query A',
            timestamp: BigInt(1_000_000_000),
            duration: BigInt(2_500_000),
            rawAttributes: { 'wg.operation.variables': variables },
            resourceAttributes: { 'host.name': 'host-a' },
            events: [
              { name: 'exception', timestamp: BigInt(1_001_000_000), attributes: { 'exception.message': 'boom' } },
            ],
          },
        ],
        summary: {
          durationNs: BigInt(2_500_000),
          spanCount: 1,
          phases: [{ name: 'Operation - Plan', count: 1, totalDurationNs: BigInt(1_000_000) }],
          subgraphs: [],
          criticalPath: [{ spanId: 'root', spanName: 'query A', selfDurationNs: BigInt(2_500_000) }],
          errors: [{ spanId: 'root', spanName: 'query A', kind: 'exception', message: 'boom', code: 'Error' }],
          eventsAvailable: true,
        },
        totalSpans: 1,
      };
    },
  });
  registerGetTraceTool(ctx);
  const result = await tools
    .get('get_trace')!
    .handler({ graph: 'shop', namespace: 'default', traceId: 't1', ...input });
  return { request, result: result.structuredContent as any };
};

describe('get_trace', () => {
  test('asks for the whole trace and its summary, and returns a compact span list by default', async () => {
    const { request, result } = await traceWith({}, 'v');

    expect(request?.spanId).toBe('');
    expect(request?.includeSummary).toBe(true);
    expect(result.data.summary).toEqual({
      durationMs: 2.5,
      spanCount: 1,
      phases: [{ name: 'Operation - Plan', count: 1, totalMs: 1 }],
      subgraphs: [],
      criticalPath: [{ spanId: 'root', spanName: 'query A', subgraph: '', selfMs: 2.5 }],
      errors: [
        { spanId: 'root', spanName: 'query A', subgraph: '', kind: 'exception', code: 'Error', message: 'boom' },
      ],
    });
    expect(result.data.spans).toEqual([
      {
        spanId: 'root',
        parentSpanId: '',
        spanName: 'query A',
        spanKind: '',
        serviceName: '',
        subgraph: '',
        durationMs: 2.5,
        offsetMs: 0,
        statusCode: '',
        statusMessage: '',
      },
    ]);
  });

  test('returns attributes, events and resource attributes in full detail, truncating long values unless full is set', async () => {
    const long = 'x'.repeat(3000);

    const short = (await traceWith({ detail: 'full' }, long)).result;
    const full = (await traceWith({ detail: 'full', full: true }, long)).result;

    expect(short.data.spans[0].attributes['wg.operation.variables'].length).toBe(2048);
    expect(short.meta.warnings).toEqual([
      'Some values were truncated to 2 KB; repeat with full: true for the complete values.',
    ]);
    expect(full.data.spans[0].attributes['wg.operation.variables'].length).toBe(3000);
    expect(full.data.spans[0].events).toEqual([
      { name: 'exception', offsetMs: 1, attributes: { 'exception.message': 'boom' } },
    ]);
    expect(full.data.spans[0].resourceAttributes).toEqual({ 'host.name': 'host-a' });
  });
});
