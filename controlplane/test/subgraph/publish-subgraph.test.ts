import { readFileSync } from 'node:fs';
import path from 'node:path';
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
} from '../../src/core/test-util.js';
import {
  createEventDrivenGraph,
  createSubgraph,
  DEFAULT_NAMESPACE,
  eventDrivenGraphSDL,
  SetupTest,
  subgraphSDL,
} from '../test-util.js';

// Read the actual proto, mapping and lock files
const testDataPath = path.join(process.cwd(), 'test/test-data/plugin');
const pluginSchema = readFileSync(path.join(testDataPath, 'service.proto'), 'utf8');
const pluginMappings = readFileSync(path.join(testDataPath, 'mapping.json'), 'utf8');
const pluginLock = readFileSync(path.join(testDataPath, 'service.proto.lock.json'), 'utf8');

let dbname = '';

async function createPluginSubgraph(client: any, name: string, namespace = 'default') {
  const pluginLabel = genUniqueLabel('plugin');
  const response = await client.createFederatedSubgraph({
    name,
    namespace,
    type: SubgraphType.GRPC_PLUGIN,
    labels: [pluginLabel],
  });
  expect(response.response?.code).toBe(EnumStatusCode.OK);
  return response;
}

async function createGrpcServiceSubgraph(client: any, name: string, routingUrl: string, namespace = 'default') {
  const grpcServiceLabel = genUniqueLabel('grpc-service');
  const response = await client.createFederatedSubgraph({
    name,
    namespace,
    type: SubgraphType.GRPC_SERVICE,
    routingUrl,
    labels: [grpcServiceLabel],
  });
  expect(response.response?.code).toBe(EnumStatusCode.OK);
  return response;
}

