import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { createFederatedGraph, createNamespace, createSubgraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('List namespaces', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to retrieve all namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(4);

    await server.close();
  });

  test('Should be able to retrieve all namespaces when using legacy API key', async () => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(4);

    await server.close();
  });

  test.each([
    'namespace-admin',
    'namespace-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to retrieve only allowed namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    const getNamespaceResponse = await client.getNamespace({ name: 'dev' });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(1);
    expect(getNamespacesResponse.namespaces[0].name).toBe('dev');

    await server.close();
  });

  test.each([
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to retrieve namespaces for allowed resources', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:3003/graphql', 'stag');

    const getSubgraphResponse = await client.getSubgraphByName({ name: subgraphName, namespace: 'stag', });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        resources: [getSubgraphResponse.graph!.targetId],
      })),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(1);
    expect(getNamespacesResponse.namespaces[0].name).toBe('stag');

    await server.close();
  });

  test.each([
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should return only `default` when user does not have access to any valid namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        resources: [randomUUID()],
      })),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(1);
    expect(getNamespacesResponse.namespaces[0].name).toBe('default');

    await server.close();
  });

  test.each([
    'graph-admin',
    'graph-viewer',
  ])('%s should be able to list namespaces where have been allowed federated graphs', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const fedGraphName = genID('federated-graph');

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    await createFederatedGraph(client, fedGraphName, 'stag', [], 'http://localhost:3003/graphql');

    const fedGraph = await client.getFederatedGraphByName({ name: fedGraphName, namespace: 'stag' });
    expect(fedGraph.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        resources: [fedGraph.graph!.targetId],
      })),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(1);
    expect(getNamespacesResponse.namespaces[0].name).toBe('stag');

    await server.close();
  });

  test.each([
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to list namespaces where have been allowed subgraphs', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createNamespace(client, 'prod');
    await createNamespace(client, 'stag');
    await createNamespace(client, 'dev');

    await createSubgraph(client, subgraphName, 'http://localhost:3003/graphql', 'dev');

    const subgraph = await client.getSubgraphByName({ name: subgraphName, namespace: 'dev' });
    expect(subgraph.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        resources: [subgraph.graph!.targetId],
      })),
    });

    const getNamespacesResponse = await client.getNamespaces({});

    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces).toBeDefined();
    expect(getNamespacesResponse.namespaces).toHaveLength(1);
    expect(getNamespacesResponse.namespaces[0].name).toBe('dev');

    await server.close();
  });
});
