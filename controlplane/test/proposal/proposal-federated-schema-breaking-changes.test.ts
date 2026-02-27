import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ProposalNamingConvention, ProposalOrigin } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, Mock } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

async function enableProposalsForNamespace(client: any, namespace = DEFAULT_NAMESPACE) {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });
  return enableResponse;
}

describe('Proposal federated graph schema breaking changes', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should detect federated graph breaking change when proposal adds subgraph with nullable field that conflicts with existing required field', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphAName = genID('subgraphA');
    const subgraphBName = genID('subgraphB');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Subgraph A has a shared type with a required field
    const subgraphASchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Subgraph B will add the same field as nullable (causing federated schema breaking change)
    const subgraphBSchema = `
      type User @key(fields: "id") {
        id: ID!
        name: String
        email: String!
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish subgraph A
    await createThenPublishSubgraph(
      client,
      subgraphAName,
      DEFAULT_NAMESPACE,
      subgraphASchema,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Verify the federated graph has the required field
    const fedGraphSDLBefore = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(fedGraphSDLBefore.response?.code).toBe(EnumStatusCode.OK);
    expect(fedGraphSDLBefore.sdl).toContain('name: String!');

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal that adds a new subgraph with nullable field
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphBName,
          schemaSDL: subgraphBSchema,
          isDeleted: false,
          isNew: true,
          labels: [label],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary to verify federated graph breaking changes
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary.affectedGraphs.length).toBe(1);

    // The composed schema breaking changes should detect the nullability change
    expect(checkSummary.composedSchemaBreakingChanges.length).toBe(1);

    // Verify the federated graph name is included
    const fedGraphChange = checkSummary.composedSchemaBreakingChanges.find(
      (c) => c.federatedGraphName === fedGraphName,
    );
    expect(fedGraphChange).toBeDefined();

    await server.close();
  });

  test('Should detect federated graph breaking change when proposal updates multiple subgraphs causing field nullability conflict', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphAName = genID('subgraphA');
    const subgraphBName = genID('subgraphB');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Subgraph A has a shared type with a required field
    const subgraphASchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Subgraph B initially has the field as required too
    const subgraphBSchemaInitial = `
      type User @key(fields: "id") {
        id: ID!
        name: String!
        email: String!
      }
    `;

    // Updated subgraph B will make the field nullable
    const subgraphBSchemaUpdated = `
      type User @key(fields: "id") {
        id: ID!
        name: String
        email: String!
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish both subgraphs
    await createThenPublishSubgraph(
      client,
      subgraphAName,
      DEFAULT_NAMESPACE,
      subgraphASchema,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishSubgraph(
      client,
      subgraphBName,
      DEFAULT_NAMESPACE,
      subgraphBSchemaInitial,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Verify the federated graph has the required field
    const fedGraphSDLBefore = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(fedGraphSDLBefore.response?.code).toBe(EnumStatusCode.OK);
    expect(fedGraphSDLBefore.sdl).toContain('name: String!');

    // Enable proposals
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal that updates subgraph B to make field nullable
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphBName,
          schemaSDL: subgraphBSchemaUpdated,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary to verify federated graph breaking changes
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);

    // Verify breaking changes are reported at subgraph level (String! -> String is breaking)
    const subgraphBreakingChanges = checkSummary.changes.filter((c: any) => c.isBreaking);
    expect(subgraphBreakingChanges.length).toBe(1);
    expect(subgraphBreakingChanges[0].path).toBe('User.name');

    // Since the change is already reported at subgraph level, it should not be duplicated
    // at federated level
    expect(checkSummary.composedSchemaBreakingChanges.length).toBe(0);

    await server.close();
  });

  test('Should not detect federated graph breaking changes when proposal adds non-conflicting fields', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphAName = genID('subgraphA');
    const subgraphBName = genID('subgraphB');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Subgraph A schema
    const subgraphASchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Subgraph B adds completely new fields (no conflict with subgraph A)
    const subgraphBSchema = `
      type User @key(fields: "id") {
        id: ID!
        email: String!
        age: Int
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish subgraph A
    await createThenPublishSubgraph(
      client,
      subgraphAName,
      DEFAULT_NAMESPACE,
      subgraphASchema,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Enable proposals
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal that adds a new subgraph with non-conflicting fields
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphBName,
          schemaSDL: subgraphBSchema,
          isDeleted: false,
          isNew: true,
          labels: [label],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);

    // No breaking changes since we're only adding new non-conflicting fields
    expect(checkSummary.composedSchemaBreakingChanges.length).toBe(0);

    // The check should be successful
    const affectedGraph = checkSummary.affectedGraphs[0];
    expect(affectedGraph.isCheckSuccessful).toBe(true);

    await server.close();
  });

  test('Should detect breaking change at subgraph level and not duplicate at federated level when proposal removes a field', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Initial schema with email field
    const initialSchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
        email: String!
      }
    `;

    // Updated schema removes the email field
    const updatedSchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish subgraph
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      initialSchema,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Enable proposals
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal that removes the email field
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSchema,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);

    // Verify breaking changes are reported at subgraph level
    const subgraphBreakingChanges = checkSummary.changes.filter((c: any) => c.isBreaking);
    expect(subgraphBreakingChanges.length).toBe(1);
    expect(subgraphBreakingChanges[0].path).toBe('User.email');

    // Since the change is already reported at subgraph level, it should not be duplicated
    expect(checkSummary.composedSchemaBreakingChanges.length).toBe(0);

    await server.close();
  });

  test('Should detect federated graph breaking changes when proposal updates multiple subgraphs simultaneously', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphAName = genID('subgraphA');
    const subgraphBName = genID('subgraphB');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Subgraph A initial schema
    const subgraphASchemaInitial = `
      type Query {
        products: [Product!]!
      }

      type Product @key(fields: "id") {
        id: ID!
        name: String!
        price: Float!
      }
    `;

    // Subgraph B initial schema
    const subgraphBSchemaInitial = `
      type Product @key(fields: "id") {
        id: ID!
        name: String!
        description: String!
      }
    `;

    // Updated subgraph A removes price field
    const subgraphASchemaUpdated = `
      type Query {
        products: [Product!]!
      }

      type Product @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Updated subgraph B makes name nullable
    const subgraphBSchemaUpdated = `
      type Product @key(fields: "id") {
        id: ID!
        name: String
        description: String!
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish both subgraphs
    await createThenPublishSubgraph(
      client,
      subgraphAName,
      DEFAULT_NAMESPACE,
      subgraphASchemaInitial,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishSubgraph(
      client,
      subgraphBName,
      DEFAULT_NAMESPACE,
      subgraphBSchemaInitial,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Enable proposals
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal that updates both subgraphs with breaking changes
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphAName,
          schemaSDL: subgraphASchemaUpdated,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
        {
          name: subgraphBName,
          schemaSDL: subgraphBSchemaUpdated,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);

    // Verify breaking changes are reported at subgraph level
    const subgraphBreakingChanges = checkSummary.changes.filter((c: any) => c.isBreaking);
    expect(subgraphBreakingChanges.length).toBe(2);

    await server.close();
  });

  test('Should check federated graph schema changes against traffic when adding new subgraph via proposal', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphAName = genID('subgraphA');
    const subgraphBName = genID('subgraphB');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Subgraph A has a shared type with a required field
    const subgraphASchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Subgraph B will add the same field as nullable (causes federated breaking change)
    const subgraphBSchema = `
      type User @key(fields: "id") {
        id: ID!
        name: String
        email: String!
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish subgraph A only
    await createThenPublishSubgraph(
      client,
      subgraphAName,
      DEFAULT_NAMESPACE,
      subgraphASchema,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Enable proposals
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Mock traffic data - operations that use the User.name field
    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        operationHash: 'hash1',
        operationName: 'GetUsers',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
      {
        operationHash: 'hash2',
        operationName: 'GetUserName',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
    ]);

    // Create a proposal that adds a NEW subgraph B
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphBName,
          schemaSDL: subgraphBSchema,
          isDeleted: false,
          isNew: true,
          labels: [label],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);

    // Subgraph-level breaking changes should be empty (new subgraph, adding fields is non-breaking)
    const subgraphBreakingChanges = checkSummary.changes.filter((c: any) => c.isBreaking);
    expect(subgraphBreakingChanges.length).toBe(0);

    // Federated schema breaking changes should be detected (nullability change at fed level)
    expect(checkSummary.composedSchemaBreakingChanges.length).toBe(1);
    expect(checkSummary.composedSchemaBreakingChanges[0].federatedGraphName).toBe(fedGraphName);
    expect(checkSummary.composedSchemaBreakingChanges[0].path).toBe('User.name');
    expect(checkSummary.composedSchemaBreakingChanges[0].isBreaking).toBe(true);

    // Traffic should have been checked at federated graph level (even for new subgraph)
    expect(checkSummary.affectedGraphs.length).toBe(1);
    const affectedGraph = checkSummary.affectedGraphs[0];
    expect(affectedGraph.hasClientTraffic).toBe(true);

    // The check should not be successful due to federated breaking changes with client traffic
    expect(affectedGraph.isCheckSuccessful).toBe(false);

    await server.close();
  });

  test('Should not perform federated diff when subgraph changes do not involve field changes', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();
    const proposalName = genID('proposal');

    // Initial schema
    const initialSchema = `
      type Query {
        users: [User!]!
      }

      type User @key(fields: "id") {
        id: ID!
        name: String!
      }
    `;

    // Updated schema with only description changes (no field changes)
    const updatedSchema = `
      "Query type with description"
      type Query {
        "Get all users"
        users: [User!]!
      }

      "User entity"
      type User @key(fields: "id") {
        "User ID"
        id: ID!
        "User name"
        name: String!
      }
    `;

    // Create federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_ROUTER_URL,
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish subgraph
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      initialSchema,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Enable proposals
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal with only description changes
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSchema,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Fetch check summary
    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: fedGraphName,
      checkId: createProposalResponse.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);

    // No breaking changes at any level since we only changed descriptions
    expect(checkSummary.composedSchemaBreakingChanges.length).toBe(0);

    // The check should be successful
    const affectedGraph = checkSummary.affectedGraphs[0];
    expect(affectedGraph.isCheckSuccessful).toBe(true);

    await server.close();
  });
});
