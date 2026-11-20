import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AnalyticsOperator,
  type GetAnalyticsDimensionValuesRequest,
  type QueryAnalyticsRequest,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { registerQueryAnalyticsTool } from '../../../src/commands/mcp/analytics/tools/query-analytics.js';
import { registerListDimensionValuesTool } from '../../../src/commands/mcp/analytics/tools/list-dimension-values.js';
import { registerComparePeriodsTool } from '../../../src/commands/mcp/analytics/tools/compare-periods.js';
import { registerAnalyzeSpansTool } from '../../../src/commands/mcp/analytics/tools/analyze-spans.js';
import { registerGetErrorBreakdownTool } from '../../../src/commands/mcp/analytics/tools/get-error-breakdown.js';
import { registerListClientsTool } from '../../../src/commands/mcp/analytics/tools/list-clients.js';
import { registerSearchOperationDocumentsTool } from '../../../src/commands/mcp/analytics/tools/search-operation-documents.js';
import { registerGetChangeTimelineTool } from '../../../src/commands/mcp/analytics/tools/get-change-timeline.js';
import { fakeContext } from './fake-context.js';

const okResponse = { response: { code: EnumStatusCode.OK } };

const cell = (value: string | number | boolean) => {
  if (typeof value === 'number') {
    return { kind: { case: 'numberValue' as const, value } };
  }
  if (typeof value === 'boolean') {
    return { kind: { case: 'boolValue' as const, value } };
  }
  return { kind: { case: 'stringValue' as const, value } };
};
const row = (values: Record<string, string | number | boolean>) => ({
  value: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cell(value)])),
});

/** A fake QueryAnalytics that records every request and answers with these rows. */
const queryWith = (rows: Record<string, string | number | boolean>[], columns: string[]) => {
  const requests: QueryAnalyticsRequest[] = [];
  const { ctx, tools } = fakeContext({
    queryAnalytics: (req) => {
      requests.push(req);
      return {
        ...okResponse,
        rows: rows.map((values) => row(values)),
        columns,
        meta: {
          dataset: req.dataset,
          completeness: 'complete',
          warnings: [],
          graphs: [],
          tables: [],
          appliedFilters: [],
        },
      };
    },
    getClients: () => ({
      ...okResponse,
      clients: [{ name: 'web' }, { name: 'legacy', createdAt: '2026-01-01T00:00:00Z' }],
    }),
  });
  return { ctx, tools, requests };
};

describe('query_analytics', () => {
  test('passes the query through and returns plain rows with the server meta', async () => {
    const { ctx, tools, requests } = queryWith(
      [{ operationName: 'GetOrder', requests: 10 }],
      ['operationName', 'requests'],
    );
    registerQueryAnalyticsTool(ctx);

    const result = await tools.get('query_analytics')!.handler({
      allGraphs: true,
      dataset: 'operation_metrics',
      dimensions: ['operationName'],
      measures: ['requests'],
      filters: [{ field: 'clientName', operator: 'in', values: ['web', 'ios'] }],
      having: [{ measure: 'requests', operator: 'gte', value: 5 }],
      timeBucket: '1h',
      range: '7d',
    });

    expect(requests[0].allReadableGraphs).toBe(true);
    expect(requests[0].filters.map((f) => [f.field, f.operator, f.values])).toEqual([
      ['clientName', AnalyticsOperator.IN, ['web', 'ios']],
    ]);
    expect(requests[0].having.map((h) => [h.measure, h.operator, h.value])).toEqual([
      ['requests', AnalyticsOperator.GTE, 5],
    ]);
    expect(requests[0].window?.rangeHours).toBe(168);
    expect(requests[0].timeBucket).toBe('1h');
    expect((result.structuredContent as any).data.rows).toEqual([{ operationName: 'GetOrder', requests: 10 }]);
    expect((result.structuredContent as any).meta.dataset).toBe('operation_metrics');
  });

  test('lists every dataset of the shared catalog in its description', () => {
    const { ctx, tools } = queryWith([], []);
    registerQueryAnalyticsTool(ctx);

    const description = tools.get('query_analytics')!.config.description;
    const catalog = description.split('\n').filter((line) => line.startsWith('- '));
    expect(catalog.map((line) => line.slice(2, line.indexOf(' (')))).toEqual([
      'operation_metrics',
      'subgraph_metrics',
      'planning_metrics',
      'request_volume',
      'requests',
      'spans',
      'field_usage',
      'schema_presence',
      'router_runtime',
      'operation_documents',
    ]);
    expect(catalog.at(-1)).toBe(
      '- operation_documents (complete, operation): Normalized operation documents with traffic inside your retention; filter on `content` to search them. Dimensions: operationHash, operationName, operationType, graph. Measures: document, operations.',
    );
  });

  test('asks for a graph when none is given', async () => {
    const { ctx, tools } = queryWith([], []);
    registerQueryAnalyticsTool(ctx);

    const result = await tools.get('query_analytics')!.handler({ dataset: 'spans' });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Name a graph (graph and namespace), several (graphs), or set allGraphs.' }],
    });
  });
});

