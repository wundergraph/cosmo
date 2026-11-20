import { afterAll, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { AnalyticsOperator } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { createFederatedGraphWithSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';
import { queryCalls } from './fake-clickhouse.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  ClickHouseClient.prototype.estimateRows = vi.fn();
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

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
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
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
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
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
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
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
