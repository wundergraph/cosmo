import crypto from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { FederatedGraphRepository } from '../src/core/repositories/FederatedGraphRepository.js';
import { MAX_MANIFEST_OPERATIONS, OperationsRepository } from '../src/core/repositories/OperationsRepository.js';
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
      // 3 keys: routerconfig + operation + manifest
      expect(storageKeys.length).toBe(3);
      const operationKey = storageKeys.find((key) => key.includes(`/${id}.json`));
      expect(operationKey).toBeDefined();
      const keyComponents = operationKey!.split('/');
      const keyFilename = keyComponents.at(-1)!;
      const keyBasename = keyFilename.split('.')[0];
      expect(keyBasename).toBe(id);

      const blobObject = await blobStorage.getObject({
        key: operationKey!,
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
      expect(storageKeys.length).toBe(3);

      // The client name should be escaped in the storage key
      const operationKey = storageKeys.find((key) => key.includes(`/${id}.json`));
      expect(operationKey).toBeDefined();
      expect(operationKey).toContain(encodeURIComponent(clientName));

      const keyComponents = operationKey!.split('/');
      const keyFilename = keyComponents.at(-1)!;
      const keyBasename = keyFilename.split('.')[0];
      expect(keyBasename).toBe(id);

      const blobObject = await blobStorage.getObject({
        key: operationKey!,
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

      expect(blobStorage.keys().length).toBe(3);

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

  describe('manifest generation', () => {
    test('Should generate a PQL manifest after publishing persisted operations', async (testContext) => {
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

      const storageKeys = blobStorage.keys();
      const manifestKey = storageKeys.find((key) => key.endsWith('/operations/manifest.json'));
      expect(manifestKey).toBeDefined();

      const blobObject = await blobStorage.getObject({ key: manifestKey! });
      const text = await new Response(blobObject.stream).text();
      const manifest = JSON.parse(text);

      expect(manifest.version).toBe(1);
      expect(manifest.revision).toBeDefined();
      expect(manifest.generatedAt).toBeDefined();
      expect(Object.keys(manifest.operations).length).toBe(1);

      const entry = Object.values(manifest.operations)[0] as string;
      expect(entry).toBe(query);
    });

    test('Should include operations from multiple clients in the manifest', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const queryA = `query { hello }`;
      const queryB = `query { __typename }`;

      const publishResp1 = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'client-a',
        operations: [{ id: genID('op1'), contents: queryA }],
      });
      expect(publishResp1.response?.code).toBe(EnumStatusCode.OK);

      const publishResp2 = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'client-b',
        operations: [{ id: genID('op2'), contents: queryB }],
      });
      expect(publishResp2.response?.code).toBe(EnumStatusCode.OK);

      const storageKeys = blobStorage.keys();
      const manifestKey = storageKeys.find((key) => key.endsWith('/operations/manifest.json'));
      expect(manifestKey).toBeDefined();

      const blobObject = await blobStorage.getObject({ key: manifestKey! });
      const text = await new Response(blobObject.stream).text();
      const manifest = JSON.parse(text);

      expect(Object.keys(manifest.operations).length).toBe(2);

      const bodies = Object.values(manifest.operations) as string[];
      expect(bodies).toContain(queryA);
      expect(bodies).toContain(queryB);
    });

    test('Should regenerate the manifest after deleting a persisted operation', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const query1 = `query { hello }`;
      const query2 = `query { __typename }`;
      const op1Id = genID('op1');
      const op2Id = genID('op2');

      const publishResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [
          { id: op1Id, contents: query1 },
          { id: op2Id, contents: query2 },
        ],
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

      // Verify manifest has 2 operations
      let storageKeys = blobStorage.keys();
      let manifestKey = storageKeys.find((key) => key.endsWith('/operations/manifest.json'));
      let blobObject = await blobStorage.getObject({ key: manifestKey! });
      let text = await new Response(blobObject.stream).text();
      let manifest = JSON.parse(text);
      expect(Object.keys(manifest.operations).length).toBe(2);
      const revisionBefore = manifest.revision;

      // Delete one operation
      const deleteResp = await client.deletePersistedOperation({
        fedGraphName,
        namespace: 'default',
        operationId: publishResp.operations[0].id,
        clientName: 'test-client',
      });
      expect(deleteResp.response?.code).toBe(EnumStatusCode.OK);

      // Verify manifest now has 1 operation with a new revision
      storageKeys = blobStorage.keys();
      manifestKey = storageKeys.find((key) => key.endsWith('/operations/manifest.json'));
      blobObject = await blobStorage.getObject({ key: manifestKey! });
      text = await new Response(blobObject.stream).text();
      manifest = JSON.parse(text);
      expect(Object.keys(manifest.operations).length).toBe(1);
      expect(manifest.revision).not.toBe(revisionBefore);
    });

    test('Should produce a deterministic revision for the same set of operations', async (testContext) => {
      const { client, server, blobStorage } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const query = `query { hello }`;

      const publishResp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id: genID('hello'), contents: query }],
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

      const storageKeys = blobStorage.keys();
      const manifestKey = storageKeys.find((key) => key.endsWith('/operations/manifest.json'));
      const blobObject1 = await blobStorage.getObject({ key: manifestKey! });
      const text1 = await new Response(blobObject1.stream).text();
      const manifest1 = JSON.parse(text1);

      // Publish the same operations again (will be UP_TO_DATE), which still triggers manifest regen
      const publishResp2 = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id: publishResp.operations[0].id, contents: query }],
      });
      expect(publishResp2.response?.code).toBe(EnumStatusCode.OK);

      const blobObject2 = await blobStorage.getObject({ key: manifestKey! });
      const text2 = await new Response(blobObject2.stream).text();
      const manifest2 = JSON.parse(text2);

      // Same operations should produce the same revision
      expect(manifest2.revision).toBe(manifest1.revision);
    });

    test('Should reject publish when operation limit would be exceeded', async (testContext) => {
      const { client, server, blobStorage, users } = await SetupTest({
        dbname,
        chClient,
      });
      testContext.onTestFinished(() => server.close());

      const fedGraphName = genID('fedGraph');
      await setupFederatedGraph(fedGraphName, client);

      const user = users.adminAliceCompanyA;
      const db = server.db;
      const logger = server.log;

      // Resolve the federated graph ID.
      const fedGraphRepo = new FederatedGraphRepository(logger, db, user.organizationId);
      const fedGraph = await fedGraphRepo.byName(fedGraphName, 'default');
      expect(fedGraph).toBeDefined();

      // Seed operations directly in the DB to fill up to the limit.
      const opsRepo = new OperationsRepository(db, fedGraph!.id);
      const clientId = await opsRepo.registerClient('test-client', user.userId);

      const seedOps = Array.from({ length: MAX_MANIFEST_OPERATIONS }, (_, i) => ({
        operationId: `seed-op-${i}`,
        hash: crypto.createHash('sha256').update(`seed-op-${i}`).digest('hex'),
        filePath: `seed-op-${i}.graphql`,
        contents: `query SeedOp${i} { hello }`,
        operationNames: [`SeedOp${i}`],
      }));
      await opsRepo.updatePersistedOperations(clientId, user.userId, seedOps);

      // Publishing a new operation should be rejected because the limit is already reached.
      const resp = await client.publishPersistedOperations({
        fedGraphName,
        namespace: 'default',
        clientName: 'test-client',
        operations: [{ id: genID('trigger'), contents: `query ExceedsLimit { hello }` }],
      });
      expect(resp.response?.code).toBe(EnumStatusCode.ERR);
      expect(resp.response?.details).toContain('Operation limit exceeded');
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
