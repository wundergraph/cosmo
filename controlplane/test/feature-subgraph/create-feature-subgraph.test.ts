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

describe('Create feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if a feature subgraph is created without a base graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A feature subgraph requires a base subgraph.');

    await server.close();
  });

  test('that an error is returned if the base graph does not exist in the same namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      namespace,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${subgraphName}" does not exist in the namespace "${namespace}".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created without a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const createFeatureSubgraphResp = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(createFeatureSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFeatureSubgraphResp.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as its base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponse.response?.details).toBe(
      `A subgraph with the name "${subgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as another subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const subgraphNameTwo = genID('subgraphTwo');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);
    await createSubgraph(client, subgraphNameTwo, DEFAULT_SUBGRAPH_URL_TWO);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: subgraphNameTwo,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponse.response?.details).toBe(
      `A subgraph with the name "${subgraphNameTwo}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as another feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphResponseTwo = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });
    expect(featureSubgraphResponseTwo.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponseTwo.response?.details).toBe(
      `A feature subgraph with the name "${featureSubgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that a feature subgraph can be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    await server.close();
  });

  test('that a feature subgraph with out base subgraph cannot be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureSubgraphResponseOne.response?.details).toBe(
      `Feature Subgraph ${featureSubgraphName} not found. If intended to create and publish, please pass the name of the base subgraph with --subgraph option.`,
    );

    await server.close();
  });

  test('that a feature subgraph with out a valid routing url cannot be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseOne.response?.details).toBe(
      `A valid, non-empty routing URL is required to create and publish a feature subgraph.`,
    );

    await server.close();
  });

  test('that a feature subgraph can be published even without a proposal', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup: create a base subgraph and a federated graph
    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const baseSubgraphSDL = `
      type Query {
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
      }
    `;

    // Create and publish the base subgraph
    await createThenPublishSubgraph(
      client,
      baseSubgraphName,
      'default',
      baseSubgraphSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create federated graph
    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphSDL = `
      type Query {
        products: [Product!]!
        product(id: ID!): Product
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
        description: String
      }
    `;

    // First, create the feature subgraph
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName,
      labels: [label],
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Publish the feature subgraph
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      schema: featureSubgraphSDL,
    });
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a feature subgraph inherits the STANDARD type from its base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const secondFeatureSubgraphName = genID('secondFeatureSubgraph');

    // Create a standard base subgraph (default type)
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Verify the base subgraph is STANDARD type
    const getBaseSubgraphResponse = await client.getSubgraphByName({
      name: baseSubgraphName,
    });
    expect(getBaseSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBaseSubgraphResponse.graph?.type).toBe(SubgraphType.STANDARD);

    // Create a feature subgraph
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph inherited the STANDARD type
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.STANDARD);

    await server.close();
  });

  test('that a feature subgraph inherits the PLUGIN type from its base subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const baseSubgraphName = genID('basePlugin');
    const featureSubgraphName = genID('featurePlugin');
    const pluginLabel = genUniqueLabel('plugin');

    // Create a plugin base subgraph
    const createBasePluginResponse = await client.createFederatedSubgraph({
      name: baseSubgraphName,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createBasePluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the base subgraph is PLUGIN type
    const getBaseSubgraphResponse = await client.getSubgraphByName({
      name: baseSubgraphName,
    });
    expect(getBaseSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBaseSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);

    // Create a feature subgraph based on the plugin
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph inherited the PLUGIN type
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);

    await server.close();
  });

  test('that creating a feature subgraph from a plugin base fails when plugin limit is reached', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'developer@1' }, // Developer plan allows max 3 plugins
    });

    const basePluginName = genID('basePlugin');
    const plugin1Name = genID('plugin1');
    const plugin2Name = genID('plugin2');
    const featureSubgraphName = genID('featurePlugin');
    const pluginLabel = genUniqueLabel('plugin');

    // Create the base plugin subgraph (1st plugin)
    const createBasePluginResponse = await client.createFederatedSubgraph({
      name: basePluginName,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createBasePluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create 2 more plugin subgraphs to reach the limit (2nd and 3rd plugins)
    const createPlugin1Response = await client.createFederatedSubgraph({
      name: plugin1Name,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createPlugin1Response.response?.code).toBe(EnumStatusCode.OK);

    const createPlugin2Response = await client.createFederatedSubgraph({
      name: plugin2Name,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createPlugin2Response.response?.code).toBe(EnumStatusCode.OK);

    // Now we have 3 plugins (the limit for launch plan)
    // Try to create a feature subgraph based on the plugin base - this should fail
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: basePluginName,
    });

    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
    expect(createFeatureSubgraphResponse.response?.details).toBe('The organization reached the limit of plugins');

    await server.close();
  });

  test('that a feature subgraph based on a plugin does not require a routing URL', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const basePluginName = genID('basePlugin');
    const featureSubgraphName = genID('featurePlugin');
    const pluginLabel = genUniqueLabel('plugin');

    // Create a plugin base subgraph (no routing URL required for plugins)
    const createBasePluginResponse = await client.createFederatedSubgraph({
      name: basePluginName,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createBasePluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the base plugin doesn't have a routing URL
    const getBasePluginResponse = await client.getSubgraphByName({
      name: basePluginName,
    });
    expect(getBasePluginResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBasePluginResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
    expect(getBasePluginResponse.graph?.routingURL).toBe(''); // Plugins have empty routing URL

    // Create a feature subgraph based on the plugin (no routing URL should be required)
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: basePluginName,
      // Note: No routingUrl provided - should succeed for plugin-based feature subgraphs
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph inherited the plugin properties
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(''); // Feature plugin should also have empty routing URL

    await server.close();
  });

  test('that multiple feature subgraphs can inherit the same type from their base subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const baseSubgraphName = genID('basePlugin');
    const featureSubgraphName1 = genID('featurePlugin1');
    const featureSubgraphName2 = genID('featurePlugin2');
    const pluginLabel = genUniqueLabel('plugin');

    // Create a plugin base subgraph
    const createBasePluginResponse = await client.createFederatedSubgraph({
      name: baseSubgraphName,
      type: SubgraphType.GRPC_PLUGIN,
      labels: [pluginLabel],
    });
    expect(createBasePluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create first feature subgraph
    const createFeatureSubgraph1Response = await client.createFederatedSubgraph({
      name: featureSubgraphName1,
      isFeatureSubgraph: true,
      baseSubgraphName,
    });
    expect(createFeatureSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);

    // Create second feature subgraph
    const createFeatureSubgraph2Response = await client.createFederatedSubgraph({
      name: featureSubgraphName2,
      isFeatureSubgraph: true,
      baseSubgraphName,
    });
    expect(createFeatureSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);

    // Verify both feature subgraphs inherited the PLUGIN type
    const getFeatureSubgraph1Response = await client.getSubgraphByName({
      name: featureSubgraphName1,
    });
    expect(getFeatureSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraph1Response.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
    expect(getFeatureSubgraph1Response.graph?.isFeatureSubgraph).toBe(true);

    const getFeatureSubgraph2Response = await client.getSubgraphByName({
      name: featureSubgraphName2,
    });
    expect(getFeatureSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraph2Response.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
    expect(getFeatureSubgraph2Response.graph?.isFeatureSubgraph).toBe(true);

    await server.close();
  });

  test('that a feature subgraph inherits the GRPC_SERVICE type from its base subgraph', async () => {
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

    // Create a feature subgraph based on the gRPC service
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the feature subgraph inherited the GRPC_SERVICE type
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

  test('that a feature subgraph based on a gRPC service requires a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseGrpcServiceName = genID('baseGrpcService');
    const featureSubgraphName = genID('featureGrpcService');
    const grpcServiceLabel = genUniqueLabel('grpc-service');

    // Create a gRPC service base subgraph (requires routing URL)
    const createBaseGrpcServiceResponse = await client.createFederatedSubgraph({
      name: baseGrpcServiceName,
      type: SubgraphType.GRPC_SERVICE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [grpcServiceLabel],
    });
    expect(createBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the base gRPC service has a routing URL
    const getBaseGrpcServiceResponse = await client.getSubgraphByName({
      name: baseGrpcServiceName,
    });
    expect(getBaseGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getBaseGrpcServiceResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
    expect(getBaseGrpcServiceResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_ONE);

    // Try to create a feature subgraph based on the gRPC service without routing URL - should fail
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
      // Note: No routingUrl provided - should fail for gRPC service-based feature subgraphs
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFeatureSubgraphResponse.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });

  test('that multiple feature subgraphs can inherit the GRPC_SERVICE type from their base subgraph', async () => {
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

    // Create first feature subgraph
    const createFeatureSubgraph1Response = await client.createFederatedSubgraph({
      name: featureSubgraphName1,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);

    // Create second feature subgraph
    const createFeatureSubgraph2Response = await client.createFederatedSubgraph({
      name: featureSubgraphName2,
      routingUrl: 'http://localhost:4003',
      isFeatureSubgraph: true,
      baseSubgraphName: baseGrpcServiceName,
    });
    expect(createFeatureSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);

    // Verify both feature subgraphs inherited the GRPC_SERVICE type
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

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
    '%s should be able to create feature subgraph',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });

      const subgraphName = genID('subgraph');
      const featureSubgraphName = genID('featureSubgraph');

      await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const featureSubgraphResponse = await client.createFederatedSubgraph({
        name: featureSubgraphName,
        routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
        isFeatureSubgraph: true,
        baseSubgraphName: subgraphName,
      });

      expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

      const getFeatureSubgraphResponse = await client.getSubgraphByName({
        name: featureSubgraphName,
      });

      expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
      expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
      expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

      await server.close();
    },
  );

  test('subgraph-admin should be able to crete feature subgraph only on the allowed namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const namespace = 'prod2';
    const subgraphName = genID('subgraph');
    const subgraphName2 = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const featureSubgraphName2 = genID('featureSubgraph');

    await createNamespace(client, namespace);
    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);
    await createSubgraph(client, subgraphName2, DEFAULT_SUBGRAPH_URL_ONE, namespace);

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'subgraph-admin',
          namespaces: [getNamespaceResponse.namespace!.id],
        }),
      ),
    });

    let featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    // Make sure we can't create a feature subgraph on an unauthorized namespace
    featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName2,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName2,
      namespace,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

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
  ])('%s should not be able to create feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('that an error is returned if a feature subgraph is used as a base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const secondFeatureSubgraphName = genID('secondFeatureSubgraph');

    // Create the base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Create the first feature subgraph
    const firstFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName,
    });
    expect(firstFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to create a second feature subgraph using the first feature subgraph as base
    const secondFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: secondFeatureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: featureSubgraphName,
    });

    expect(secondFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(secondFeatureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${featureSubgraphName}" is a feature subgraph. Feature subgraphs cannot have feature subgraphs as their base.`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is used as a base subgraph when publishing directly', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const secondFeatureSubgraphName = genID('secondFeatureSubgraph');

    // Create the base subgraph
    await createSubgraph(client, baseSubgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    // Create and publish the first feature subgraph
    const firstFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName,
      schema: 'type Query { hello: String }',
    });
    expect(firstFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to create and publish a second feature subgraph using the first feature subgraph as base
    const secondFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: secondFeatureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: featureSubgraphName,
      schema: 'type Query { world: String }',
    });

    expect(secondFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(secondFeatureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${featureSubgraphName}" is a feature subgraph. Feature subgraphs cannot have feature subgraphs as their base.`,
    );

    await server.close();
  });
});