describe('Publish subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an Event-Driven Graph can be published after it has already been created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin', 'subgraph-publisher'])(
    '%s should be able to publish to existing regular subgraph',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });

      const subgraphName = genID('subgraph');

      await createSubgraph(client, subgraphName, 'http://localhost:4001');
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
        name: subgraphName,
        namespace: 'default',
        schema: subgraphSDL,
      });

      expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    },
  );

  test('Should be able to publish to existing regular subgraph using legacy API key', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-checker',
    'subgraph-viewer',
  ])('%s should not be able to publish to existing regular subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('that an error is returned if a regular subgraph is published when the graph was created as an EDG', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'The subgraph was originally created as an Event-Driven Graph (EDG).' +
        ' An EDG cannot be retroactively changed into a regular subgraph. Please create a new regular subgraph.',
    );

    await server.close();
  });

  test('that an error is returned if an EDG is published when the graph was created as a regular subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'The subgraph was originally created as a regular subgraph.' +
        ' A regular subgraph cannot be retroactively changed into an Event-Driven Graph (EDG).' +
        ' Please create a new Event-Driven subgraph with the --edg flag.',
    );

    await server.close();
  });

  test('that parameters are ignored if an Event-Driven Graph is published after it has already been created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      routingUrl: '',
      subscriptionUrl: '',
      subscriptionProtocol: 1,
      websocketSubprotocol: 1,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an Event-Driven Graph can be published without already being created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
    '%s should be able to publish regular subgraph without already being created',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });

      const subgraphName = genID('subgraph');

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
        name: subgraphName,
        namespace: 'default',
        schema: subgraphSDL,
        routingUrl: 'http://localhost:4001',
      });

      expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

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
    'subgraph-checker',
    'subgraph-viewer',
  ])('%s should not be able to publish regular subgraph without already being created', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
      routingUrl: 'http://localhost:4001',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      routingUrl: '',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a routing URL');

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a subscription URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      subscriptionUrl: '',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'An Event-Driven Graph must not define a subscription URL',
    );

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a subscription protocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      subscriptionProtocol: 1,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'An Event-Driven Graph must not define a subscription protocol',
    );

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a websocket subprotocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      websocketSubprotocol: 1,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'An Event-Driven Graph must not define a websocket subprotocol.',
    );

    await server.close();
  });

  test('that an error is returned if a previously uncreated subgraph is published without a routing url', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'A valid, non-empty routing URL is required to create and publish a non-Event-Driven subgraph.',
    );

    await server.close();
  });

  test('that an error is returned if a previously uncreated subgraph is published with an invalid routing url', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
      routingUrl: 'url',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('Routing URL "url" is not a valid URL.');

    await server.close();
  });

  describe('Plugin subgraph publish tests', () => {
    const pluginSDL = `
      type Query {
        hello: String!
      }
    `;

    const validProtoRequest = {
      version: 'v1',
      platforms: ['linux/amd64', 'darwin/amd64'],
      schema: pluginSchema,
      mappings: pluginMappings,
      lock: pluginLock,
    };

    test('Should be able to publish an existing plugin subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      // First create the plugin subgraph
      await createPluginSubgraph(client, pluginName);

      // Then publish to it
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: validProtoRequest,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

      // Validate by fetching the subgraph and checking type, version, and platforms
      const getSubgraphResponse = await client.getSubgraphByName({
        name: pluginName,
        namespace: 'default',
      });

      expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(getSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
      expect(getSubgraphResponse.graph?.pluginData?.version).toBe(validProtoRequest.version);
      expect(getSubgraphResponse.graph?.pluginData?.platforms).toEqual(validProtoRequest.platforms);

      await server.close();
    });

    test('Should be able to create and publish a plugin subgraph in one step when plugin does not exist', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      // Publish to a non-existent plugin subgraph (should create and publish)
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: validProtoRequest,
        labels: [genUniqueLabel('plugin')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

      // Validate by fetching the subgraph and checking type, version, and platforms
      const getSubgraphResponse = await client.getSubgraphByName({
        name: pluginName,
        namespace: 'default',
      });

      expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(getSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
      expect(getSubgraphResponse.graph?.pluginData?.version).toBe(validProtoRequest.version);
      expect(getSubgraphResponse.graph?.pluginData?.platforms).toEqual(validProtoRequest.platforms);

      await server.close();
    });

    test('Should enforce plugin limits when creating plugin via publish', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'developer@1' }, // Developer plan has 3 plugin limit
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

      // Try to publish to a non-existent plugin subgraph on developer plan
      const publishResponse = await client.publishFederatedSubgraph({
        name: fourthPluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: validProtoRequest,
        labels: [genUniqueLabel('plugin')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
      expect(publishResponse.response?.details).toBe('The organization reached the limit of plugins');

      await server.close();
    });

    test('Should fail when trying to publish a plugin with same name as existing regular subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const subgraphName = genID('subgraph');

      // First create a regular subgraph
      await createSubgraph(client, subgraphName, 'http://localhost:4001');

      // Try to publish a plugin with the same name
      const publishResponse = await client.publishFederatedSubgraph({
        name: subgraphName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: validProtoRequest,
        labels: [genUniqueLabel('plugin')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toContain(`Subgraph ${subgraphName} is not of type grpc_plugin`);

      await server.close();
    });

    test('Should fail when trying to publish a plugin with STANDARD type', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      // First create a plugin subgraph
      await createPluginSubgraph(client, pluginName);

      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: subgraphSDL,
        routingUrl: 'http://localhost:4001',
        type: SubgraphType.STANDARD,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toContain(
        `Subgraph ${pluginName} is a plugin. Please use the 'wgc router plugin publish' command to publish the plugin.`,
      );

      await server.close();
    });

    test('Should fail to publish plugin without required proto information', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      // Try to publish without proto
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe('The proto is required for plugin and grpc subgraphs.');

      await server.close();
    });

    test('Should fail to publish plugin without version', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      const incompleteProto = {
        goModulePath: 'github.com/example/plugin',
        platforms: ['linux/amd64'],
        schema: pluginSchema,
        mappings: pluginMappings,
        lock: pluginLock,
      };

      // Try to publish without version
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: incompleteProto,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe('The version and platforms are required for plugin subgraphs.');

      await server.close();
    });

    test('Should fail to publish plugin without platforms', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      const incompleteProto = {
        goModulePath: 'github.com/example/plugin',
        version: 'v1',
        schema: pluginSchema,
        mappings: pluginMappings,
        lock: pluginLock,
      };

      // Try to publish without platforms
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: incompleteProto,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe('The version and platforms are required for plugin subgraphs.');

      await server.close();
    });

    test('Should fail to publish plugin with invalid version format', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      const invalidProto = {
        ...validProtoRequest,
        version: '1.0.0', // Invalid format, should be v1, v2, etc.
      };

      // Try to publish with invalid version format
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: invalidProto,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe('The version must be in the format v1, v2, etc.');

      await server.close();
    });

    test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
      '%s should be able to create and publish plugin subgraph',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({
          dbname,
          setupBilling: { plan: 'launch@1' },
        });

        const pluginName = genID('plugin');

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const publishResponse = await client.publishFederatedSubgraph({
          name: pluginName,
          namespace: 'default',
          schema: pluginSDL,
          type: SubgraphType.GRPC_PLUGIN,
          proto: validProtoRequest,
          labels: [genUniqueLabel('plugin')],
        });

        expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

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
      'subgraph-checker',
      'subgraph-viewer',
    ])('%s should not be able to create and publish plugin subgraph', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: pluginSDL,
        type: SubgraphType.GRPC_PLUGIN,
        proto: validProtoRequest,
        labels: [genUniqueLabel('plugin')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test.each(['organization-admin', 'organization-developer', 'subgraph-admin', 'subgraph-publisher'])(
      '%s should be able to publish to existing plugin subgraph',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({
          dbname,
          setupBilling: { plan: 'launch@1' },
        });

        const pluginName = genID('plugin');

        // First create the plugin subgraph
        await createPluginSubgraph(client, pluginName);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const publishResponse = await client.publishFederatedSubgraph({
          name: pluginName,
          namespace: 'default',
          schema: pluginSDL,
          type: SubgraphType.GRPC_PLUGIN,
          proto: validProtoRequest,
        });

        expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

        await server.close();
      },
    );
  });

  describe('GRPC Service subgraph publish tests', () => {
    const grpcServiceSDL = `
      type Query {
        grpcServiceHello: String!
      }
    `;

    const validGrpcProtoRequest = {
      schema: pluginSchema,
      mappings: pluginMappings,
      lock: pluginLock,
    };

    test('Should be able to publish an existing GRPC service subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const routingUrl = 'http://localhost:4001';

      // First create the GRPC service subgraph
      await createGrpcServiceSubgraph(client, grpcServiceName, routingUrl);

      // Then publish to it
      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        proto: validGrpcProtoRequest,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

      // Validate by fetching the subgraph and checking type
      const getSubgraphResponse = await client.getSubgraphByName({
        name: grpcServiceName,
        namespace: 'default',
      });

      expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(getSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
      expect(getSubgraphResponse.graph?.routingURL).toBe(routingUrl);

      await server.close();
    });

    test('Should be able to create and publish a GRPC service subgraph in one step when service does not exist', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const routingUrl = 'http://localhost:4001';

      // Publish to a non-existent GRPC service subgraph (should create and publish)
      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl,
        proto: validGrpcProtoRequest,
        labels: [genUniqueLabel('grpc-service')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

      // Validate by fetching the subgraph and checking type and routing URL
      const getSubgraphResponse = await client.getSubgraphByName({
        name: grpcServiceName,
        namespace: 'default',
      });

      expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(getSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
      expect(getSubgraphResponse.graph?.routingURL).toBe(routingUrl);

      await server.close();
    });

    test('Should fail when trying to publish a GRPC service with same name as existing regular subgraph', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const subgraphName = genID('subgraph');

      // First create a regular subgraph
      await createSubgraph(client, subgraphName, 'http://localhost:4001');

      // Try to publish a GRPC service with the same name
      const publishResponse = await client.publishFederatedSubgraph({
        name: subgraphName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: 'http://localhost:4002',
        proto: validGrpcProtoRequest,
        labels: [genUniqueLabel('grpc-service')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toContain(`Subgraph ${subgraphName} is not of type grpc_service`);

      await server.close();
    });

    test('Should fail when trying to publish a GRPC service with same name as existing plugin', async () => {
      const { client, server } = await SetupTest({
        dbname,
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');

      // First create a plugin subgraph
      await createPluginSubgraph(client, pluginName);

      // Try to publish a GRPC service with the same name
      const publishResponse = await client.publishFederatedSubgraph({
        name: pluginName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: 'http://localhost:4001',
        proto: validGrpcProtoRequest,
        labels: [genUniqueLabel('grpc-service')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toContain(`Subgraph ${pluginName} is a plugin. Please use the 'wgc router plugin publish' command to publish the plugin.`);

      await server.close();
    });

    test('Should fail when trying to publish a GRPC service with STANDARD type', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const routingUrl = 'http://localhost:4001';

      // First create a GRPC service subgraph
      await createGrpcServiceSubgraph(client, grpcServiceName, routingUrl);

      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: subgraphSDL,
        routingUrl,
        type: SubgraphType.STANDARD,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toContain(
        `Subgraph ${grpcServiceName} is a grpc service. Please use the 'wgc grpc-service publish' command to publish the grpc service.`,
      );

      await server.close();
    });

    test('Should fail to publish GRPC service without required proto information', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const routingUrl = 'http://localhost:4001';

      // Try to publish without proto
      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl,
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe('The proto is required for plugin and grpc subgraphs.');

      await server.close();
    });

    test('Should fail to create and publish GRPC service without routing URL', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');

      // Try to publish without routing URL
      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        proto: validGrpcProtoRequest,
        labels: [genUniqueLabel('grpc-service')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe(
        'A valid, non-empty routing URL is required to create and publish a non-Event-Driven subgraph.',
      );

      await server.close();
    });

    test('Should fail to create and publish GRPC service with invalid routing URL', async () => {
      const { client, server } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');

      // Try to publish with invalid routing URL
      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: 'invalid-url',
        proto: validGrpcProtoRequest,
        labels: [genUniqueLabel('grpc-service')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(publishResponse.response?.details).toBe('Routing URL "invalid-url" is not a valid URL.');

      await server.close();
    });

    test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
      '%s should be able to create and publish GRPC service subgraph',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({
          dbname,
        });

        const grpcServiceName = genID('grpc-service');
        const routingUrl = 'http://localhost:4001';

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const publishResponse = await client.publishFederatedSubgraph({
          name: grpcServiceName,
          namespace: 'default',
          schema: grpcServiceSDL,
          type: SubgraphType.GRPC_SERVICE,
          routingUrl,
          proto: validGrpcProtoRequest,
          labels: [genUniqueLabel('grpc-service')],
        });

        expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

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
    ])('%s should not be able to create and publish GRPC service subgraph', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({
        dbname,
      });

      const grpcServiceName = genID('grpc-service');
      const routingUrl = 'http://localhost:4001';

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const publishResponse = await client.publishFederatedSubgraph({
        name: grpcServiceName,
        namespace: 'default',
        schema: grpcServiceSDL,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl,
        proto: validGrpcProtoRequest,
        labels: [genUniqueLabel('grpc-service')],
      });

      expect(publishResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test.each(['organization-admin', 'organization-developer', 'subgraph-admin', 'subgraph-publisher'])(
      '%s should be able to publish to existing GRPC service subgraph',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({
          dbname,
        });

        const grpcServiceName = genID('grpc-service');
        const routingUrl = 'http://localhost:4001';

        // First create the GRPC service subgraph
        await createGrpcServiceSubgraph(client, grpcServiceName, routingUrl);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const publishResponse = await client.publishFederatedSubgraph({
          name: grpcServiceName,
          namespace: 'default',
          schema: grpcServiceSDL,
          type: SubgraphType.GRPC_SERVICE,
          proto: validGrpcProtoRequest,
        });

        expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

        await server.close();
      },
    );
  });
});
