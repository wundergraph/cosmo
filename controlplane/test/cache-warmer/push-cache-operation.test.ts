import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
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

  test('Should be able to push a cache operation when the manually added operations are already equal to the number of maxOperationsCount.', async (testContext) => {
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

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const operations = [
      { content: 'query Hello1 { hello { message } }', name: 'Hello1' },
      { content: 'query Hello2 { hello { message } }', name: 'Hello2' },
      { content: 'query Hello3 { hello { message } }', name: 'Hello3' },
      { content: 'query Hello4 { hello { message } }', name: 'Hello4' },
      { content: 'query Hello5 { hello { message } }', name: 'Hello5' },
      { content: 'query Hello6 { hello { message } }', name: 'Hello6' },
    ];

    for (const operation of operations) {
      const pushCacheOperationResp = await client.pushCacheWarmerOperation({
        federatedGraphName,
        namespace: 'default',
        operationName: operation.name,
        operationContent: operation.content,
      });
      expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);
    }

    const getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(5);
    expect(getCacheOperationsResp.operations[0].operationContent).not.toBe(operations[0].content);
    expect(getCacheOperationsResp.operations[1].operationContent).not.toBe(operations[1].content);
    expect(getCacheOperationsResp.operations[2].operationContent).not.toBe(operations[2].content);
    expect(getCacheOperationsResp.operations[3].operationContent).not.toBe(operations[3].content);
    expect(getCacheOperationsResp.operations[4].operationContent).not.toBe(operations[4].content);

    await server.close();
  });

  test('Should be able to push multiple queries in a doc if the operation name passed matches with one of them', async (testContext) => {
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

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello1',
      operationContent: 'query Hello1 { hello { message } } query Hello2 { hello { message } }',
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be able to push a cache operation whose operation name is not present in the operation', async (testContext) => {
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

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    let pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello1',
      operationContent: 'query Hello { hello { message } }',
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(pushCacheOperationResp.response?.details).toBe(
      `An operation definition with the name 'Hello1' was not found in the provided operation content`,
    );

    pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent: 'query Hello1 { hello { message } } query Hello2 { hello { message } }',
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(pushCacheOperationResp.response?.details).toBe(
      `An operation definition with the name 'Hello' was not found in the provided operation content`,
    );

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'graph-admin',
  ])('%s should be able to configure cache warmer', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      enableMultiUsers: true,
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

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('graph-admin should be able to publish when given access to namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      enableMultiUsers: true,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    const federatedGraphName = genID('fedGraph');
    await createFederatedAndSubgraph(client, federatedGraphName);

    const getNamespaceResponse = await client.getNamespace({ name: 'default' });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    const configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const operationContent = 'query Hello { hello { message } }';

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'graph-admin',
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    let pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'graph-admin',
        namespaces: [randomUUID()],
      })),
    });

    pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to configure cache warmer', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      enableMultiUsers: true,
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

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent,
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
