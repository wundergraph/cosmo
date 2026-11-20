import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { GetGraphMetricsRequest } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ok } from '../../../src/commands/mcp/analytics/envelope.js';
import { registerGetAnalyticsContextTool } from '../../../src/commands/mcp/analytics/tools/get-analytics-context.js';
import { registerGetGraphOverviewTool } from '../../../src/commands/mcp/analytics/tools/get-graph-overview.js';
import { registerListRoutersTool } from '../../../src/commands/mcp/analytics/tools/list-routers.js';
import { fakeContext } from './fake-context.js';

describe('ok', () => {
  test('returns protobuf messages as plain JSON (no $typeName, bigints as strings)', () => {
    const result = ok(
      { $typeName: 'x.Y', count: BigInt(5), nested: [{ $typeName: 'x.Z', a: 1 }] },
      {
        completeness: 'complete',
        now: '2026-10-31T12:00:00Z',
        warnings: [],
      },
    );

    expect(result.structuredContent).toEqual({
      data: { count: '5', nested: [{ a: 1 }] },
      meta: { completeness: 'complete', now: '2026-10-31T12:00:00Z', warnings: [] },
    });
  });
});

describe('get_graph_overview', () => {
  const okResponse = { response: { code: EnumStatusCode.OK } };

  test('asks for the requested window and reports complete data', async () => {
    let metricsRequest: GetGraphMetricsRequest | undefined;
    const { ctx, tools } = fakeContext({
      getGraphMetrics: (req) => {
        metricsRequest = req;
        return { ...okResponse, requests: { value: '10', top: [], series: [] }, resolution: '15' };
      },
      getMetricsErrorRate: () => ({ ...okResponse, series: [] }),
      getDashboardAnalyticsView: () => ({ ...okResponse, mostRequestedOperations: [], subgraphMetrics: [] }),
    });
    registerGetGraphOverviewTool(ctx);

    const result = await tools
      .get('get_graph_overview')!
      .handler({ graph: 'shop', namespace: 'default', range: '24h' });

    expect(metricsRequest?.range).toBe(24);
    expect(metricsRequest?.federatedGraphName).toBe('shop');
    expect((result.structuredContent as any).meta.completeness).toBe('complete');
    expect((result.structuredContent as any).meta.studioUrl).toBe(
      'https://cosmo.wundergraph.com/acme/default/graph/shop/analytics?range=24',
    );
  });

  test('reports a missing graph without saying whether it exists', async () => {
    const notFound = { response: { code: EnumStatusCode.ERR_NOT_FOUND } };
    const { ctx, tools } = fakeContext({
      getGraphMetrics: () => notFound,
      getMetricsErrorRate: () => notFound,
      getDashboardAnalyticsView: () => notFound,
    });
    registerGetGraphOverviewTool(ctx);

    const result = await tools.get('get_graph_overview')!.handler({ graph: 'nope', namespace: 'default' });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Graph not found or you have no access.' }],
    });
  });

  test('returns an error result when the controlplane call fails', async () => {
    const { ctx, tools } = fakeContext({
      getGraphMetrics: () => {
        throw new Error('Analytical service is currently unavailable');
      },
      getMetricsErrorRate: () => okResponse,
      getDashboardAnalyticsView: () => okResponse,
    });
    registerGetGraphOverviewTool(ctx);

    const result = await tools.get('get_graph_overview')!.handler({ graph: 'shop', namespace: 'default' });

    expect(result.isError).toBe(true);
  });
});

describe('get_analytics_context', () => {
  test('returns the capabilities with the organization and auth mode', async () => {
    const { ctx, tools } = fakeContext({
      getAnalyticsCapabilities: () => ({
        response: { code: EnumStatusCode.OK },
        now: '2026-10-31T12:00:00Z',
        principalType: 'user',
        retention: [{ family: 'tracing', planDays: 7, storageTtlDays: 30, effectiveDays: 7 }],
        traceSamplingRateLimit: 0.1,
        analyticsEnabled: true,
        warnings: [],
      }),
    });
    registerGetAnalyticsContextTool(ctx);

    const result = await tools.get('get_analytics_context')!.handler({});
    const data = (result.structuredContent as any).data;

    expect(data.organizationSlug).toBe('acme');
    expect(data.authMode).toBe('user');
    expect(data.retention).toEqual([{ family: 'tracing', planDays: 7, storageTtlDays: 30, effectiveDays: 7 }]);
    expect(data.traceSamplingRateLimit).toBe(0.1);
  });
});

describe('list_routers', () => {
  test('lists the router instances of a graph', async () => {
    const { ctx, tools } = fakeContext({
      getRouters: (req) => ({
        response: { code: EnumStatusCode.OK },
        routers: [{ hostname: `${req.fedGraphName}-1`, serviceVersion: '0.200.0', onLatestComposition: true }],
      }),
    });
    registerListRoutersTool(ctx);

    const result = await tools.get('list_routers')!.handler({ graph: 'shop', namespace: 'default' });
    const routers = (result.structuredContent as any).data.routers;

    expect(routers.length).toBe(1);
    expect(routers[0].hostname).toBe('shop-1');
    expect(routers[0].onLatestComposition).toBe(true);
  });
});
