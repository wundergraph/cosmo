import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { ANALYTICS_READ_RPCS, joinLabel } from '@wundergraph/cosmo-shared';
import { AnalyticsViewGroupName } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn().mockResolvedValue([]);
  ClickHouseClient.prototype.queryPromiseWithDefault = vi.fn().mockResolvedValue([]);
  ClickHouseClient.prototype.estimateRows = vi.fn().mockResolvedValue(0);
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

describe('Analytics read RPCs are read-only', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('no allow-listed RPC writes to Postgres or blob storage, or sends a webhook', async (testContext) => {
    const { client, server, blobStorage, platformWebhooks } = await SetupTest({
      dbname,
      chClient: new ClickHouseClient(),
    });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String! }',
      [label],
      'http://localhost:4001',
    );
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');
    const graphId = (await client.getFederatedGraphByName({ name: graphName, namespace: DEFAULT_NAMESPACE })).graph!.id;

    // Spy only after setup, which itself writes.
    const writes = [
      vi.spyOn(PgDatabase.prototype, 'insert'),
      vi.spyOn(PgDatabase.prototype, 'update'),
      vi.spyOn(PgDatabase.prototype, 'delete'),
      vi.spyOn(blobStorage, 'putObject'),
      vi.spyOn(blobStorage, 'deleteObject'),
      vi.spyOn(blobStorage, 'removeDirectory'),
      vi.spyOn(platformWebhooks, 'send'),
    ];

    const graph = { federatedGraphName: graphName, namespace: DEFAULT_NAMESPACE };
    const requests: Record<(typeof ANALYTICS_READ_RPCS)[number], object> = {
      getAnalyticsCapabilities: {},
      getDashboardAnalyticsView: { ...graph, range: 24 },
      getGraphMetrics: { ...graph, range: 24 },
      getMetricsErrorRate: { ...graph, range: 24 },
      getSubgraphMetrics: { subgraphName, namespace: DEFAULT_NAMESPACE, range: 24 },
      getSubgraphMetricsErrorRate: { subgraphName, namespace: DEFAULT_NAMESPACE, range: 24 },
      getOperations: { ...graph, range: 24 },
      getOperationContent: { ...graph, hash: '1' },
      getOperationClients: { ...graph, operationHash: '1', operationName: 'A', range: 24 },
      getOperationDeprecatedFields: { ...graph, operationHash: '1', range: 24 },
      getFieldUsage: { graphName, namespace: DEFAULT_NAMESPACE, typename: 'Query', field: 'hello', range: 24 },
      getTrace: { id: 't', spanId: 's', federatedGraphId: graphId },
      getAnalyticsView: { ...graph, name: AnalyticsViewGroupName.None, config: { range: 24 } },
      getRouters: { fedGraphName: graphName, namespace: DEFAULT_NAMESPACE },
      getOrganizationRequestsCount: { months: 3 },
      getChecksByFederatedGraphName: {
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
        limit: 10,
        offset: 0,
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date().toISOString(),
      },
      getCheckSummary: { checkId: 'none', graphName, namespace: DEFAULT_NAMESPACE },
      getCheckOperations: { checkId: 'none', graphName, namespace: DEFAULT_NAMESPACE, limit: 10, offset: 0 },
      getFederatedGraphByName: { name: graphName, namespace: DEFAULT_NAMESPACE },
      whoAmI: {},
      searchTraces: {
        graph: { name: graphName, namespace: DEFAULT_NAMESPACE },
        window: { rangeHours: 24 },
        spanConditions: [{ spanName: 'Engine - Fetch', minDurationNs: 1n }],
      },
      queryAnalytics: {
        graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
        dataset: 'operation_metrics',
        dimensions: ['operationName'],
        window: { rangeHours: 24 },
      },
      getAnalyticsDimensionValues: {
        graphs: [{ name: graphName, namespace: DEFAULT_NAMESPACE }],
        dataset: 'spans',
        dimension: 'attributeKeys',
        window: { rangeHours: 24 },
      },
      getCompositions: {
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
        limit: 10,
        offset: 0,
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date().toISOString(),
      },
      getFederatedGraphChangelog: {
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
        pagination: { limit: 10, offset: 0 },
        dateRange: { start: new Date(Date.now() - 86_400_000).toISOString(), end: new Date().toISOString() },
      },
      getClients: { fedGraphName: graphName, namespace: DEFAULT_NAMESPACE, includeTraffic: true },
    };

    // Some handlers fail on the empty mocked ClickHouse rows; a failure isn't a write, so keep calling the rest.
    for (const rpc of ANALYTICS_READ_RPCS) {
      await (client[rpc] as (req: object) => Promise<unknown>)(requests[rpc]).catch(() => undefined);
    }

    for (const spy of writes) {
      expect(spy).toHaveBeenCalledTimes(0);
    }
  });
});
