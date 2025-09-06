import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
  TestUser,
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

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
    '%s should create regular subgraph can be created',
    async (role) => {
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
    },
  );

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
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'subgraph-admin',
          namespaces: [defaultNamespace!.id],
        }),
      ),
    });

    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'subgraph-admin',
          namespaces: [prodNamespace!.id],
        }),
      ),
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
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'subgraph-admin',
          resources: [randomUUID()],
        }),
      ),
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
      name: 'a*a',
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: 'a*a/',
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: '^a*a/',
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: 'Test'.repeat(26),
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
    expect(createFederatedSubgraphResp.response?.details).toBe(
      'An Event-Driven Graph must not define a subscription URL',
    );

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
    expect(createFederatedSubgraphResp.response?.details).toBe(
      'An Event-Driven Graph must not define a subscription protocol',
    );

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
    expect(createFederatedSubgraphResp.response?.details).toBe(
      'An Event-Driven Graph must not define a websocket subprotocol',
    );

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
    expect(createSubgraphResponse.response?.details).toBe(
      `A feature subgraph with the name "${featureSubgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
    '%s should be able to create subgraphs',
    async (role) => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
      });

      const subgraphName = genID('subgraph');

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
      });

      const createFederatedSubgraphResp = await client.createFederatedSubgraph({
        name: subgraphName,
        namespace: DEFAULT_NAMESPACE,
        isEventDrivenGraph: true,
      });

      expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    },
  );

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
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      enabledFeatures: ['rbac'],
    });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
    });

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('Should be able to create subgraphs only on allowed namespaces', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      enabledFeatures: ['rbac'],
    });

    const subgraphName = genID('subgraph');

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'subgraph-admin',
          namespaces: [getNamespaceResponse.namespace!.id],
        }),
      ),
    });

    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'subgraph-admin',
          namespaces: [randomUUID()],
        }),
      ),
    });

    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  describe('Plugin subgraph creation tests', () => {
    test('Should be able to create a plugin subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');
      const pluginLabel = genUniqueLabel('plugin');

      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: pluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [pluginLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Validate that the subgraph was created with the correct type
      const getSubgraphResp = await client.getSubgraphByName({
        name: pluginName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
      expect(getSubgraphResp.graph).toBeDefined();
      expect(getSubgraphResp.graph?.name).toBe(pluginName);
      expect(getSubgraphResp.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);

      await server.close();
    });

    test('Should not be able to create a plugin subgraph on developer plan', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'developer@1' },
      });

      // Create 3 plugins successfully
      for (let i = 1; i <= 3; i++) {
        const pluginName = genID(`plugin-${i}`);
        const pluginLabel = genUniqueLabel(`team-${i}`);

        const createPluginSubgraphResp = await client.createFederatedSubgraph({
          name: pluginName,
          namespace: DEFAULT_NAMESPACE,
          type: SubgraphType.GRPC_PLUGIN,
          labels: [pluginLabel],
        });

        expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
      }

      const fourthPluginName = genID('plugin-4');
      const fourthPluginLabel = genUniqueLabel('team-4');

      const createFourthPluginResponse = await client.createFederatedSubgraph({
        name: fourthPluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [fourthPluginLabel],
      });

      expect(createFourthPluginResponse.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
      expect(createFourthPluginResponse.response?.details).toBe('The organization reached the limit of plugins');

      await server.close();
    });

    test('Should enforce plugin limit on launch plan (max 10 plugins)', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      // Create 10 plugins successfully
      for (let i = 1; i <= 10; i++) {
        const pluginName = genID(`plugin-${i}`);
        const pluginLabel = genUniqueLabel(`team-${i}`);

        const createPluginSubgraphResp = await client.createFederatedSubgraph({
          name: pluginName,
          namespace: DEFAULT_NAMESPACE,
          type: SubgraphType.GRPC_PLUGIN,
          labels: [pluginLabel],
        });

        expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
      }

      // The 11th plugin should fail due to limit
      const eleventhPluginName = genID('plugin-11');
      const eleventhPluginLabel = genUniqueLabel('team-11');

      const createEleventhPluginResp = await client.createFederatedSubgraph({
        name: eleventhPluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [eleventhPluginLabel],
      });

      expect(createEleventhPluginResp.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
      expect(createEleventhPluginResp.response?.details).toBe('The organization reached the limit of plugins');

      await server.close();
    });

    test('Should not allow creating a plugin with the same name as a regular subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const sharedName = genID('shared-subgraph');
      const regularLabel = genUniqueLabel('backend');
      const pluginLabel = genUniqueLabel('middleware');

      // First create a regular subgraph
      const createRegularSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [regularLabel],
      });

      expect(createRegularSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Try to create a plugin with the same name - should fail
      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [pluginLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
      expect(createPluginSubgraphResp.response?.details).toBe(
        `A subgraph with the name "${sharedName}" already exists in the namespace "${DEFAULT_NAMESPACE}".`,
      );

      await server.close();
    });

    test('Should not allow creating a regular subgraph with the same name as a plugin', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const sharedName = genID('shared-plugin');
      const pluginLabel = genUniqueLabel('auth');
      const regularLabel = genUniqueLabel('api');

      // First create a plugin subgraph
      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [pluginLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Try to create a regular subgraph with the same name - should fail
      const createRegularSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [regularLabel],
      });

      expect(createRegularSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
      expect(createRegularSubgraphResp.response?.details).toBe(
        `A subgraph with the name "${sharedName}" already exists in the namespace "${DEFAULT_NAMESPACE}".`,
      );

      await server.close();
    });

    test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
      '%s should be able to create plugin subgraphs',
      async (role) => {
        const { client, server, users, authenticator } = await SetupTest({
          dbname,
          enableMultiUsers: true,
          enabledFeatures: ['rbac'],
          setupBilling: { plan: 'launch@1' },
        });

        const pluginName = genID('plugin');
        const pluginLabel = genUniqueLabel('service');

        authenticator.changeUserWithSuppliedContext({
          ...users[TestUser.adminAliceCompanyA],
          rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
        });

        const createPluginSubgraphResp = await client.createFederatedSubgraph({
          name: pluginName,
          namespace: DEFAULT_NAMESPACE,
          type: SubgraphType.GRPC_PLUGIN,
          labels: [pluginLabel],
        });

        expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        await server.close();
      },
    );

    test.each([
      'organization-apikey-manager',
      'organization-viewer',
      'namespace-admin',
      'namespace-viewer',
      'graph-admin',
      'graph-viewer',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s should not be able to create plugin subgraphs', async (role) => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');
      const pluginLabel = genUniqueLabel('restricted');

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
      });

      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: pluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [pluginLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test('Should be able to create plugin subgraphs with multiple labels', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('multi-label-plugin');
      const envLabel = genUniqueLabel('env');
      const teamLabel = genUniqueLabel('team');
      const typeLabel = genUniqueLabel('type');

      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: pluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [envLabel, teamLabel, typeLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });

    test('Should verify plugin limits only apply to plugins, not regular subgraphs', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      // First, create the maximum number of plugins (10 for launch plan)
      for (let i = 1; i <= 10; i++) {
        const pluginName = genID(`plugin-${i}`);
        const pluginLabel = genUniqueLabel(`plugin-${i}`);

        const createPluginResp = await client.createFederatedSubgraph({
          name: pluginName,
          namespace: DEFAULT_NAMESPACE,
          type: SubgraphType.GRPC_PLUGIN,
          labels: [pluginLabel],
        });

        expect(createPluginResp.response?.code).toBe(EnumStatusCode.OK);
      }

      // Verify that creating another plugin fails due to limit
      const extraPluginName = genID('extra-plugin');
      const extraPluginLabel = genUniqueLabel('extra-plugin');

      const createExtraPluginResp = await client.createFederatedSubgraph({
        name: extraPluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [extraPluginLabel],
      });

      expect(createExtraPluginResp.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
      expect(createExtraPluginResp.response?.details).toBe('The organization reached the limit of plugins');

      // Now verify that regular subgraphs can still be created even after hitting plugin limit
      for (let i = 1; i <= 5; i++) {
        const regularSubgraphName = genID(`regular-subgraph-${i}`);
        const regularLabel = genUniqueLabel(`regular-${i}`);

        const createRegularResp = await client.createFederatedSubgraph({
          name: regularSubgraphName,
          namespace: DEFAULT_NAMESPACE,
          routingUrl: `http://localhost:808${i}`,
          labels: [regularLabel],
        });

        expect(createRegularResp.response?.code).toBe(EnumStatusCode.OK);
      }

      // Also verify that event-driven subgraphs can still be created
      for (let i = 1; i <= 2; i++) {
        const eventDrivenName = genID(`event-driven-${i}`);
        const eventLabel = genUniqueLabel(`event-${i}`);

        const createEventDrivenResp = await client.createFederatedSubgraph({
          name: eventDrivenName,
          namespace: DEFAULT_NAMESPACE,
          isEventDrivenGraph: true,
          labels: [eventLabel],
        });

        expect(createEventDrivenResp.response?.code).toBe(EnumStatusCode.OK);
      }

      await server.close();
    });
  });

  describe('GRPC Service subgraph creation tests', () => {
    test('Should be able to create a GRPC service subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const grpcServiceLabel = genUniqueLabel('service');

      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Validate that the subgraph was created with the correct type
      const getSubgraphResp = await client.getSubgraphByName({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
      expect(getSubgraphResp.graph).toBeDefined();
      expect(getSubgraphResp.graph?.name).toBe(grpcServiceName);
      expect(getSubgraphResp.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
      expect(getSubgraphResp.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_ONE);

      await server.close();
    });

    test('Should not allow creating a GRPC service subgraph without a routing URL', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const grpcServiceLabel = genUniqueLabel('service');

      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
      expect(createGrpcServiceSubgraphResp.response?.details).toBe(
        'A non-Event-Driven Graph must define a routing URL',
      );

      await server.close();
    });

    test('Should not allow creating a GRPC service subgraph with invalid routing URL', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const grpcServiceLabel = genUniqueLabel('service');

      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: 'invalid-url',
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
      expect(createGrpcServiceSubgraphResp.response?.details).toBe('Routing URL "invalid-url" is not a valid URL');

      await server.close();
    });

    test('Should not allow creating a GRPC service with the same name as a regular subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const sharedName = genID('shared-subgraph');
      const regularLabel = genUniqueLabel('backend');
      const grpcServiceLabel = genUniqueLabel('grpc-service');

      // First create a regular subgraph
      const createRegularSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [regularLabel],
      });

      expect(createRegularSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Try to create a GRPC service with the same name - should fail
      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
      expect(createGrpcServiceSubgraphResp.response?.details).toBe(
        `A subgraph with the name "${sharedName}" already exists in the namespace "${DEFAULT_NAMESPACE}".`,
      );

      await server.close();
    });

    test('Should not allow creating a regular subgraph with the same name as a GRPC service', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const sharedName = genID('shared-grpc-service');
      const grpcServiceLabel = genUniqueLabel('grpc-service');
      const regularLabel = genUniqueLabel('api');

      // First create a GRPC service subgraph
      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Try to create a regular subgraph with the same name - should fail
      const createRegularSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
        labels: [regularLabel],
      });

      expect(createRegularSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
      expect(createRegularSubgraphResp.response?.details).toBe(
        `A subgraph with the name "${sharedName}" already exists in the namespace "${DEFAULT_NAMESPACE}".`,
      );

      await server.close();
    });

    test('Should not allow creating a GRPC service with the same name as a plugin', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const sharedName = genID('shared-plugin-grpc');
      const pluginLabel = genUniqueLabel('plugin');
      const grpcServiceLabel = genUniqueLabel('grpc-service');

      // First create a plugin subgraph
      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [pluginLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Try to create a GRPC service with the same name - should fail
      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: sharedName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
      expect(createGrpcServiceSubgraphResp.response?.details).toBe(
        `A subgraph with the name "${sharedName}" already exists in the namespace "${DEFAULT_NAMESPACE}".`,
      );

      await server.close();
    });

    test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
      '%s should be able to create GRPC service subgraphs',
      async (role) => {
        const { client, server, users, authenticator } = await SetupTest({
          dbname,
          enableMultiUsers: true,
          enabledFeatures: ['rbac'],
        });

        const grpcServiceName = genID('grpc-service');
        const grpcServiceLabel = genUniqueLabel('service');

        authenticator.changeUserWithSuppliedContext({
          ...users[TestUser.adminAliceCompanyA],
          rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
        });

        const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
          name: grpcServiceName,
          namespace: DEFAULT_NAMESPACE,
          type: SubgraphType.GRPC_SERVICE,
          routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
          labels: [grpcServiceLabel],
        });

        expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        await server.close();
      },
    );

    test.each([
      'organization-apikey-manager',
      'organization-viewer',
      'namespace-admin',
      'namespace-viewer',
      'graph-admin',
      'graph-viewer',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s should not be able to create GRPC service subgraphs', async (role) => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
      });

      const grpcServiceName = genID('grpc-service');
      const grpcServiceLabel = genUniqueLabel('service');

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
      });

      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [grpcServiceLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test('Should be able to create GRPC service subgraphs with multiple labels', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('multi-label-grpc-service');
      const envLabel = genUniqueLabel('env');
      const teamLabel = genUniqueLabel('team');
      const typeLabel = genUniqueLabel('type');

      const createGrpcServiceSubgraphResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [envLabel, teamLabel, typeLabel],
      });

      expect(createGrpcServiceSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });
  });
});
