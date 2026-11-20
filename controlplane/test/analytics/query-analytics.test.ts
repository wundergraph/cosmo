import { afterAll, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { AnalyticsOperator } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { toIso } from '../../src/core/repositories/analytics/query/window.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import {
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  SetupTest,
} from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  ClickHouseClient.prototype.estimateRows = vi.fn();
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

const setupGraph = async (client: Awaited<ReturnType<typeof SetupTest>>['client'], namespace = DEFAULT_NAMESPACE) => {
  const fedGraphName = genID('fedGraph');
  const label = genUniqueLabel();
  await createThenPublishSubgraph(
    client,
    genID('subgraph'),
    namespace,
    'type Query { hello: String! }',
    [label],
    'http://localhost:4001',
  );
  await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:3000');
  return fedGraphName;
};

const rootRow = (traceId: string, ts: number, operationName: string) => ({
  traceId,
  spanId: 'root',
  ts,
  duration: '41000000000',
  operationName,
  operationType: 'query',
  operationHash: '',
  operationPersistedId: '',
  clientName: 'web',
  clientVersion: '',
  httpStatusCode: '200',
  statusMessage: '',
  hasError: false,
});

const queryCalls = (chClient: ClickHouseClient) =>
  (chClient.queryPromise as Mock).mock.calls.map(([sql, params]) => ({ sql: sql as string, params }));

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
    const graphName = await setupGraph(client);
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
    const inNamespace = await setupGraph(client, namespace);
    const granted = await setupGraph(client);
    await setupGraph(client);
    const namespaceId = (await client.getNamespaces({})).namespaces.find((n) => n.name === namespace)!.id;
    const grantedTarget = (await client.getFederatedGraphByName({ name: granted, namespace: DEFAULT_NAMESPACE })).graph!
      .targetId;
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
    const graphName = await setupGraph(client);
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
    const graphName = await setupGraph(client);
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
    const graphName = await setupGraph(client);
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
    const graphName = await setupGraph(client);

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
    const graphName = await setupGraph(client);
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
    const graphName = await setupGraph(client);
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
    const graphName = await setupGraph(client);
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

describe('GetAnalyticsDimensionValues', () => {
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

  test('lists span attribute keys with counts', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphName = await setupGraph(client);
    // The prefix is applied in SQL, before the limit, so ClickHouse returns only matching keys.
    (chClient.queryPromise as Mock).mockResolvedValue([{ d_attributeKeys: 'x-tenant', m_count: '12' }]);

    const response = await client.getAnalyticsDimensionValues({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'spans',
      dimension: 'attributeKeys',
      prefix: 'x-',
    });

    expect(response.values.map((v) => [v.value, v.count])).toEqual([['x-tenant', 12n]]);
    expect(queryCalls(chClient)[0].sql).toBe(
      'SELECT arrayJoin(mapKeys(SpanAttributes)) AS d_attributeKeys, count() AS m_count FROM cosmo.span_search WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND TimeBucket >= toStartOfFifteenMinutes(toDateTime({start:UInt32})) AND TimeBucket <= toStartOfFifteenMinutes(toDateTime({end:UInt32})) AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND startsWith(d_attributeKeys, {f0:String}) GROUP BY d_attributeKeys ORDER BY m_count DESC, d_attributeKeys ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}',
    );
    expect(queryCalls(chClient)[0].params.f0).toBe('x-');
  });
});

