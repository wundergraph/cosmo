import { afterAll, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
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
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
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

  test('counts the operations of each value in operation_documents', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const { name: graphName } = await createFederatedGraphWithSubgraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([{ d_operationName: 'GetOrder', m_operations: '3' }]);

    const response = await client.getAnalyticsDimensionValues({
      graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
      dataset: 'operation_documents',
      dimension: 'operationName',
    });

    expect(response.values.map((v) => [v.value, v.count])).toEqual([['GetOrder', 3n]]);
    expect(queryCalls(chClient)[0].sql).toBe(
      'SELECT OperationName AS d_operationName, uniqExact(OperationHash) AS m_operations FROM cosmo.gql_metrics_operations WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND OperationHash IN (SELECT OperationHash FROM cosmo.gql_metrics_schema_usage_lite_1d_90d WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND Timestamp >= toStartOfDay(toDateTime({start:UInt32})) AND Timestamp <= toDateTime({end:UInt32})) GROUP BY d_operationName ORDER BY m_operations DESC, d_operationName ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}',
    );
  });
});
