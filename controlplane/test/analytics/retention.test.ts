import { afterAll, beforeAll, beforeEach, describe, expect, Mock, onTestFinished, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { AnalyticsViewGroupName } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { subDays } from 'date-fns';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

const setupGraph = async (client: Awaited<ReturnType<typeof SetupTest>>['client']) => {
  const fedGraphName = genID('fedGraph');
  const label = genUniqueLabel();
  await createThenPublishSubgraph(
    client,
    genID('subgraph'),
    DEFAULT_NAMESPACE,
    'type Query { hello: String! }',
    [label],
    'http://localhost:4001',
  );
  await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');
  return fedGraphName;
};

const requests = (graphName: string, subgraphName: string, dateRange: { start: string; end: string }) => ({
  getDashboardAnalyticsView: {
    federatedGraphName: graphName,
    namespace: DEFAULT_NAMESPACE,
    startDate: dateRange.start,
    endDate: dateRange.end,
  },
  getGraphMetrics: { federatedGraphName: graphName, namespace: DEFAULT_NAMESPACE, dateRange },
  getMetricsErrorRate: { federatedGraphName: graphName, namespace: DEFAULT_NAMESPACE, dateRange },
  getSubgraphMetrics: { subgraphName, namespace: DEFAULT_NAMESPACE, dateRange },
  getSubgraphMetricsErrorRate: { subgraphName, namespace: DEFAULT_NAMESPACE, dateRange },
});

describe('Analytics retention', () => {
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
  });

  describe('GetAnalyticsView', () => {
    test('returns an empty view without querying ClickHouse for a window entirely outside tracing retention', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());
      const fedGraphName = await setupGraph(client);

      const response = await client.getAnalyticsView({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        name: AnalyticsViewGroupName.None,
        config: {
          dateRange: { start: subDays(new Date(), 20).toISOString(), end: subDays(new Date(), 15).toISOString() },
        },
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.view?.rows).toEqual([]);
      expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
    });

    test('clamps the start of a 30-day window to the 7-day tracing retention', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());
      const fedGraphName = await setupGraph(client);
      (chClient.queryPromise as Mock).mockResolvedValue([]);

      const before = Math.floor(subDays(new Date(), 7).getTime() / 1000);
      await client.getAnalyticsView({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        name: AnalyticsViewGroupName.None,
        config: { dateRange: { start: subDays(new Date(), 30).toISOString(), end: new Date().toISOString() } },
      });
      const after = Math.floor(subDays(new Date(), 7).getTime() / 1000);

      const startDate = (chClient.queryPromise as Mock).mock.calls[0][1].startDate;
      expect(startDate).toBeGreaterThanOrEqual(before);
      expect(startDate).toBeLessThanOrEqual(after);
    });
  });

  describe('GetFieldUsage', () => {
    test('returns no usage without querying ClickHouse for a window entirely outside analytics retention', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());
      const fedGraphName = await setupGraph(client);

      const response = await client.getFieldUsage({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        typename: 'Query',
        field: 'hello',
        dateRange: { start: subDays(new Date(), 20).toISOString(), end: subDays(new Date(), 15).toISOString() },
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.requestSeries).toEqual([]);
      expect(response.clients).toEqual([]);
      expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
    });
  });

  describe('Metric RPCs', () => {
    const past = { start: subDays(new Date(), 20).toISOString(), end: subDays(new Date(), 15).toISOString() };
    const inverted = { start: subDays(new Date(), 1).toISOString(), end: subDays(new Date(), 2).toISOString() };
    test.each([
      ['getDashboardAnalyticsView', past],
      ['getGraphMetrics', past],
      ['getMetricsErrorRate', past],
      ['getSubgraphMetrics', past],
      ['getSubgraphMetricsErrorRate', past],
      ['getGraphMetrics', inverted],
    ] as const)('%s rejects a window outside retention instead of querying another one', async (rpc, dateRange) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());
      const fedGraphName = genID('fedGraph');
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
      await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

      const request = requests(fedGraphName, subgraphName, dateRange)[rpc];
      const response = (await (client[rpc] as (req: object) => Promise<unknown>)(request)) as {
        response?: { code: EnumStatusCode; details?: string };
      };

      expect({ code: response.response?.code, details: response.response?.details }).toEqual({
        code: EnumStatusCode.ERR_BAD_REQUEST,
        details: "The requested window is outside your plan's retention.",
      });
      expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
    });
  });

  describe('GetOperationContent', () => {
    test('returns ERR_NOT_FOUND when the operation had no traffic within analytics retention', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());
      const fedGraphName = await setupGraph(client);
      (chClient.queryPromise as Mock).mockResolvedValueOnce([]);

      const response = await client.getOperationContent({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        hash: 'abc',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toBe("Operation not found within your plan's retention.");
      expect(response.operationContent).toBe('');
      expect((chClient.queryPromise as Mock).mock.calls[0][1].retentionDays).toBe(7);
    });

    test('finds the operation through GraphQL metrics when the router does not export OTEL metrics', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());
      const fedGraphName = await setupGraph(client);
      // Only the GraphQL metrics pipeline, which also stores the documents, has seen this operation.
      (chClient.queryPromise as Mock).mockImplementation((query: string) => {
        if (/\bgql_metrics_schema_usage_lite_1d_90d\b/.test(query)) {
          return Promise.resolve([{ hasTraffic: 1 }]);
        }
        if (/\bgql_metrics_operations\b/.test(query)) {
          return Promise.resolve([{ operationContent: 'query A { a }' }]);
        }
        return Promise.resolve([]);
      });

      const response = await client.getOperationContent({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        hash: 'abc',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.operationContent).toBe('query A { a }');
    });

    test('returns the content when the operation had traffic within analytics retention', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());
      const fedGraphName = await setupGraph(client);
      (chClient.queryPromise as Mock)
        .mockResolvedValueOnce([{ hasTraffic: 1 }])
        .mockResolvedValueOnce([{ operationContent: 'query A { a }' }]);

      const response = await client.getOperationContent({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        hash: 'abc',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.operationContent).toBe('query A { a }');
    });
  });
});