describe('SearchTraces', () => {
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

  test('finds traces with a slow fetch to a subgraph and returns the matching spans', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphName = await setupGraph(client);
    (chClient.queryPromise as Mock).mockImplementation((sql: string) => {
      if (sql.includes('FROM cosmo.span_search WHERE') && sql.startsWith('WITH')) {
        return Promise.resolve([
          {
            traceId: 't1',
            sortNumber: '52000000000',
            m0: [['s9', 'Engine - Fetch', 'products', '52000000000', 'GetOrder']],
          },
        ]);
      }
      if (sql.includes('TraceId IN {traceIds:Array(String)}')) {
        return Promise.resolve([
          {
            traceId: 't1',
            spanId: 'root',
            ts: 1_793_448_000,
            duration: '53000000000',
            operationName: 'GetOrder',
            operationType: 'query',
            operationHash: 'h',
            operationPersistedId: '',
            clientName: 'web',
            clientVersion: '1',
            httpStatusCode: '200',
            statusMessage: '',
            hasError: false,
          },
        ]);
      }
      return Promise.resolve([{ sampled: '5', total: '100' }]);
    });

    const response = await client.searchTraces({
      graph: { name: graphName, namespace: DEFAULT_NAMESPACE },
      spanConditions: [{ spanName: 'Engine - Fetch', subgraphName: 'products', minDurationNs: 50_000_000_000n }],
      sort: 'duration',
      window: { rangeHours: 24 },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.traces.map((t) => [t.traceId, t.spanId, t.durationNs, t.sortDurationNs, t.operationName])).toEqual([
      ['t1', 'root', 53_000_000_000n, 52_000_000_000n, 'GetOrder'],
    ]);
    expect(
      response.traces[0].matchedSpans.map((s) => [s.spanId, s.spanName, s.subgraphName, s.durationNs, s.condition]),
    ).toEqual([['s9', 'Engine - Fetch', 'products', 52_000_000_000n, 0]]);
    expect(response.meta?.dataset).toBe('spans');
    expect(response.meta?.completeness).toBe('sampled');
    expect(response.meta?.observedSamplingRatio).toBe(0.05);
    const search = queryCalls(chClient).find((c) => c.sql.startsWith('WITH'))!;
    expect(search.sql).toBe(
      'WITH (SpanName = {spanName0:String} AND SubgraphName = {subgraph0:String} AND Duration >= {spanMin0:Int64}) AS c0 SELECT TraceId AS traceId, maxIf(Duration, c0) AS sortNumber, groupArrayIf(5)(tuple(SpanId, SpanName, SubgraphName, Duration, OperationName), c0) AS m0 FROM cosmo.span_search WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND TimeBucket >= toStartOfFifteenMinutes(toDateTime({start:UInt32})) AND TimeBucket <= toStartOfFifteenMinutes(toDateTime({end:UInt32})) AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND (c0) GROUP BY TraceId HAVING countIf(c0) > 0 ORDER BY sortNumber DESC, TraceId DESC LIMIT {limit:UInt32}',
    );
  });

  test('keeps root rows in the scan when a root-span predicate is combined with a span condition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphName = await setupGraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    await client.searchTraces({
      graph: { name: graphName, namespace: DEFAULT_NAMESPACE },
      requestFilters: [{ field: 'featureFlag', operator: AnalyticsOperator.EQ, values: ['beta'] }],
      spanConditions: [{ spanName: 'Operation - Plan', minDurationNs: 1_000_000n }],
    });

    const search = queryCalls(chClient).find((c) => c.sql.startsWith('WITH'))!;
    expect(search.sql).toBe(
      'WITH (SpanName = {spanName0:String} AND Duration >= {spanMin0:Int64}) AS c0, (IsRoot AND FeatureFlag = {f0:String}) AS r SELECT TraceId AS traceId, toUnixTimestamp64Nano(min(Timestamp)) AS sortNumber, groupArrayIf(5)(tuple(SpanId, SpanName, SubgraphName, Duration, OperationName), c0) AS m0 FROM cosmo.span_search WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND TimeBucket >= toStartOfFifteenMinutes(toDateTime({start:UInt32})) AND TimeBucket <= toStartOfFifteenMinutes(toDateTime({end:UInt32})) AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND (c0 OR r) GROUP BY TraceId HAVING countIf(c0) > 0 AND countIf(r) > 0 ORDER BY sortNumber DESC, TraceId DESC LIMIT {limit:UInt32}',
    );
  });

  test('reads only traces_detail_by_time for request filters, and also matches batched operations', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphName = await setupGraph(client);
    (chClient.queryPromise as Mock).mockImplementation((sql: string) => {
      if (sql.includes('TraceId IN {batchTraceIds:Array(String)}')) {
        return Promise.resolve([rootRow('batched', 1_793_448_100, '')]);
      }
      if (sql.includes("SpanAttributes['wg.operation.batching.operation_index'] != ''")) {
        return Promise.resolve([
          { traceId: 'batched', spans: [['b0', 'query GetOrder', '', '40000000000', 'GetOrder']] },
        ]);
      }
      if (sql.includes('FROM cosmo.traces_detail_by_time')) {
        return Promise.resolve([rootRow('single', 1_793_448_000, 'GetOrder')]);
      }
      return Promise.resolve([]);
    });

    const response = await client.searchTraces({
      graph: { name: graphName, namespace: DEFAULT_NAMESPACE },
      requestFilters: [{ field: 'operationName', operator: AnalyticsOperator.EQ, values: ['GetOrder'] }],
      minDurationNs: 40_000_000_000n,
    });

    expect(response.traces.map((t) => [t.traceId, t.operationName, t.matchedSpans.map((s) => s.spanName)])).toEqual([
      ['batched', '', ['query GetOrder']],
      ['single', 'GetOrder', []],
    ]);
    expect(response.meta?.dataset).toBe('requests');
    const direct = queryCalls(chClient).find(
      (c) => c.sql.includes('ORDER BY Timestamp DESC') && !c.sql.includes('batchTraceIds'),
    )!;
    expect(direct.sql).toBe(
      'SELECT TraceId AS traceId, SpanId AS spanId, toUnixTimestamp(Timestamp) AS ts, Duration AS duration,\n  OperationName AS operationName, OperationType AS operationType, OperationHash AS operationHash,\n  OperationPersistedID AS operationPersistedId, ClientName AS clientName, ClientVersion AS clientVersion,\n  HttpStatusCode AS httpStatusCode, StatusMessage AS statusMessage, HasError AS hasError FROM cosmo.traces_detail_by_time WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND OperationName = {f0:String} AND Duration >= {minDuration0:Int64} ORDER BY Timestamp DESC, TraceId DESC LIMIT {limit:UInt32}',
    );
  });
});
