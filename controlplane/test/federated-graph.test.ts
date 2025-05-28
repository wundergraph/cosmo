import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel
} from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Federated Graph', (ctx) => {
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

  test('Should be able to create a federated graph from subgraphs with matching labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

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
      schema: 'type Query { hello: String! }',
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
    const { client, server } = await SetupTest({ dbname, chClient });

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
      schema: 'type Query { hello: String! }',
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
    const { client, server } = await SetupTest({ dbname, chClient });

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

    expect(graph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(graph.sdl).not.toBeDefined();

    await server.close();
  });

  test('Should be able to fetch federated schema after publishing one of the two subgraphs, and after publishing both the subgraphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

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
    expect(graph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    let publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
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
      schema: 'type Query { a: String! }',
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
    const { client, server } = await SetupTest({ dbname, chClient });

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
    expect(graph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    let publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: 'type Query { a: String! }',
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

    // delete the subgraph because it was responsible for the composition error
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
    const { client, server } = await SetupTest({ dbname });

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
    const { client, server } = await SetupTest({ dbname });

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

  test('Should be able to list federated graphs of different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the fed graph in default namespace
    let createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // creating the fed graph in prod namespace
    createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'prod',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // fetching fed graphs from default namespace
    let listFedGraphsResp = await client.getFederatedGraphs({
      namespace: 'default',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(1);

    // fetching fed graphs from prod namespace
    listFedGraphsResp = await client.getFederatedGraphs({
      namespace: 'prod',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(1);

    // fetching all fed graphs
    listFedGraphsResp = await client.getFederatedGraphs({
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(2);

    // fetching fed graphs from non-existing namespace
    listFedGraphsResp = await client.getFederatedGraphs({
      // prod1 namespace does not exist
      namespace: 'prod1',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listFedGraphsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });

  test('Should be able to list federated graphs of different namespace when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the fed graph in default namespace
    let createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // creating the fed graph in prod namespace
    createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'prod',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    // fetching fed graphs from default namespace
    let listFedGraphsResp = await client.getFederatedGraphs({
      namespace: 'default',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(1);

    // fetching fed graphs from prod namespace
    listFedGraphsResp = await client.getFederatedGraphs({
      namespace: 'prod',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(1);

    // fetching all fed graphs
    listFedGraphsResp = await client.getFederatedGraphs({
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(2);

    // fetching fed graphs from non-existing namespace
    listFedGraphsResp = await client.getFederatedGraphs({
      // prod1 namespace does not exist
      namespace: 'prod1',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listFedGraphsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });

  test.each([
    'graph-admin',
    'graph-viewer',
  ])('%s should be able to list federated graphs from allowed namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    const getNamespaceResponse = await client.getNamespace({ name: 'prod' });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    // creating the fed graph in default namespace
    let createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // creating the fed graph in prod namespace
    createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'prod',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    // fetching fed graphs from default namespace
    let listFedGraphsResp = await client.getFederatedGraphs({
      namespace: 'default',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(0);

    // fetching fed graphs from prod namespace
    listFedGraphsResp = await client.getFederatedGraphs({
      namespace: 'prod',
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(1);

    // fetching all fed graphs
    listFedGraphsResp = await client.getFederatedGraphs({
      supportsFederation: true,
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFedGraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFedGraphsResp.graphs).toHaveLength(1);

    await server.close();
  });

  test('Should return an error if the graph name is invalid', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    const label = genUniqueLabel();

    let createFedGraphRes = await client.createFederatedGraph({
      name: 'a*1',
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFedGraphRes = await client.createFederatedGraph({
      name: 'a/1*',
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFedGraphRes = await client.createFederatedGraph({
      name: '^a*1/',
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFedGraphRes = await client.createFederatedGraph({
      name: 'Test'.repeat(26),
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    await server.close();
  });
});
