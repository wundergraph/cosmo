import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { createNamespace, createSubgraph, SetupTest } from './test-util.js';

let dbname = '';

describe('Create feature graph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature graph can be created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const featureGraphResponse = await client.createFederatedSubgraph({
      name: featureGraphName,
      routingUrl: 'http://localhost:4002',
      isFeatureGraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a feature graph is created without a base graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: 'http://localhost:4002',
      isFeatureGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A feature graph requires a base subgraph.');

    await server.close();
  });


  test('that an error is returned if the base graph does not exist in the same namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const namespace = 'features';
    await createNamespace(client, namespace);

    const featureGraphResponse = await client.createFederatedSubgraph({
      name: featureGraphName,
      namespace,
      routingUrl: 'http://localhost:4002',
      isFeatureGraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureGraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureGraphResponse.response?.details).toBe(`Base subgraph "${subgraphName}" does not exist in the namespace "features".`);

    await server.close();
  });

  test('that an error is returned if a feature graph is created without a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      isFeatureGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });
});
