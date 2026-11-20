import { afterAll, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { AnalyticsOperator } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { toIso } from '../../src/core/repositories/analytics/query/window.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  genID,
} from '../../src/core/test-util.js';
import { createFederatedGraphWithSubgraph, createNamespace, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';
import { queryCalls } from './fake-clickhouse.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  ClickHouseClient.prototype.estimateRows = vi.fn();
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

describe('QueryAnalytics', () => {
  let chClient: ClickHouseClient;

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
    vi.clearAllMocks();
    (chClient.estimateRows as Mock).mockResolvedValue(0);
  });

  test('returns typed rows in column order for a metric dataset', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([
      { d_operationName: 'GetOrder', m_requests: '18234', m_errorRate: 1.5 },
      { d_operationName: 'ListOrders', m_requests: '200', m_errorRate: 0 },
    ]);

    const response = await client.queryAnalytics({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'operation_metrics',
      dimensions: ['operationName'],
      measures: ['requests', 'errorRate'],
      window: { rangeHours: 24 },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.columns).toEqual(['operationName', 'requests', 'errorRate']);
    expect(
      response.rows.map((row) =>
        Object.fromEntries(Object.entries(row.value).map(([key, value]) => [key, value.kind.value])),
      ),
    ).toEqual([
      { operationName: 'GetOrder', requests: 18_234, errorRate: 1.5 },
      { operationName: 'ListOrders', requests: 200, errorRate: 0 },
    ]);
    expect(response.meta?.dataset).toBe('operation_metrics');
    expect(response.meta?.completeness).toBe('complete');
    expect(response.meta?.truncated).toBe(false);
    expect(response.meta?.graphs.map((g) => [g.name, g.namespace])).toEqual([[graphName, DEFAULT_NAMESPACE]]);
  });

  test('reads every graph the caller may read for allGraphs, with namespace and graph rules combined', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const namespace = await createNamespace(client, genID('ns'));
    const { name: inNamespace } = await createFederatedGraphWithSubgraph(client, namespace);
    const { name: granted, targetId: grantedTarget } = await createFederatedGraphWithSubgraph(client);
    await createFederatedGraphWithSubgraph(client);
    const namespaceId = (await client.getNamespaces({})).namespaces.find((n) => n.name === namespace)!.id;
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(
        createTestGroup({ role: 'graph-viewer', namespaces: [namespaceId], resources: [grantedTarget] }),
      ),
    });
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.queryAnalytics({
      allReadableGraphs: true,
      dataset: 'operation_metrics',
      measures: ['requests'],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.meta?.graphs.map((g) => `${g.namespace}/${g.name}`).sort()).toEqual(
      [`${namespace}/${inNamespace}`, `${DEFAULT_NAMESPACE}/${granted}`].sort(),
    );
  });

  test('pages with an opaque cursor that keeps the window', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([
      { d_operationName: 'A', m_requests: '3' },
      { d_operationName: 'B', m_requests: '2' },
      { d_operationName: 'C', m_requests: '1' },
    ]);
    const request = {
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'operation_metrics',
      dimensions: ['operationName'],
      measures: ['requests'],
      limit: 2,
      window: { rangeHours: 24 },
    };

    const first = await client.queryAnalytics(request);
    const second = await client.queryAnalytics({ ...request, cursor: first.meta?.nextCursor });

    expect(first.rows.length).toBe(2);
    expect(first.meta?.truncated).toBe(true);
    const [firstCall, secondCall] = queryCalls(chClient);
    expect([firstCall.params.limit, firstCall.params.offset]).toEqual([3, 0]);
    expect([secondCall.params.limit, secondCall.params.offset]).toEqual([3, 2]);
    expect([secondCall.params.start, secondCall.params.end]).toEqual([firstCall.params.start, firstCall.params.end]);
    expect(second.response?.code).toBe(EnumStatusCode.OK);
  });

  test('refuses a cursor from another query', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([{ d_operationName: 'A' }, { d_operationName: 'B' }]);
    const graphs = [{ name: graphName, namespace: DEFAULT_NAMESPACE }];
    const first = await client.queryAnalytics({
      graphs,
      dataset: 'operation_metrics',
      dimensions: ['operationName'],
      limit: 1,
    });

    const response = await client.queryAnalytics({
      graphs,
      dataset: 'operation_metrics',
      dimensions: ['clientName'],
      limit: 1,
      cursor: first.meta?.nextCursor,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('The cursor belongs to a different query; repeat the query without it.');
  });

  test('clamps the window to the plan retention and says so', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.queryAnalytics({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'operation_metrics',
      window: { rangeHours: 24 * 30 },
    });

    expect(response.meta?.warnings).toEqual([
      "Window clamped to 7 days by your plan's analytics retention.",
      'Latency percentiles come from histograms capped at 10s: values at or above it read as 10000ms.',
    ]);
    const { params } = queryCalls(chClient)[0];
    const now = Math.floor(Date.now() / 1000);
    expect(params.start).toBeGreaterThanOrEqual(Math.floor((now - 7 * 86_400 - 300) / 300) * 300);
    expect(params.start % 300).toBe(0);
  });

  test('refuses a window entirely outside retention without querying', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);

    const response = await client.queryAnalytics({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'spans',
      window: {
        start: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        end: new Date(Date.now() - 15 * 86_400_000).toISOString(),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe("The requested window is outside your plan's retention.");
    expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
  });

  test('answers an unknown graph and a missing one alike', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const response = await client.queryAnalytics({
      graphs: [{ name: 'does-not-exist', namespace: DEFAULT_NAMESPACE }],
      dataset: 'operation_metrics',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toBe('Graph not found or you have no access.');
  });

  test('explains what is wrong with the query, naming the alternatives', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    const graphs = [{ name: graphName, namespace: DEFAULT_NAMESPACE }];

    const unknownDataset = await client.queryAnalytics({ graphs, dataset: 'nope' });
    const unknownMeasure = await client.queryAnalytics({ graphs, dataset: 'request_volume', measures: ['latencyP95'] });
    const badOperator = await client.queryAnalytics({
      graphs,
      dataset: 'operation_metrics',
      filters: [{ field: 'operationHash', operator: AnalyticsOperator.CONTAINS, values: ['x'] }],
    });

    expect(unknownDataset.response?.details).toBe(
      'Unknown dataset "nope". Available: operation_metrics, subgraph_metrics, planning_metrics, request_volume, requests, spans, field_usage, schema_presence, router_runtime, operation_documents.',
    );
    expect(unknownMeasure.response?.details).toBe(
      'Unknown measure "latencyP95" for request_volume. Available: requests, firstSeen, lastSeen.',
    );
    expect(badOperator.response?.details).toBe('operationHash supports eq, neq, in, not_in, not contains.');
    expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
  });

  test('refuses a sampled-data query over the row budget with a way to narrow it', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.estimateRows as Mock).mockResolvedValue(900_000_000);

    const response = await client.queryAnalytics({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'spans',
      dimensions: ['spanName'],
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe(
      'This query would read about 900,000,000 sampled rows (limit 200,000,000). Narrow the window (e.g. 6h) or add a filter such as operationName or spanName.',
    );
    expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
  });

  test('compares with the previous period and adds the deltas', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.queryPromise as Mock)
      .mockResolvedValueOnce([{ d_operationName: 'A', m_requests: '150' }])
      .mockResolvedValueOnce([
        { d_operationName: 'A', m_requests: '100' },
        { d_operationName: 'Gone', m_requests: '40' },
      ]);

    const response = await client.queryAnalytics({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'operation_metrics',
      dimensions: ['operationName'],
      measures: ['requests'],
      compare: { previousPeriod: true },
      window: { rangeHours: 6 },
    });

    expect(response.columns).toEqual([
      'operationName',
      'requests',
      'requestsBaseline',
      'requestsDelta',
      'requestsDeltaPct',
    ]);
    expect(
      response.rows.map((row) =>
        Object.fromEntries(Object.entries(row.value).map(([key, value]) => [key, value.kind.value ?? null])),
      ),
    ).toEqual([
      { operationName: 'A', requests: 150, requestsBaseline: 100, requestsDelta: 50, requestsDeltaPct: 50 },
      { operationName: 'Gone', requests: 0, requestsBaseline: 40, requestsDelta: -40, requestsDeltaPct: -100 },
    ]);
    // The same length just before the window, on whole 5-minute buckets, ending a second before it starts.
    const [current, baseline] = queryCalls(chClient);
    const start = Math.floor((current.params.start - (current.params.end - current.params.start) - 1) / 300) * 300;
    expect([baseline.params.start, baseline.params.end]).toEqual([start, current.params.start - 1]);
    expect([response.meta?.baselineWindow?.start, response.meta?.baselineWindow?.end]).toEqual([
      toIso(start),
      toIso(current.params.start - 1),
    ]);
  });
});
