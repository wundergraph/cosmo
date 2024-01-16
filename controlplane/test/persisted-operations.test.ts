import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

type Client = Awaited<ReturnType<typeof SetupTest>>['client'];

const setupFederatedGraph = async (fedGraphName: string, client: Client) => {
  const subgraph1Name = genID('subgraph1');
  const label = genUniqueLabel();

  const createSubraph1Res = await client.createFederatedSubgraph({
    name: subgraph1Name,
    labels: [label],
    routingUrl: 'http://localhost:8081',
  });

  expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

  const publishResp = await client.publishFederatedSubgraph({
    name: subgraph1Name,
    labels: [label],
    routingUrl: 'http://localhost:8081',
    schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
  });

  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  const createFedGraphRes = await client.createFederatedGraph({
    name: fedGraphName,
    routingUrl: 'http://localhost:8080',
    labelMatchers: [joinLabel(label)],
  });

  expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);
};

describe('Persisted operations', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to publish persisted operations', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);
    const fedGraphName = genID('fedGraph');
    await setupFederatedGraph(fedGraphName, client);

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName,
      clientName: 'test-client',
      operations: [{ id: genID('hello'), contents: `query { hello }` }],
    });

    expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not publish persisted operations without a client ID', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);
    const fedGraphName = genID('fedGraph');
    await setupFederatedGraph(fedGraphName, client);

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName,
      operations: [{ id: genID('hello'), contents: `query { hello }` }],
    });

    expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not publish persisted operations with invalid queries', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);
    const fedGraphName = genID('fedGraph');
    await setupFederatedGraph(fedGraphName, client);

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName,
      operations: [{ id: genID('hello'), contents: `query { does_not_exist }` }],
    });

    expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not publish persisted operations with an invalid federated graph name', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);
    const fedGraphName = genID('fedGraph');
    await setupFederatedGraph(fedGraphName, client);

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName: `not_${fedGraphName}`,
      operations: [{ id: 'hello4', contents: `query { does_not_exist }` }],
    });

    expect(publishOperationsResp.response?.code).not.toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should store persisted operations in blob storage', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest(testContext, dbname);
    const fedGraphName = genID('fedGraph');
    await setupFederatedGraph(fedGraphName, client);

    const id = genID('hello');
    const query = `query { hello }`;

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName,
      clientName: 'test-client',
      operations: [{ id, contents: query }],
    });

    expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    const storageKeys = blobStorage.keys();
    expect(storageKeys.length).toBe(1);
    const keyComponents = storageKeys[0].split('/');
    const keyFilename = keyComponents.at(-1)!;
    const keyBasename = keyFilename.split('.')[0];
    expect(keyBasename).toBe(id);

    const stream = await blobStorage.getObject(storageKeys[0]);
    const text = await new Response(stream).text();
    expect(JSON.parse(text)).toEqual({ version: 1, body: query });
    await server.close();
  });

  test('Should delete persisted operations from blob storage when the federated graph is deleted', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest(testContext, dbname);
    const fedGraphName = genID('fedGraph');
    await setupFederatedGraph(fedGraphName, client);

    const query = `query { hello }`;

    const publishOperationsResp = await client.publishPersistedOperations({
      fedGraphName,
      clientName: 'test-client',
      operations: [{ id: genID('hello'), contents: query }],
    });

    expect(publishOperationsResp.response?.code).toBe(EnumStatusCode.OK);

    expect(blobStorage.keys().length).toBe(1);

    const deleteFederatedGraphResp = await client.deleteFederatedGraph({
      name: fedGraphName,
    });
    expect(deleteFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(blobStorage.keys().length).toBe(0);

    await server.close();
  });
});
