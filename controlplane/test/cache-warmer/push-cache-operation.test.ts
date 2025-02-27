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

  test('Should be able to push a cache operation.', async (testContext) => {
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
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const operationContent = 'query Hello { hello { message } }';

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    const getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);
    expect(getCacheOperationsResp.operations[0].operationContent).toBe(operationContent);
    expect(getCacheOperationsResp.operations[0].operationName).toBe('Hello');

    await server.close();
  });

  test('Should not able to add a duplicate operation', async (testContext) => {
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
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    const operationContent = 'query Hello { hello { message } }';
    let pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    let getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    await server.close();
  });

  test('Should be able to push a persisted operation.', async (testContext) => {
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
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    const operationId = genID('sendHello');
    const operationContent = `query sendHello { sendHello }`;

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName: federatedGraphName,
      namespace: 'default',
      clientName: 'my-client',
      operations: [{ id: operationId, contents: operationContent }],
    });
    expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'sendHello',
      operationPersistedId: operationId,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    const getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);
    expect(getCacheOperationsResp.operations[0].operationContent).toBe(operationContent);

    await server.close();
  });

  test('Should be able to push a duplicate persisted operation.', async (testContext) => {
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
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    const operationId = genID('sendHello');
    const operationContent = `query sendHello { sendHello }`;
    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName: federatedGraphName,
      namespace: 'default',
      clientName: 'my-client',
      operations: [{ id: operationId, contents: operationContent }],
    });
    expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    let pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'sendHello',
      operationPersistedId: operationId,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    let getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);
    expect(getCacheOperationsResp.operations[0].operationContent).toBe(operationContent);

    pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'sendHello',
      operationPersistedId: operationId,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    await server.close();
  });
});
