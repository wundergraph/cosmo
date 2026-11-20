import { afterAll, beforeAll, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
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

describe('GetOrganizationRequestsCount history', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('returns monthly counts per graph, with deleted graphs as one remainder per month', async (testContext) => {
    const chClient = new ClickHouseClient();
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

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
    const graphId = (await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE })).graph!
      .id;

    (chClient.queryPromise as Mock).mockImplementation((query: string) =>
      Promise.resolve(
        query.includes('GROUP BY')
          ? [
              { month: '2026-09-01', federatedGraphId: graphId, count: '10' },
              { month: '2026-09-01', federatedGraphId: 'gone-1', count: '3' },
              { month: '2026-09-01', federatedGraphId: 'gone-2', count: '2' },
              { month: '2026-10-01', federatedGraphId: graphId, count: '7' },
            ]
          : [{ totalRequests: '7' }],
      ),
    );

    const response = await client.getOrganizationRequestsCount({ months: 2 });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.count).toBe(BigInt(7));
    expect(response.history).toEqual([
      {
        $typeName: 'wg.cosmo.platform.v1.MonthlyRequestCount',
        month: '2026-09',
        count: BigInt(15),
        graphs: [
          {
            $typeName: 'wg.cosmo.platform.v1.GraphRequestCount',
            federatedGraphId: graphId,
            name: fedGraphName,
            namespace: DEFAULT_NAMESPACE,
            count: BigInt(10),
            deleted: false,
          },
          {
            $typeName: 'wg.cosmo.platform.v1.GraphRequestCount',
            federatedGraphId: '',
            name: '',
            namespace: '',
            count: BigInt(5),
            deleted: true,
          },
        ],
      },
      {
        $typeName: 'wg.cosmo.platform.v1.MonthlyRequestCount',
        month: '2026-10',
        count: BigInt(7),
        graphs: [
          {
            $typeName: 'wg.cosmo.platform.v1.GraphRequestCount',
            federatedGraphId: graphId,
            name: fedGraphName,
            namespace: DEFAULT_NAMESPACE,
            count: BigInt(7),
            deleted: false,
          },
        ],
      },
    ]);
  });

  test('returns no history when months is not requested', async (testContext) => {
    const chClient = new ClickHouseClient();
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    (chClient.queryPromise as Mock).mockResolvedValue([{ totalRequests: '7' }]);

    const response = await client.getOrganizationRequestsCount({});

    expect(response.count).toBe(BigInt(7));
    expect(response.history).toEqual([]);
  });
});
