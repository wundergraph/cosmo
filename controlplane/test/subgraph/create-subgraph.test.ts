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
  TestUser
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';
import { OrganizationRole } from '../../src/db/models.js';

let dbname = '';

describe('Create subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an Event-Driven subgraph can be created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
  ])('%s should create regular subgraph can be created', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should create regular subgraph can be created using legacy API key', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('subgraph-admin should create regular subgraph can be created on allowed namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    await createNamespace(client, 'prod');

    const subgraphName = genID('subgraph');

    const getNamespaceResponses = await client.getNamespaces({});
    expect(getNamespaceResponses.response?.code).toBe(EnumStatusCode.OK);

    const defaultNamespace = getNamespaceResponses.namespaces?.find((ns) => ns.name === DEFAULT_NAMESPACE);
    const prodNamespace = getNamespaceResponses.namespaces?.find((ns) => ns.name === 'prod');
    expect(defaultNamespace).toBeDefined();
    expect(prodNamespace).toBeDefined();

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [defaultNamespace!.id],
      })),
    });

    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [prodNamespace!.id],
      })),
    });

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('subgraph-admin should not create regular subgraph can be created when allowed resources', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    await createNamespace(client, 'prod');

    const subgraphName = genID('subgraph');

    const getNamespaceResponses = await client.getNamespaces({});
    expect(getNamespaceResponses.response?.code).toBe(EnumStatusCode.OK);

    const defaultNamespace = getNamespaceResponses.namespaces?.find((ns) => ns.name === DEFAULT_NAMESPACE);
    const prodNamespace = getNamespaceResponses.namespaces?.find((ns) => ns.name === 'prod');
    expect(defaultNamespace).toBeDefined();
    expect(prodNamespace).toBeDefined();

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        resources: [randomUUID()],
      })),
    });

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to create regular subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('that an error is returned if the name is invalid', async () => {
    const { client, server } = await SetupTest({ dbname });

    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: "a*a",
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: "a*a/",
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: "^a*a/",
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: "Test".repeat(26),
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      routingUrl: '',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a routing URL');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a subscription URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      subscriptionUrl: '',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a subscription URL');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a subscription protocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      subscriptionProtocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a subscription protocol');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a websocket subprotocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      websocketSubprotocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a websocket subprotocol');

    await server.close();
  });

  test('that a valid subscription URL is accepted', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      subscriptionUrl: 'ws://whatever.co',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if an invalid subscription URL is defined', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      subscriptionUrl: 'url',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Subscription URL "url" is not a valid URL');

    await server.close();
  });

  test('that an error is returned if a regular subgraph is created without a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });

  test('that an error is returned if a regular subgraph is created with an invalid routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: 'url',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Routing URL "url" is not a valid URL');

    await server.close();
  });

  test('that an error is returned if a subgraph is created with the same name as another feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const createSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: false,
    });
    expect(createSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(createSubgraphResponse.response?.details)
      .toBe(`A feature subgraph with the name "${featureSubgraphName}" already exists in the namespace "default".`);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
  ])('%s should be able to create subgraphs', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['rbac'] });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole }))
    })

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to create subgraphs', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['rbac'] });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole }))
    })

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('Should be able to create subgraphs only on allowed namespaces', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['rbac'] });

    const subgraphName = genID('subgraph');

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [randomUUID()],
      })),
    });

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  })
});