describe('list_dimension_values', () => {
  test('lists attribute keys with counts', async () => {
    let request: GetAnalyticsDimensionValuesRequest | undefined;
    const { ctx, tools } = fakeContext({
      getAnalyticsDimensionValues: (req) => {
        request = req;
        return { ...okResponse, values: [{ value: 'x-tenant', count: BigInt(12) }] };
      },
    });
    registerListDimensionValuesTool(ctx);

    const result = await tools.get('list_dimension_values')!.handler({
      graph: 'shop',
      dataset: 'spans',
      dimension: 'attributeKeys',
      prefix: 'x-',
    });

    expect([request?.dataset, request?.dimension, request?.prefix, request?.limit]).toEqual([
      'spans',
      'attributeKeys',
      'x-',
      50,
    ]);
    expect((result.structuredContent as any).data.values).toEqual([{ value: 'x-tenant', count: 12 }]);
  });
});

describe('compare_periods', () => {
  test('compares with the previous period and sorts by the largest relative change of the first measure', async () => {
    const { ctx, tools, requests } = queryWith([], []);
    registerComparePeriodsTool(ctx);

    await tools.get('compare_periods')!.handler({ graph: 'shop', range: '7d', minVolume: 50 });

    expect(requests[0].compare).toEqual({ ...requests[0].compare, previousPeriod: true, minVolume: 50 });
    expect(requests[0].measures).toEqual(['requests', 'errorRate', 'latencyP95']);
    expect(requests[0].orderBy.map((s) => [s.field, s.desc])).toEqual([['requestsDeltaPct', true]]);
  });

  test('uses a custom baseline', async () => {
    const { ctx, tools, requests } = queryWith([], []);
    registerComparePeriodsTool(ctx);

    await tools.get('compare_periods')!.handler({
      graph: 'shop',
      from: '2026-10-30T00:00:00Z',
      to: '2026-10-31T00:00:00Z',
      baselineFrom: '2026-10-23T00:00:00Z',
      baselineTo: '2026-10-24T00:00:00Z',
    });

    expect([
      requests[0].compare?.previousPeriod,
      requests[0].compare?.baselineStart,
      requests[0].compare?.baselineEnd,
    ]).toEqual([false, '2026-10-23T00:00:00Z', '2026-10-24T00:00:00Z']);
  });
});

describe('analyze_spans', () => {
  test('groups the spans of an operation by span name, slowest total first', async () => {
    const { ctx, tools, requests } = queryWith([], []);
    registerAnalyzeSpansTool(ctx);

    await tools.get('analyze_spans')!.handler({ graph: 'shop', operationName: 'GetOrder', subgraph: 'products' });

    expect(requests[0].dataset).toBe('spans');
    expect(requests[0].dimensions).toEqual(['spanName']);
    expect(requests[0].filters.map((f) => [f.field, f.values])).toEqual([
      ['operationName', ['GetOrder']],
      ['subgraphName', ['products']],
    ]);
    expect(requests[0].orderBy.map((s) => s.field)).toEqual(['durationSum']);
  });
});

