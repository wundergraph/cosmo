import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

// Read the actual proto, mapping and lock files for plugin
const testDataPath = path.join(process.cwd(), 'test/test-data/plugin');
const pluginSchema = readFileSync(path.join(testDataPath, 'service.proto'), 'utf8');
const pluginMappings = readFileSync(path.join(testDataPath, 'mapping.json'), 'utf8');
const pluginLock = readFileSync(path.join(testDataPath, 'service.proto.lock.json'), 'utf8');

let dbname = '';

describe('Feature flag with plugin feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be created with a feature subgraph based on a plugin subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' }, // Required for plugin support
    });

    // Generate unique names and labels
    const regularSubgraphName = genID('regular-subgraph');
    const pluginSubgraphName = genID('plugin-subgraph');
    const featureSubgraphName = genID('feature-subgraph');
    const fedGraphName = genID('fed-graph');
    const featureFlagName = genID('feature-flag');
    const sharedLabel = genUniqueLabel('shared');

    // Step 1: Create and publish a regular subgraph
    const regularSubgraphSDL = `
      type Query {
        users: [User!]!
        user(id: ID!): User
      }
      
      type User {
        id: ID!
        name: String!
        email: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      regularSubgraphName,
      'default',
      regularSubgraphSDL,
      [sharedLabel],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Verify regular subgraph was created successfully
    const getRegularSubgraphResponse = await client.getSubgraphByName({
      name: regularSubgraphName,
    });
    expect(getRegularSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getRegularSubgraphResponse.graph?.type).toBe(SubgraphType.STANDARD);

    // Step 2: Create a plugin subgraph
    const createPluginResponse = await client.createFederatedSubgraph({
      name: pluginSubgraphName,
      namespace: 'default',
      type: SubgraphType.GRPC_PLUGIN,
      labels: [sharedLabel],
    });
    expect(createPluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Step 3: Publish the plugin subgraph
    const pluginSDL = `
      type Query {
        projects: [Project!]!
        project(id: ID!): Project
      }
      
      type Project {
        id: ID!
        name: String!
        status: String!
        description: String
      }
    `;

    const validProtoRequest = {
      version: 'v1',
      platforms: ['linux/amd64', 'darwin/amd64'],
      schema: pluginSchema,
      mappings: pluginMappings,
      lock: pluginLock,
    };

    const publishPluginResponse = await client.publishFederatedSubgraph({
      name: pluginSubgraphName,
      namespace: 'default',
      schema: pluginSDL,
      type: SubgraphType.GRPC_PLUGIN,
      proto: validProtoRequest,
    });
    expect(publishPluginResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify plugin subgraph was published successfully
    const getPluginSubgraphResponse = await client.getSubgraphByName({
      name: pluginSubgraphName,
    });
    expect(getPluginSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getPluginSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
    expect(getPluginSubgraphResponse.graph?.pluginData?.version).toBe('v1');
    expect(getPluginSubgraphResponse.graph?.pluginData?.platforms).toEqual(['linux/amd64', 'darwin/amd64']);

    // Step 4: Create federated graph with the same labels
    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(sharedLabel)], DEFAULT_ROUTER_URL);

    // Verify federated graph was created and includes both subgraphs
    const getFedGraphResponse = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(getFedGraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFedGraphResponse.subgraphs.length).toBe(2);

    // Verify both subgraphs are included
    const subgraphNames = getFedGraphResponse.subgraphs.map((sg) => sg.name);
    expect(subgraphNames).toContain(regularSubgraphName);
    expect(subgraphNames).toContain(pluginSubgraphName);

    // Step 5: Create a feature subgraph with the plugin subgraph as the base
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: pluginSubgraphName,
      labels: [sharedLabel],
      // Note: No routingUrl needed for plugin-based feature subgraphs
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Step 6: Publish the feature subgraph
    const featureSubgraphSDL = `
      type Query {
        projects: [Project!]!
        project(id: ID!): Project
        projectsByStatus(status: String!): [Project!]!
      }
      
      type Project {
        id: ID!
        name: String!
        status: String!
        description: String
        createdAt: String
        updatedAt: String
      }
    `;

    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      schema: featureSubgraphSDL,
      type: SubgraphType.GRPC_PLUGIN,
      proto: validProtoRequest, // Plugin feature subgraphs also need proto data
    });
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify feature subgraph was created and inherited plugin type
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_PLUGIN);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(''); // Plugin feature subgraphs have empty routing URL

    // Step 7: Create a feature flag using the feature subgraph
    const createFeatureFlagResponse = await client.createFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
      labels: [sharedLabel],
      isEnabled: true,
    });
    expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify feature flag was created successfully
    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: 'default',
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureFlag?.name).toBe(featureFlagName);
    expect(getFeatureFlagResponse.featureFlag?.isEnabled).toBe(true);
    expect(getFeatureFlagResponse.featureSubgraphs?.length).toBe(1);
    expect(getFeatureFlagResponse.featureSubgraphs?.[0]?.name).toBe(featureSubgraphName);

    // Step 8: Verify the complete setup by checking federated graph composition
    const getFinalFedGraphResponse = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(getFinalFedGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // The federated graph should still have the base subgraphs
    // Feature subgraphs are not directly included in the federated graph
    expect(getFinalFedGraphResponse.subgraphs.length).toBe(2);

    await server.close();
  });
});
