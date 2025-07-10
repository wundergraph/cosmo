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
    schema: 'type Query { hello: Hello! } type Hello { message: String! }',
  });
  expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
};

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('DeleteCacheOperation', (ctx) => {
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

  test('Should not able to delete a computed operation.', async (testContext) => {
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
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        operationHash: '123',
        operationName: 'Hello',
        operationContent: 'query Hello { hello { message } }',
        clientName: 'default',
        planningTime: 20,
      },
    ]);

    const computeCacheWarmerOperationsResp = await client.computeCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(computeCacheWarmerOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    let getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    const deleteCacheOperationResp = await client.deleteCacheWarmerOperation({
      id: getCacheOperationsResp.operations[0].id,
      federatedGraphName,
      namespace: 'default',
    });
    expect(deleteCacheOperationResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(deleteCacheOperationResp.response?.details).toBe(
      `The operation is not manually added and cannot be deleted.`,
    );

    getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    await server.close();
  });

  test('Should return an error if the operation doesnt exist.', async (testContext) => {
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
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        operationHash: '123',
        operationName: 'Hello',
        operationContent: 'query Hello { hello { message } }',
        clientName: 'default',
        planningTime: 20,
      },
    ]);

    const computeCacheWarmerOperationsResp = await client.computeCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(computeCacheWarmerOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    let getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });
    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    const deleteCacheOperationResp = await client.deleteCacheWarmerOperation({
      id: randomUUID(),
      federatedGraphName,
      namespace: 'default',
    });
    expect(deleteCacheOperationResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteCacheOperationResp.response?.details).toBe(`Could not delete the operation as it's not found.`);

    getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to push a cache operation and delete it', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const federatedGraphName = genID('fedGraph');
    await createFederatedAndSubgraph(client, federatedGraphName);

    const configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent: 'query Hello { hello { message } }',
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    const getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    const deleteCacheOperationResp = await client.deleteCacheWarmerOperation({
      id: getCacheOperationsResp.operations[0].id,
      federatedGraphName,
      namespace: 'default',
    });
    expect(deleteCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to delete cache operation', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
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
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const pushCacheOperationResp = await client.pushCacheWarmerOperation({
      federatedGraphName,
      namespace: 'default',
      operationName: 'Hello',
      operationContent: 'query Hello { hello { message } }',
    });
    expect(pushCacheOperationResp.response?.code).toBe(EnumStatusCode.OK);

    const getCacheOperationsResp = await client.getCacheWarmerOperations({
      federatedGraphName,
      namespace: 'default',
    });

    expect(getCacheOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getCacheOperationsResp.totalCount).toBe(1);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const deleteCacheOperationResp = await client.deleteCacheWarmerOperation({
      id: getCacheOperationsResp.operations[0].id,
      federatedGraphName,
      namespace: 'default',
    });
    expect(deleteCacheOperationResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
