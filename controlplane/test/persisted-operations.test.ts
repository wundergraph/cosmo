import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  genID,
  genUniqueLabel,
  TestUser,
  createTestRBACEvaluator,
  createTestGroup,
} from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

type Client = Awaited<ReturnType<typeof SetupTest>>['client'];

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

const setupFederatedGraph = async (fedGraphName: string, client: Client) => {
  const subgraph1Name = genID('subgraph1');
  const label = genUniqueLabel();

  const createSubraph1Res = await client.createFederatedSubgraph({
    name: subgraph1Name,
    namespace: 'default',
    labels: [label],
    routingUrl: 'http://localhost:8081',
  });

  expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

  const publishResp = await client.publishFederatedSubgraph({
    name: subgraph1Name,
    namespace: 'default',
    labels: [label],
    routingUrl: 'http://localhost:8081',
    schema: 'type Query { hello: String! }',
  });

  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  const createFedGraphRes = await client.createFederatedGraph({
    name: fedGraphName,
    namespace: 'default',
    routingUrl: 'http://localhost:8080',
    labelMatchers: [joinLabel(label)],
  });

  expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);
};

describe('Persisted operations', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
    (chClient.queryPromise as Mock).mockResolvedValue([]);
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

  describe('publishing', () => {
    test('Should be able to publish persisted operations', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Should NOT be able to publish persisted operations in a viewer role', async (testContext) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.viewerTimCompanyA]!,
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'namespace-viewer' })),
      });

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });

    test('Should not publish persisted operations without a client name', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);
      expect(publishOperationsResp.response?.details).toContain('Client name is required');
    });

    test('Should not publish persisted operations with a client name length < 3 or > 255', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      let publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'ab',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);
      expect(publishOperationsResp.response?.details).toContain('Client name must be between 3 and 255 characters');

      publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'a'.repeat(256),
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);
      expect(publishOperationsResp.response?.details).toContain('Client name must be between 3 and 255 characters');
    });

    test('Should not publish persisted operations with invalid queries', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        operations: [{ id: genID('hello'), contents: `query { does_not_exist }` }],
      });

      expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);
    });

    test('Should reject persisted operations when payload is too large', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const operations = Array.from({ length: 101 }, (_, index) => ({
        id: genID(`hello-${index}`),
        contents: `query { hello }`,
      }));

      const overLimitResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations,
      });

      expect(overLimitResp.response?.code).toBe(EnumStatusCode.ERR);
      expect(overLimitResp.response?.details).toContain('Payload Too Large: max 100 operations per request');
      expect(overLimitResp.operations).toEqual([]);
    });

    test('Should not publish persisted operations with an invalid federated graph name', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName: `not_${fedGraphName}`,
        namespace: 'default',
        operations: [{ id: 'hello4', contents: `query { does_not_exist }` }],
      });

      expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);
    });

    test('Should store persisted operations in blob storage', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const id = genID('hello');
      const query = `query { hello }`;

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id, contents: query }],
      });

      expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

      const storageKeys = blobStorage.keys();
      expect(storageKeys.length).toBe(2);
      const keyComponents = storageKeys[1].split('/');
      const keyFilename = keyComponents.at(-1)!;
      const keyBasename = keyFilename.split('.')[0];
      expect(keyBasename).toBe(id);

      const blobObject = await blobStorage.getObject({
        key: storageKeys[1],
      });
      const text = await new Response(blobObject.stream).text();
      expect(JSON.parse(text)).toEqual({ version: 1, body: query });
    });

    test('Should escape persistent operation client name before storing to blob storage', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const id = genID('hello');
      const query = `query { hello }`;
      const clientName = 'foo/bar'; // Client name with a slash

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName,
        operations: [{ id, contents: query }],
      });

      expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

      const storageKeys = blobStorage.keys();
      expect(storageKeys.length).toBe(2);

      // The client name should be escaped in the storage key
      expect(storageKeys[1]).toContain(encodeURIComponent(clientName));

      const keyComponents = storageKeys[1].split('/');
      const keyFilename = keyComponents.at(-1)!;
      const keyBasename = keyFilename.split('.')[0];
      expect(keyBasename).toBe(id);

      const blobObject = await blobStorage.getObject({
        key: storageKeys[1],
      });
      const text = await new Response(blobObject.stream).text();
      expect(JSON.parse(text)).toEqual({ version: 1, body: query });

      const clients = await client.getClients({
        fedGraphName,
        namespace: 'default',
      });

      expect(clients.response?.code).toBe(EnumStatusCode.OK);
      expect(clients.clients).toHaveLength(1);
      expect(clients.clients[0].name).toBe(clientName);
    });

    test('Should delete persisted operations from blob storage when the federated graph is deleted', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const query = `query { hello }`;

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id: genID('hello'), contents: query }],
      });

      expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

      expect(blobStorage.keys().length).toBe(2);

      const deleteFederatedGraphResp = await client.deleteFederatedGraph({
        name: fedGraphName,
        namespace: 'default',
      });
      expect(deleteFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);
      expect(blobStorage.keys().length).toBe(0);
    });
  });

  describe('deleting', () => {
    test('Should be able to delete a persisted operation', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      const deleteOperationsResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });

      expect(deleteOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Should be able to delete a persisted operation in dev role', async (testContext) => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        chClient,
        enableMultiUsers: true,
      });

      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.devJoeCompanyA]!,
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-developer' })),
      });

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      const deleteOperationsResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });

      expect(deleteOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Should delete persisted operation from blob storage when deleted', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const id = genID('hello');
      const query = `query { hello }`;

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id, contents: query }],
      });

      const storageKeys = blobStorage.keys();

      await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });

      await expect(
        blobStorage.getObject({
          key: storageKeys[1],
        }),
      ).rejects.toThrow(/not found/);
    });

    test('Should fail when blob storage errs during deletement of a persisted operation', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const id = genID('hello');
      const query = `query { hello }`;

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id, contents: query }],
      });

      const deleteObjectSpy = vi.spyOn(blobStorage, 'deleteObject').mockRejectedValueOnce(new Error('delete failed'));

      const deleteOperationsResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });

      expect(deleteObjectSpy).toHaveBeenCalledTimes(1);
      expect(deleteOperationsResp.response?.code).toBe(EnumStatusCode.ERR);
      expect(deleteOperationsResp.response?.details).toContain('Failed to delete operation');
    });

    test('Should NOT be able to delete a persisted operation that does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const deleteOperationsResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: 'xxx',
        clientName: 'curl',
      });

      expect(deleteOperationsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('Should NOT be able to delete a persisted operation when clientName does not match', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      const deleteOperationsResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'not-curl',
      });

      expect(deleteOperationsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('Should NOT be able to delete a persisted operation in viewer role', async (testContext) => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        chClient,
        enableMultiUsers: true,
      });

      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.viewerTimCompanyA]!,
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'namespace-viewer' })),
      });

      const deleteOperationsResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });
      expect(deleteOperationsResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });
  });

  describe('check', () => {
    test('Should check the traffic of the operation', async (testContext) => {
      const { client, server } = await SetupTest({
        dbname,
        chClient,
      });

      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      const checkOperationsResp = await client.checkPersistedOperationTraffic({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });
      expect(checkOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Should detect that the operation has traffic', async (testContext) => {
      const { client, server } = await SetupTest({
        dbname,
        chClient,
      });

      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      // Mock traffic data
      (chClient.queryPromise as Mock).mockResolvedValue([
        {
          TotalRequests: 1,
        },
      ]);

      const checkOperationsResp = await client.checkPersistedOperationTraffic({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });

      expect(checkOperationsResp.operation?.hasTraffic).toBe(true);
    });

    test('Should fail when clientName does not match operation client', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      const checkOperationsResp = await client.checkPersistedOperationTraffic({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'not-curl',
      });

      expect(checkOperationsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('Should detect that the operation does NOT have traffic', async (testContext) => {
      const { client, server } = await SetupTest({
        dbname,
        chClient,
      });

      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const publishOperationsResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'curl',
        operations: [{ id: genID('hello'), contents: `query { hello }` }],
      });

      const checkOperationsResp = await client.checkPersistedOperationTraffic({
        fedGraphName,
        namespace: 'default',
        operationId: publishOperationsResp.operations[0].id,
        clientName: 'curl',
      });

      expect(checkOperationsResp.operation?.hasTraffic).toBe(false);
    });
  });
});
