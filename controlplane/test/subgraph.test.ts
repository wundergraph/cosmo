import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode, GraphQLSubscriptionProtocol } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Subgraph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph and publish the schema', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should create a subgraph when subgraph did not exist before on publish', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const pandasSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));

    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      schema: pandasSchema,
      labels: [label],
      routingUrl: 'http://localhost:3000',
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);

    expect(graph.graph?.isComposable).toBe(true);
    expect(graph.graph?.compositionErrors).toBe('');
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe('pandas');

    await server.close();
  });

  test('Should update subgraph when subgraph already exists on publish', async (testContext) => {
    const { client, nodeClient, server } = await SetupTest(testContext, dbname);

    const pandasSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));

    const federatedGraphName = genID('fedGraph');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label1)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const createSubgraphResp = await client.createFederatedSubgraph({
      name: 'pandas',
      labels: [label1],
      routingUrl: 'http://localhost:8002',
    });
    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResp = await client.getSubgraphByName({
      name: 'pandas',
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishSubgraphResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      schema: pandasSchema,
      labels: [label1, label2],
      routingUrl: 'http://localhost:3001',
      subscriptionUrl: 'http://localhost:3001',
      subscriptionProtocol: GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE,
      headers: [],
    });
    expect(publishSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getGraphResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });

    expect(getGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getGraphResp.graph?.isComposable).toBe(true);
    expect(getGraphResp.graph?.compositionErrors).toBe('');
    expect(getGraphResp.subgraphs.length).toBe(1);
    expect(getGraphResp.subgraphs[0].name).toBe('pandas');

    // Check if subgraph was updated
    expect(getGraphResp.subgraphs[0].lastUpdatedAt !== getSubgraphResp.graph?.lastUpdatedAt).toBe(true);
    expect(getGraphResp.subgraphs[0].routingURL).toBe('http://localhost:3001');
    expect(getGraphResp.subgraphs[0].labels.length).toBe(2);
    expect(getGraphResp.subgraphs[0].labels[0].key).toBe(label1.key);
    expect(getGraphResp.subgraphs[0].labels[0].value).toBe(label1.value);
    expect(getGraphResp.subgraphs[0].labels[1].key).toBe(label2.key);
    expect(getGraphResp.subgraphs[0].labels[1].value).toBe(label2.value);

    await server.close();
  });

  test('Should be able to create a subgraph with a readme', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();
    const readme = `# ${subgraphName}`;

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
      readme,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const subgraph = await client.getSubgraphByName({
      name: subgraphName,
    });

    expect(subgraph.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraph.graph?.readme).toBe(readme);
    expect(subgraph.graph?.routingURL).toBe('http://localhost:8080');
    expect(subgraph.graph?.labels).toEqual([label]);

    await server.close();
  });

  test('Should be able to create a subgraph with a readme and update it later.', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();
    const readme = `# ${subgraphName}`;
    const updatedReadme = `# ${subgraphName} test`;

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
      readme,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const updateResponse = await client.updateSubgraph({
      name: subgraphName,
      readme: updatedReadme,
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const subgraph = await client.getSubgraphByName({
      name: subgraphName,
    });

    expect(subgraph.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraph.graph?.readme).toBe(updatedReadme);
    expect(subgraph.graph?.routingURL).toBe('http://localhost:8080');
    expect(subgraph.graph?.labels).toEqual([label]);

    await server.close();
  });
});
