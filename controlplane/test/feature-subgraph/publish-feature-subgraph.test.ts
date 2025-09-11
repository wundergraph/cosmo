import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import {
  createNamespace,
  createSubgraph,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
  createThenPublishSubgraph,
  createFederatedGraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_NAMESPACE,
} from '../test-util.js';

let dbname = '';

// Helper function to enable proposals for namespace
async function enableProposalsForNamespace(client: any, namespace = 'default') {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });

  return enableResponse;
}

// Read the test proto data for gRPC service tests
const testDataPath = path.join(process.cwd(), 'test/test-data/plugin');
const grpcProtoSchema = readFileSync(path.join(testDataPath, 'service.proto'), 'utf8');
const grpcProtoMappings = readFileSync(path.join(testDataPath, 'mapping.json'), 'utf8');
const grpcProtoLock = readFileSync(path.join(testDataPath, 'service.proto.lock.json'), 'utf8');

describe('Publish feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature subgraph can be created and published inheriting STANDARD type from base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Verify the base subgraph is STANDARD type
    const getBaseSubgraphResponse = await client.getSubgraphByName({
      name: baseSubgraphName,
    });
    expect(getBaseSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBaseSubgraphResponse.graph?.type).toBe(SubgraphType.STANDARD);

    // Create and publish feature subgraph in one command - replicating CLI call
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph was created and inherited the STANDARD type
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.STANDARD);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);

    await server.close();
  });

  test('that a feature subgraph cannot be created and published with a plugin base subgraph using wgc fs publish', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const basePluginName = genID('basePlugin');
    const featureSubgraphName = genID('featureSubgraph');
    const pluginLabel = genUniqueLabel('plugin');

    // Create a plugin base subgraph
    const createBasePluginResponse = await client.createFederatedSubgraph({
      name: basePluginName,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createBasePluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to create and publish feature subgraph based on plugin - should fail (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName: basePluginName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      `Cannot create a feature subgraph with a plugin base subgraph using this command. Since the base subgraph "${basePluginName}" is a plugin, please use the 'wgc feature-subgraph create' command to create the feature subgraph first, then publish it using the 'wgc router plugin publish' command.`,
    );

    await server.close();
  });

  test('that a plugin subgraph cannot be published with STANDARD type', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const pluginLabel = genUniqueLabel('plugin');

    // Create a plugin subgraph
    const createPluginResponse = await client.createFederatedSubgraph({
      name: pluginName,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createPluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to publish the plugin with STANDARD type - should fail
    const publishPluginResponse = await client.publishFederatedSubgraph({
      disableResolvabilityValidation: false,
      isFeatureSubgraph: false,
      labels: [],
      name: pluginName,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishPluginResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishPluginResponse.response?.details).toBe(
      `Subgraph ${pluginName} is a plugin. Please use the 'wgc router plugin publish' command to publish the plugin.`,
    );

    await server.close();
  });

  test('that publishFederatedSubgraph fails when base subgraph does not exist', async () => {
    const { client, server } = await SetupTest({ dbname });

    const nonExistentBaseSubgraph = genID('nonExistentBase');
    const featureSubgraphName = genID('featureSubgraph');

    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName: nonExistentBaseSubgraph,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${nonExistentBaseSubgraph}" does not exist in the namespace "default".`,
    );

    await server.close();
  });

  test('that publishFederatedSubgraph fails when base subgraph exists in different namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const namespace = genID('namespace').toLowerCase();

    // Create base subgraph in default namespace
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Create different namespace
    await createNamespace(client, namespace);

    // Try to create feature subgraph in different namespace (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      namespace,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${baseSubgraphName}" does not exist in the namespace "${namespace}".`,
    );

    await server.close();
  });

  test('that publishFederatedSubgraph requires routing URL for feature subgraphs based on standard subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Try to create feature subgraph without routing URL (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      'A valid, non-empty routing URL is required to create and publish a feature subgraph.',
    );

    await server.close();
  });

  test('that publishFederatedSubgraph validates invalid routing URL for feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Try to create feature subgraph with invalid routing URL (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: 'invalid-url',
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe('Routing URL "invalid-url" is not a valid URL.');

    await server.close();
  });

  test('that publishFederatedSubgraph validates subscription URL for feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Try to create feature subgraph with invalid subscription URL (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      subscriptionUrl: 'invalid-subscription-url',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      'Subscription URL "invalid-subscription-url" is not a valid URL',
    );

    await server.close();
  });

  test('that publishFederatedSubgraph validates graph name for feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const invalidFeatureSubgraphName = 'invalid name with spaces';

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Try to create feature subgraph with invalid name (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: invalidFeatureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      "The name of the subgraph is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.",
    );

    await server.close();
  });

  test('that publishFederatedSubgraph handles invalid schema validation', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Try to publish feature subgraph with invalid schema (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'invalid schema syntax {{{',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA);

    await server.close();
  });

  test('that publishFederatedSubgraph handles authorization for feature subgraphs', async () => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Change to a user without proper permissions
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'subgraph-viewer' })),
    });

    // Try to publish feature subgraph - should fail due to authorization (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('that publishFederatedSubgraph successfully creates feature subgraph with subscription URL and protocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Create feature subgraph with valid subscription URL and protocol (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String } type Subscription { messageAdded: String }',
      subscriptionProtocol: 0, // GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_WS
      subscriptionUrl: 'wss://api.example.com/subscriptions',
      websocketSubprotocol: 0, // GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_GRAPHQL_WS
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph was created with subscription URL
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.subscriptionUrl).toBe('wss://api.example.com/subscriptions');

    await server.close();
  });

  test('that publishFederatedSubgraph works with disableResolvabilityValidation flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');

    // Create a standard base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Create feature subgraph with disableResolvabilityValidation enabled (replicating CLI call)
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName,
      disableResolvabilityValidation: true,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD,
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

    test('that publishFederatedSubgraph works with namespace parameter', async () => {
      const { client, server } = await SetupTest({ dbname });

      const baseSubgraphName = genID('baseSubgraph');
      const featureSubgraphName = genID('featureSubgraph');
      const namespace = genID('namespace').toLowerCase();

      // Create namespace
      await createNamespace(client, namespace);

      // Create base subgraph in the namespace
      await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, namespace);

      // Create feature subgraph in the same namespace (replicating CLI call)
      const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
        baseSubgraphName,
        disableResolvabilityValidation: false,
        isFeatureSubgraph: true,
        labels: [],
        name: featureSubgraphName,
        namespace,
        routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
        schema: 'type Query { hello: String }',
        type: SubgraphType.STANDARD,
      });

      expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Verify the feature subgraph was created in the correct namespace
      const getFeatureSubgraphResponse = await client.getSubgraphByName({
        name: featureSubgraphName,
        namespace,
      });
      expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(getFeatureSubgraphResponse.graph?.namespace).toBe(namespace);

      await server.close();
    });

  test('that creating and publishing a feature subgraph in one step fails when base subgraph is a grpc service - replicating fs publish command', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseGrpcServiceName = genID('baseGrpcService');
    const featureSubgraphName = genID('featureSubgraph');
    const grpcServiceLabel = genUniqueLabel('grpc-service');

    // Create a GRPC service base subgraph
    const createBaseGrpcServiceResponse = await client.createFederatedSubgraph({
      name: baseGrpcServiceName,
      type: SubgraphType.GRPC_SERVICE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [grpcServiceLabel],
    });
    expect(createBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the base subgraph is GRPC_SERVICE type
    const getBaseSubgraphResponse = await client.getSubgraphByName({
      name: baseGrpcServiceName,
    });
    expect(getBaseSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBaseSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);

    // Try to create and publish feature subgraph in one command - replicating CLI `wgc feature-subgraph publish` call
    // This should fail because the base subgraph is a GRPC service and the feature subgraph doesn't exist yet
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      baseSubgraphName: baseGrpcServiceName, // This triggers creation of feature subgraph
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName, // Feature subgraph doesn't exist yet
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD, // This is what the CLI passes regardless of base type
    });

    // Should fail with specific error about GRPC services
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      `Cannot create a feature subgraph with a grpc service base subgraph using this command. Since the base subgraph "${baseGrpcServiceName}" is a grpc service, please use the 'wgc feature-subgraph create' command to create the feature subgraph first, then publish it using the 'wgc grpc-service publish' command.`,
    );

    // Verify the feature subgraph was NOT created
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('that a feature subgraph cannot be published with a GRPC service base subgraph using wgc fs publish after creation', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseGrpcServiceName = genID('baseGrpcService');
    const featureSubgraphName = genID('featureSubgraph');
    const grpcServiceLabel = genUniqueLabel('grpc-service');

    // Create a GRPC service base subgraph
    const createBaseGrpcServiceResponse = await client.createFederatedSubgraph({
      name: baseGrpcServiceName,
      type: SubgraphType.GRPC_SERVICE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [grpcServiceLabel],
    });
    expect(createBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create feature subgraph based on GRPC service (replicating wgc feature-subgraph create)
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      labels: [],
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to publish the feature subgraph using wgc fs publish - should fail
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      disableResolvabilityValidation: false,
      isFeatureSubgraph: true,
      labels: [],
      name: featureSubgraphName,
      schema: 'type Query { hello: String }',
      type: SubgraphType.STANDARD, // This is what wgc fs publish uses
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      `Subgraph ${featureSubgraphName} is a grpc service. Please use the 'wgc grpc-service publish' command to publish the grpc service.`,
    );

    await server.close();
  });

  test('that a feature subgraph can be created and published inheriting GRPC_SERVICE type from base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseGrpcServiceName = genID('baseGrpcService');
    const featureSubgraphName = genID('featureGrpcService');
    const grpcServiceLabel = genUniqueLabel('grpc-service');

    // Create a gRPC service base subgraph
    const createBaseGrpcServiceResponse = await client.createFederatedSubgraph({
      name: baseGrpcServiceName,
      type: SubgraphType.GRPC_SERVICE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [grpcServiceLabel],
    });
    expect(createBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the base subgraph is GRPC_SERVICE type
    const getBaseSubgraphResponse = await client.getSubgraphByName({
      name: baseGrpcServiceName,
    });
    expect(getBaseSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBaseSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);

    // Create feature subgraph based on GRPC service (replicating wgc feature-subgraph create)
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      labels: [],
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish feature subgraph in one command - replicating CLI call
    const validGrpcProtoRequest = {
      schema: grpcProtoSchema,
      mappings: grpcProtoMappings,
      lock: grpcProtoLock,
    };

    // replicating wgc grpc-service publish
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      schema: 'type Query { grpcServiceHello: String }',
      proto: validGrpcProtoRequest,
      type: SubgraphType.GRPC_SERVICE,
    });
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph was created and inherited the GRPC_SERVICE type
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);

    await server.close();
  });

  test('that multiple feature subgraphs can be created and published from the same gRPC service base', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseGrpcServiceName = genID('baseGrpcService');
    const featureSubgraphName1 = genID('featureGrpcService1');
    const featureSubgraphName2 = genID('featureGrpcService2');
    const grpcServiceLabel = genUniqueLabel('grpc-service');

    // Create a gRPC service base subgraph
    const createBaseGrpcServiceResponse = await client.createFederatedSubgraph({
      name: baseGrpcServiceName,
      type: SubgraphType.GRPC_SERVICE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [grpcServiceLabel],
    });
    expect(createBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    const validGrpcProtoRequest = {
      schema: grpcProtoSchema,
      mappings: grpcProtoMappings,
      lock: grpcProtoLock,
    };

    // Create feature subgraph based on GRPC service (replicating wgc feature-subgraph create)
    const createFeatureSubgraph1Response = await client.createFederatedSubgraph({
      name: featureSubgraphName1,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      labels: [],
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);

    // replicating wgc grpc-service publish
    const publishFeatureSubgraph1Response = await client.publishFederatedSubgraph({
      name: featureSubgraphName1,
      schema: 'type Query { hello1: String }',
      proto: validGrpcProtoRequest,
      type: SubgraphType.GRPC_SERVICE,
    });
    expect(publishFeatureSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);

    // Create feature subgraph based on GRPC service (replicating wgc feature-subgraph create)
    const createFeatureSubgraph2Response = await client.createFederatedSubgraph({
      name: featureSubgraphName2,
      routingUrl: 'http://localhost:4003',
      labels: [],
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);

    // Create second feature subgraph (replicating CLI call)
    const publishFeatureSubgraph2Response = await client.publishFederatedSubgraph({
      name: featureSubgraphName2,
      schema: 'type Query { hello2: String }',
      type: SubgraphType.GRPC_SERVICE,
      proto: validGrpcProtoRequest,
    });
    expect(publishFeatureSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);

    // Verify both feature subgraphs were created with correct type
    const getFeatureSubgraph1Response = await client.getSubgraphByName({
      name: featureSubgraphName1,
    });
    expect(getFeatureSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraph1Response.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
    expect(getFeatureSubgraph1Response.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraph1Response.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);

    const getFeatureSubgraph2Response = await client.getSubgraphByName({
      name: featureSubgraphName2,
    });
    expect(getFeatureSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraph2Response.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
    expect(getFeatureSubgraph2Response.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraph2Response.graph?.routingURL).toBe('http://localhost:4003');

    await server.close();
  });

  test('that publishFederatedSubgraph fails to publish gRPC service feature subgraph without required proto information', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseGrpcServiceName = genID('baseGrpcService');
    const featureSubgraphName = genID('featureGrpcService');
    const grpcServiceLabel = genUniqueLabel('grpc-service');

    // Create a gRPC service base subgraph
    const createBaseGrpcServiceResponse = await client.createFederatedSubgraph({
      name: baseGrpcServiceName,
      type: SubgraphType.GRPC_SERVICE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [grpcServiceLabel],
    });
    expect(createBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create feature subgraph based on GRPC service (replicating wgc feature-subgraph create)
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      labels: [],
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to publish feature subgraph without proto information
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      schema: 'type Query { hello: String }',
      type: SubgraphType.GRPC_SERVICE,
      // Note: proto is missing - should fail
    });

    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFeatureSubgraphResponse.response?.details).toBe(
      'The proto is required for plugin and grpc subgraphs.',
    );

    await server.close();
  });
});
