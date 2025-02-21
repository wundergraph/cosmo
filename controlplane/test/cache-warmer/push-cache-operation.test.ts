import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

const createFederatedAndSubgraph = async (client: any, federatedGraphName: string) => {
  const subgraphName = genID('subgraph');
  const label = genUniqueLabel();

  const createFederatedGraphResp = await client.createFederatedGraph({
    name: federatedGraphName,
    namespace: 'default',
    labelMatchers: [joinLabel(label)],
    routingUrl: 'http://localhost:4000',
  });
  expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

  const createFederatedSubgraphResp = await client.createFederatedSubgraph({
    name: subgraphName,
    namespace: 'default',
    labels: [label],
    routingUrl: 'http://localhost:8080',
  });
  expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

  const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
    name: subgraphName,
    namespace: 'default',
    schema: 'type Query { hello: Hello! sendHello: String! } type Hello { message: String! }',
  });
  expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
};

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('PushCacheOperation', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to push a cache operation and make sure it doesnt exceed the max operations count.', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    const federatedGraphName = genID('fedGraph');
    await createFederatedAndSubgraph(client, federatedGraphName);

    const configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 5,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    const cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(true);
    expect(cacheWarmerConfigResp.maxOperationsCount).toBe(5);

    (chClient.queryPromise as Mock)
      .mockResolvedValueOnce([
        {
          operationHash: '121',
          operationName: 'Hello1',
          operationContent: 'query Hello1 { hello { message } }',
          clientName: 'default',
          planningTime: 25,
        },
        {
          operationHash: '122',
          operationName: 'Hello2',
          operationContent: 'query Hello2 { hello { message } }',
          clientName: 'default',
          planningTime: 24,
        },
        {
          operationHash: '123',
          operationName: 'Hello3',
          operationContent: 'query Hello3 { hello { message } }',
          clientName: 'default',
          planningTime: 23,
        },
        {
          operationHash: '124',
          operationName: 'Hello4',
          operationContent: 'query Hello4 { hello { message } }',
          clientName: 'default',
          planningTime: 22,
        },
      ])
      .mockResolvedValueOnce([
        {
          operationHash: '121',
          operationContent: 'query Hello1 { hello { message } }',
        },
        {
          operationHash: '122',
          operationContent: 'query Hello2 { hello { message } }',
        },
        {
          operationHash: '123',
          operationContent: 'query Hello3 { hello { message } }',
        },
        {
          operationHash: '124',
          operationContent: 'query Hello4 { hello { message } }',
        },
      ])
      .mockResolvedValueOnce([
        {
          operationHash: '121',
          operationName: 'Hello1',
          operationContent: 'query Hello1 { hello { message } }',
          clientName: 'default',
          planningTime: 25,
        },
        {
          operationHash: '122',
          operationName: 'Hello2',
          operationContent: 'query Hello2 { hello { message } }',
          clientName: 'default',
          planningTime: 24,
        },
        {
          operationHash: '123',
          operationName: 'Hello3',
          operationContent: 'query Hello3 { hello { message } }',
          clientName: 'default',
          planningTime: 23,
        },
      ])
      .mockResolvedValueOnce([
        {
          operationHash: '121',
          operationContent: 'query Hello1 { hello { message } }',
        },
        {
          operationHash: '122',
          operationContent: 'query Hello2 { hello { message } }',
        },
        {
          operationHash: '123',
          operationContent: 'query Hello3 { hello { message } }',
        },
      ]);

    const operationContent1 = 'query Hello5 { hello { message } }';
    const operationContent2 = 'query Hello6 { hello { message } }';

    let pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello5',
      operationContent: operationContent1,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    let getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.operations[0].isManuallyAdded).toBe(true);
    expect(getCacheOperationsResp.totalCount).toBe(5);

    pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello6',
      operationContent: operationContent2,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(5);
    expect(getCacheOperationsResp.operations[0].isManuallyAdded).toBe(true);
    expect(getCacheOperationsResp.operations[1].isManuallyAdded).toBe(true);

    await server.close();
  });
});
