import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { unsuccessfulBaseCompositionError } from '../src/core/errors/errors.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { createFederatedGraph, createThenPublishSubgraph, SetupTest } from './test-util.js';

let dbname = '';

const expectedFederatedGraphSDL = `schema {
  query: Query
}

directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

type Query {
  hello: String!
}`;

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Namespace tests', (ctx) => {
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

  test('Creates graphs in the correct namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph1');
    const prod = 'prod';
    const dev = 'dev';
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: prod,
    });
    await client.createNamespace({
      name: dev,
    });

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(client, subgraph1Name, prod, subgraphSchemaSDL, [label], 'http://localhost:8081');
    await createThenPublishSubgraph(client, subgraph2Name, dev, subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, prod, [joinLabel(label)], 'http://localhost:8080');
    await createFederatedGraph(client, fedGraphName, dev, [joinLabel(label)], 'http://localhost:8081');

    const prodGraph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: prod,
    });
    expect(prodGraph.graph?.namespace).toBe(prod);
    expect(prodGraph.subgraphs.length).toBe(1);
    expect(prodGraph.subgraphs[0].name).toBe(subgraph1Name);

    const devGraph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: dev,
    });
    expect(devGraph.graph?.namespace).toBe(dev);
    expect(devGraph.subgraphs.length).toBe(1);
    expect(devGraph.subgraphs[0].name).toBe(subgraph2Name);

    await server.close();
  });

  test('Ensure no duplicate graph exist in same namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const prod = 'prod';
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: prod,
    });
    const createFirstSubgraph = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: prod,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFirstSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const createSecondSubgraph = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: prod,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });
    expect(createSecondSubgraph.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    const createFirstGraph = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: prod,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFirstGraph.response?.code).toBe(EnumStatusCode.OK);

    const createSecondGraph = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: prod,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createSecondGraph.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    await server.close();
  });

  test('Ensure duplicates can exist across namespaces', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const prod = 'prod';
    const dev = 'dev';
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: prod,
    });
    await client.createNamespace({
      name: dev,
    });

    const createFirstSubgraph = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: prod,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFirstSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const createSecondSubgraph = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: dev,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });
    expect(createSecondSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const createFirstGraph = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: prod,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFirstGraph.response?.code).toBe(EnumStatusCode.OK);

    const createSecondGraph = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: dev,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createSecondGraph.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Deleting namespace should delete all graphs in it', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph1');
    const prod = 'prod';
    const dev = 'dev';
    const label = genUniqueLabel('label');

    let nsResponse = await client.createNamespace({
      name: prod,
    });

    expect(nsResponse.response?.code).toBe(EnumStatusCode.OK);

    nsResponse = await client.createNamespace({
      name: dev,
    });

    expect(nsResponse.response?.code).toBe(EnumStatusCode.OK);

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(client, subgraph1Name, prod, subgraphSchemaSDL, [label], 'http://localhost:8081');
    await createThenPublishSubgraph(client, subgraph2Name, dev, subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, prod, [joinLabel(label)], 'http://localhost:8080');
    await createFederatedGraph(client, fedGraphName, dev, [joinLabel(label)], 'http://localhost:8081');

    /**
     * Verify that all graphs are created
     */

    let graphsRes = await client.getFederatedGraphs({
      namespace: prod,
    });
    expect(graphsRes?.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsRes?.graphs.length).toBe(1);

    let subgraphsRes = await client.getSubgraphs({
      namespace: prod,
    });
    expect(subgraphsRes?.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsRes?.graphs.length).toBe(1);

    /**
     * Delete the prod namespace
     */
    const deleteNsResp = await client.deleteNamespace({
      name: prod,
    });
    expect(deleteNsResp?.response?.code).toBe(EnumStatusCode.OK);

    /**
     * Verify that the graphs can no longer be found
     */

    graphsRes = await client.getFederatedGraphs({});
    expect(graphsRes?.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsRes?.graphs.length).toBe(1);
    expect(graphsRes?.graphs[0].namespace).toBe(dev);

    const subgraphsAfterDeleteRes = await client.getSubgraphs({});
    expect(subgraphsAfterDeleteRes?.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsAfterDeleteRes?.graphs.length).toBe(1);
    expect(subgraphsAfterDeleteRes?.graphs[0]?.namespace).toBe(dev);

    /**
     * Dev resources are untouched
     */

    const graphsAfterDeleteRes = await client.getFederatedGraphs({
      namespace: dev,
    });
    expect(graphsAfterDeleteRes?.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsAfterDeleteRes?.graphs.length).toBe(1);

    subgraphsRes = await client.getSubgraphs({
      namespace: dev,
    });
    expect(subgraphsRes?.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsRes?.graphs.length).toBe(1);

    /**
     * Check if the config for the dev graph is still in blob storage
     */

    const keys = blobStorage.keys();
    expect(keys.length).toBe(1);
    expect(keys[0]).toContain(graphsAfterDeleteRes.graphs[0].id);

    await server.close();
  });

  test('Move federated graph to different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const prod = 'prod';
    const dev = 'dev';
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: prod,
    });
    await client.createNamespace({
      name: dev,
    });

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(client, subgraph1Name, prod, subgraphSchemaSDL, [label], 'http://localhost:8081');
    await createThenPublishSubgraph(client, subgraph2Name, dev, subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraph1Name, prod, [joinLabel(label)], 'http://localhost:8080');
    await createFederatedGraph(client, fedGraph2Name, dev, [joinLabel(label)], 'http://localhost:8081');

    const prodGraph = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: prod,
    });
    expect(prodGraph.graph?.namespace).toBe(prod);
    expect(prodGraph.subgraphs.length).toBe(1);
    expect(prodGraph.subgraphs[0].name).toBe(subgraph1Name);

    const devGraph = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: dev,
    });
    expect(devGraph.graph?.namespace).toBe(dev);
    expect(devGraph.subgraphs.length).toBe(1);
    expect(devGraph.subgraphs[0].name).toBe(subgraph2Name);

    /* MOVE GRAPH FROM DEV TO PROD */
    const moveRes = await client.moveFederatedGraph({
      name: fedGraph2Name,
      namespace: dev,
      newNamespace: prod,
    });
    expect(moveRes.response?.code).toBe(EnumStatusCode.OK);

    /* VERIFY */
    const graphsInDevAfterMove = await client.getFederatedGraphs({
      namespace: dev,
    });
    expect(graphsInDevAfterMove?.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsInDevAfterMove?.graphs.length).toBe(0);

    const graphsInProdAfterMove = await client.getFederatedGraphs({
      namespace: prod,
    });
    expect(graphsInProdAfterMove?.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsInProdAfterMove?.graphs.length).toBe(2);

    const devGraphInProd = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: prod,
    });
    expect(devGraphInProd.graph?.namespace).toBe(prod);
    expect(devGraphInProd.subgraphs.length).toBe(1);
    expect(devGraphInProd.subgraphs[0].name).toBe(subgraph1Name);

    const sdlRes = await client.getFederatedGraphSDLByName({
      name: devGraphInProd.graph?.name,
      namespace: devGraphInProd.graph?.namespace,
    });
    expect(sdlRes.sdl).toBe(expectedFederatedGraphSDL);

    await server.close();
  });

  test('Move subgraph to different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const fedGraph3Name = genID('fedGraph2');
    const prod = 'prod';
    const dev = 'dev';
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: prod,
    });
    await client.createNamespace({
      name: dev,
    });

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(client, subgraph1Name, prod, subgraphSchemaSDL, [label], 'http://localhost:8081');
    await createThenPublishSubgraph(client, subgraph2Name, dev, subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraph1Name, prod, [joinLabel(label)], 'http://localhost:8080');
    await createFederatedGraph(client, fedGraph2Name, dev, [joinLabel(label)], 'http://localhost:8081');
    await createFederatedGraph(client, fedGraph3Name, dev, [joinLabel(label)], 'http://localhost:8081');

    const prodGraph = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: prod,
    });
    expect(prodGraph.graph?.namespace).toBe(prod);
    expect(prodGraph.subgraphs.length).toBe(1);
    expect(prodGraph.subgraphs[0].name).toBe(subgraph1Name);

    const devGraph = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: dev,
    });
    expect(devGraph.graph?.namespace).toBe(dev);
    expect(devGraph.subgraphs.length).toBe(1);
    expect(devGraph.subgraphs[0].name).toBe(subgraph2Name);

    /* MOVE SUBGRAPH FROM DEV TO PROD */
    const moveRes = await client.moveSubgraph({
      name: subgraph2Name,
      namespace: dev,
      newNamespace: prod,
    });

    // We expect the dev graphs to have composition errors due to not having subgraphs in dev anymore
    expect(moveRes.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(moveRes.compositionErrors).toHaveLength(4);
    expect(moveRes.compositionErrors[0].federatedGraphName).toBe(fedGraph2Name);
    expect(moveRes.compositionErrors[1].federatedGraphName).toBe(fedGraph2Name);
    expect(moveRes.compositionErrors[1]).toStrictEqual(unsuccessfulBaseCompositionError(fedGraph2Name, dev));
    expect(moveRes.compositionErrors[2].federatedGraphName).toBe(fedGraph3Name);
    expect(moveRes.compositionErrors[3].federatedGraphName).toBe(fedGraph3Name);
    expect(moveRes.compositionErrors[3]).toStrictEqual(unsuccessfulBaseCompositionError(fedGraph3Name, dev));

    /* VERIFY */
    const subgraphsInDevAfterMove = await client.getSubgraphs({
      namespace: dev,
    });
    expect(subgraphsInDevAfterMove?.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsInDevAfterMove?.graphs.length).toBe(0);

    const subgraphsInProdAfterMove = await client.getSubgraphs({
      namespace: prod,
    });
    expect(subgraphsInProdAfterMove?.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsInProdAfterMove?.graphs.length).toBe(2);

    const prodGraphAfterMove = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: prod,
    });
    expect(prodGraphAfterMove.graph?.namespace).toBe(prod);
    expect(prodGraphAfterMove.subgraphs.length).toBe(2);

    const fedGraph2AfterMove = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: dev,
    });
    expect(fedGraph2AfterMove.subgraphs.length).toBe(0);

    const fedGraph3AfterMove = await client.getFederatedGraphByName({
      name: fedGraph3Name,
      namespace: dev,
    });
    expect(fedGraph3AfterMove.subgraphs.length).toBe(0);

    await server.close();
  });
});