describe('get_error_breakdown', () => {
  test('returns complete error counts and sampled failures by subgraph', async () => {
    const { ctx, tools, requests } = queryWith([{ subgraphName: 'inventory', count: 3 }], ['subgraphName', 'count']);
    registerGetErrorBreakdownTool(ctx);

    const result = await tools.get('get_error_breakdown')!.handler({ graph: 'shop', by: 'subgraph' });

    expect(requests.map((r) => r.dataset)).toEqual(['operation_metrics', 'spans']);
    expect(requests[0].having.map((h) => [h.measure, h.operator, h.value])).toEqual([
      ['errors', AnalyticsOperator.GT, 0],
    ]);
    expect(requests[1].filters.map((f) => [f.field, f.values])).toEqual([
      ['hasError', ['true']],
      ['spanName', ['Engine - Fetch']],
    ]);
    expect((result.structuredContent as any).data.sampled).toEqual([{ subgraphName: 'inventory', count: 3 }]);
  });
});

describe('list_clients', () => {
  test('lists clients with traffic and registered clients without any', async () => {
    const { ctx, tools } = queryWith(
      [{ clientName: 'web', clientVersion: '1.0', requests: 10 }],
      ['clientName', 'clientVersion', 'requests'],
    );
    registerListClientsTool(ctx);

    const result = await tools.get('list_clients')!.handler({ graph: 'shop' });
    const data = (result.structuredContent as any).data;

    expect(data.clients).toEqual([{ clientName: 'web', clientVersion: '1.0', requests: 10 }]);
    expect(data.registeredWithoutTraffic).toEqual([
      { clientName: 'legacy', registeredAt: '2026-01-01T00:00:00Z', persistedOperations: null },
    ]);
  });
});

describe('search_operation_documents', () => {
  test('searches documents containing a text and truncates long ones', async () => {
    const { ctx, tools, requests } = queryWith(
      [{ operationHash: 'h', operationName: 'A', operationType: 'query', document: `query A { ${'x'.repeat(3000)} }` }],
      ['operationHash', 'operationName', 'operationType', 'document'],
    );
    registerSearchOperationDocumentsTool(ctx);

    const result = await tools.get('search_operation_documents')!.handler({ graph: 'shop', contains: 'legacyField' });

    expect(requests[0].dataset).toBe('operation_documents');
    expect(requests[0].filters.map((f) => [f.field, f.operator, f.values])).toEqual([
      ['content', AnalyticsOperator.CONTAINS, ['legacyField']],
    ]);
    expect(requests[0].window).toBe(undefined);
    expect((result.structuredContent as any).data.operations[0].document.length).toBe(2048);
  });
});

describe('get_change_timeline', () => {
  test('asks for both ends of an explicit window', async () => {
    const { ctx, tools } = fakeContext({});
    registerGetChangeTimelineTool(ctx);

    const result = await tools.get('get_change_timeline')!.handler({ graph: 'shop', to: '2026-10-31T00:00:00Z' });

    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'from and to must be given together.' }] });
  });

  test('joins compositions with their schema changes over the last 7 days', async () => {
    let compositionsWindow: string[] = [];
    const { ctx, tools } = fakeContext({
      getCompositions: (req) => {
        compositionsWindow = [req.startDate, req.endDate];
        return {
          ...okResponse,
          compositions: [
            {
              id: 'c1',
              schemaVersionId: 'v1',
              createdAt: '2026-10-30T10:00:00Z',
              isComposable: true,
              isLatestValid: true,
              createdBy: 'alice@example.com',
              isFeatureFlagComposition: false,
              triggeredBySubgraphName: 'products',
            },
          ],
        };
      },
      getFederatedGraphChangelog: () => ({
        ...okResponse,
        federatedGraphChangelogOutput: [
          {
            schemaVersionId: 'v1',
            changelogs: [
              { changeType: 'FIELD_ADDED', path: 'Query.orders', changeMessage: "Field 'orders' was added" },
            ],
          },
        ],
      }),
    });
    registerGetChangeTimelineTool(ctx);

    const result = await tools.get('get_change_timeline')!.handler({ graph: 'shop' });

    expect(compositionsWindow).toEqual(['2026-10-24T12:00:00.000Z', '2026-10-31T12:00:00.000Z']);
    expect((result.structuredContent as any).data.events).toEqual([
      {
        time: '2026-10-30T10:00:00Z',
        compositionId: 'c1',
        schemaVersionId: 'v1',
        composed: true,
        isLatestValid: true,
        featureFlag: '',
        triggeredBy: 'alice@example.com',
        triggeredBySubgraph: 'products',
        errors: '',
        schemaChanges: [{ type: 'FIELD_ADDED', path: 'Query.orders', message: "Field 'orders' was added" }],
      },
    ]);
  });
});
