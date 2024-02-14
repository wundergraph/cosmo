import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Federated Graph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a federated graph from subgraphs with matching labels', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraph1Name = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph.subgraphs[0].routingURL).toBe('http://localhost:8080');

    await server.close();
  });

  test('Should be able to add subgraphs to an existing Federated Graph based on matching labels', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraph1Name = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph.subgraphs[0].routingURL).toBe('http://localhost:8080');

    await server.close();
  });

  test('Subgraphs should not be composed into a federated graph until it is published', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph2Res = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubraph2Res.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });

    // A dummy schema is returned that is mocked by the router.
    // The schema is overridden by the next publication of any subgraph
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).toContain('hello');

    await server.close();
  });

  test('Should be able to fetch federated schema after publishing one of the two subgraphs, and after publishing both the subgraphs', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph2Res = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubraph2Res.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    let graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });

    // A dummy schema is returned that is mocked by the router.
    // The schema is overridden by the next publication of any subgraph
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).toContain('hello');

    let publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after publishing one of the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    publishResp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { a: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after publishing both the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    await server.close();
  });

  test('Should not be able to fetch federated schema before publishing the subgraphs and after publishing, deleting the subgraphs', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph2Res = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubraph2Res.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // fetching schema before publishing the subgraphs
    let graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });

    // A dummy schema is returned that is mocked by the router.
    // The schema is overridden by the next publication of any subgraph
    expect(graph.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { a: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after publishing both the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    // deleting the subgraph
    let deleteSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName: subgraph1Name,
      namespace: 'default',
    });
    expect(deleteSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after deleting one of the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    // delete the subgraph because it was the only one it produced a composition error
    deleteSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
      namespace: 'default',
    });
    expect(deleteSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    // fetching the federated schema after deleting both the subgraphs
    // because a federated graph with no subgraphs is not allowed the last valid schema should be returned
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();

    await server.close();
  });

  test('Should be able to create a federated graph with a readme', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();
    const readme = `# ${fedGraphName}`;

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
      readme,
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.graph?.readme).toBe(readme);
    expect(graph.graph?.routingURL).toBe('http://localhost:8081');
    expect(graph.graph?.labelMatchers).toEqual([joinLabel(label)]);

    await server.close();
  });

  test('Should be able to create a federated graph with a readme and update the readme later', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();
    const readme = `# ${fedGraphName}`;
    const updatedReadme = `# ${fedGraphName} test`;

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
      readme,
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const updateResponse = await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      readme: updatedReadme,
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.graph?.readme).toBe(updatedReadme);
    expect(graph.graph?.routingURL).toBe('http://localhost:8081');
    expect(graph.graph?.labelMatchers).toEqual([joinLabel(label)]);

    await server.close();
  });
});
