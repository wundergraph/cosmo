import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { Code, ConnectError } from '@connectrpc/connect';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
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
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });
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

  test('Should escape persistent operation client name before storing to blog storage', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });
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
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });
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
