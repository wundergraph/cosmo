import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import {
  DEFAULT_NAMESPACE,
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('GetWorkspace', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return the default namespace even when empty', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getWorkspace({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.namespaces.length).toBe(1);
    expect(response.namespaces[0].name).toBe(DEFAULT_NAMESPACE);
    expect(response.namespaces[0].graphs).toEqual([]);
  });

  test('Should return all namespaces sorted alphabetically', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    await createNamespace(client, 'zeta');
    await createNamespace(client, 'alpha');
    await createNamespace(client, 'beta');

    const response = await client.getWorkspace({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const names = response.namespaces.map((ns) => ns.name);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(names).toEqual(sortedNames);
  });

  test('Should include federated graphs in the namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getWorkspace({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const defaultNs = response.namespaces.find((ns) => ns.name === DEFAULT_NAMESPACE);
    expect(defaultNs?.name).toBe(DEFAULT_NAMESPACE);
    expect(defaultNs?.graphs.length).toBe(1);
    expect(defaultNs?.graphs[0].name).toBe(graphName);
  });

  test('Should include associated subgraphs with federated graphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, ['team=A'], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String }',
      [{ key: 'team', value: 'A' }],
      'http://localhost:4001',
    );

    const response = await client.getWorkspace({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const defaultNs = response.namespaces.find((ns) => ns.name === DEFAULT_NAMESPACE);
    const graph = defaultNs?.graphs.find((g) => g.name === graphName);
    expect(graph?.name).toBe(graphName);
    // Published subgraph with matching label should be associated with the graph
    expect(graph?.subgraphs.length).toBe(1);
    expect(graph?.subgraphs[0].name).toBe(subgraphName);
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
  ])('%s should be able to get the workspace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const response = await client.getWorkspace({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    // Default namespace is always visible to users with appropriate access
    expect(response.namespaces.length).toBe(1);
    expect(response.namespaces[0].name).toBe(DEFAULT_NAMESPACE);
  });

  test('Should be able to get workspace when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const response = await client.getWorkspace({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });
});
