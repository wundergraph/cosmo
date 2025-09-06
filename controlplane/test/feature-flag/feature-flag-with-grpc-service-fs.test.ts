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
  toggleFeatureFlag,
} from '../test-util.js';

// Read the actual proto, mapping and lock files for gRPC service
const testDataPath = path.join(process.cwd(), 'test/test-data/grpc-service');
const grpcServiceSchema = readFileSync(path.join(testDataPath, 'service.proto'), 'utf8');
const grpcServiceMappings = readFileSync(path.join(testDataPath, 'mapping.json'), 'utf8');
const grpcServiceLock = readFileSync(path.join(testDataPath, 'service.proto.lock.json'), 'utf8');

let dbname = '';

describe('Feature flag with gRPC service feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be created with a feature subgraph based on a gRPC service subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
    });

    // Generate unique names and labels
    const regularSubgraphName = genID('regular-subgraph');
    const grpcServiceSubgraphName = genID('grpc-service-subgraph');
    const featureSubgraphName = genID('feature-subgraph');
    const fedGraphName = genID('fed-graph');
    const featureFlagName = genID('feature-flag');
    const sharedLabel = genUniqueLabel('shared');

    // Step 1: Create and publish a regular subgraph
    const regularSubgraphSDL = `
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

    // Step 2: Create a gRPC service subgraph
    const createGrpcServiceResponse = await client.createFederatedSubgraph({
      name: grpcServiceSubgraphName,
      namespace: 'default',
      type: SubgraphType.GRPC_SERVICE,
      labels: [sharedLabel],
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO, // gRPC services need routing URLs
    });
    expect(createGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Step 3: Publish the gRPC service subgraph
    const grpcServiceSDL = `
      type Query {
        users: [User!]!
        user(id: ID!): User
      }

      type Mutation {
        createUser(user: UserInput!): User
        updateUser(id: ID!, user: UserInput!): User
      }
      
      type User {
        id: ID!
        name: String!
        email: String!
        phone: String
        status: UserStatus!
        bio: String
        tags: [String!]!
      }

      input UserInput {
        name: String!
        email: String!
        phone: String
        status: UserStatus!
        bio: String
      }

      enum UserStatus {
        ACTIVE
        INACTIVE
        SUSPENDED
      }
    `;

    const validProtoRequest = {
      schema: grpcServiceSchema,
      mappings: grpcServiceMappings,
      lock: grpcServiceLock,
    };

    const publishGrpcServiceResponse = await client.publishFederatedSubgraph({
      name: grpcServiceSubgraphName,
      namespace: 'default',
      schema: grpcServiceSDL,
      type: SubgraphType.GRPC_SERVICE,
      proto: validProtoRequest,
    });
    expect(publishGrpcServiceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify gRPC service subgraph was published successfully
    const getGrpcServiceSubgraphResponse = await client.getSubgraphByName({
      name: grpcServiceSubgraphName,
    });
    expect(getGrpcServiceSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getGrpcServiceSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
    expect(getGrpcServiceSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);

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
    expect(subgraphNames).toContain(grpcServiceSubgraphName);

    // Step 5: Create a feature subgraph with the gRPC service subgraph as the base
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: grpcServiceSubgraphName,
      labels: [sharedLabel],
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO, // Feature subgraphs based on gRPC services need routing URLs
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Step 6: Publish the feature subgraph
    const featureSubgraphSDL = `
      type Query {
        users: [User!]!
        user(id: ID!): User
        usersByStatus(status: UserStatus!): [User!]!
      }

      type Mutation {
        createUser(user: UserInput!): User
        updateUser(id: ID!, user: UserInput!): User
      }
      
      type User {
        id: ID!
        name: String!
        email: String!
        phone: String
        status: UserStatus!
        bio: String
        tags: [String!]!
        createdAt: String
        updatedAt: String
      }

      input UserInput {
        name: String!
        email: String!
        phone: String
        status: UserStatus!
        bio: String
      }

      enum UserStatus {
        ACTIVE
        INACTIVE
        SUSPENDED
      }
    `;

    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      schema: featureSubgraphSDL,
      type: SubgraphType.GRPC_SERVICE,
      proto: validProtoRequest, // gRPC service feature subgraphs also need proto data
    });
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify feature subgraph was created and inherited gRPC service type
    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });
    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);
    expect(getFeatureSubgraphResponse.graph?.type).toBe(SubgraphType.GRPC_SERVICE);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);

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
