import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createFederatedGraph,
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

// Helper function to enable proposals for namespace
async function enableProposalsForNamespace(client, namespace = DEFAULT_NAMESPACE) {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });

  return enableResponse;
}

describe('Create proposal tests', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('should successfully create a new proposal for a federated graph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with a single subgraph
    const subgraphName = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const subgraphSchemaSDL = `
      type Query {
        hello: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Create a proposal with a schema change to the subgraph
    const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.proposalId).toBeDefined();
    expect(createProposalResponse.checkId).toBeDefined();

    // Verify proposal was created
    const proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(proposalResponse.proposal?.name).toBe(proposalName);
    expect(proposalResponse.proposal?.federatedGraphName).toBe(fedGraphName);
    expect(proposalResponse.proposal?.state).toBe('DRAFT');
    expect(proposalResponse.proposal?.subgraphs.length).toBe(1);
    expect(proposalResponse.proposal?.subgraphs[0].name).toBe(subgraphName);
    expect(proposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(updatedSubgraphSDL);
    expect(proposalResponse.proposal?.subgraphs[0].isDeleted).toBe(false);

    await server.close();
  });

  test('should create a proposal with multiple subgraph changes', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with multiple subgraphs
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const subgraph1SchemaSDL = `
      type Query {
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
      }
    `;

    const subgraph2SchemaSDL = `
      type Query {
        orders: [Order!]!
      }
      
      type Order {
        id: ID!
        productId: ID!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Create proposal with changes to both subgraphs
    const updatedSubgraph1SDL = `
      type Query {
        products: [Product!]!
        product(id: ID!): Product
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
      }
    `;

    const updatedSubgraph2SDL = `
      type Query {
        orders: [Order!]!
        order(id: ID!): Order
      }
      
      type Order {
        id: ID!
        productId: ID!
        quantity: Int!
      }
    `;

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
        },
        {
          name: subgraph2Name,
          schemaSDL: updatedSubgraph2SDL,
          isDeleted: false,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.proposalId).toBeDefined();

    // Verify proposal was created
    const proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(proposalResponse.proposal?.subgraphs.length).toBe(2);

    // Check if both subgraph changes are in the proposal
    const subgraph1Change = proposalResponse.proposal?.subgraphs.find((sg) => sg.name === subgraph1Name);
    const subgraph2Change = proposalResponse.proposal?.subgraphs.find((sg) => sg.name === subgraph2Name);

    expect(subgraph1Change).toBeDefined();
    expect(subgraph2Change).toBeDefined();
    expect(subgraph1Change?.schemaSDL).toBe(updatedSubgraph1SDL);
    expect(subgraph2Change?.schemaSDL).toBe(updatedSubgraph2SDL);

    await server.close();
  });

  test('should create a proposal that adds a new subgraph to a federated graph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with a single subgraph
    const existingSubgraphName = genID('subgraph1');
    const newSubgraphName = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const existingSubgraphSDL = `
      type Query {
        users: [User!]!
      }
      
      type User {
        id: ID!
        name: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      existingSubgraphName,
      DEFAULT_NAMESPACE,
      existingSubgraphSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Create a proposal that adds a new subgraph
    const newSubgraphSDL = `
      type Query {
        posts: [Post!]!
      }
      
      type Post {
        id: ID!
        userId: ID!
        title: String!
        content: String!
      }
    `;

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: newSubgraphName,
          schemaSDL: newSubgraphSDL,
          isDeleted: false,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify proposal was created
    const proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(proposalResponse.proposal?.subgraphs.length).toBe(1);
    expect(proposalResponse.proposal?.subgraphs[0].name).toBe(newSubgraphName);
    expect(proposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(newSubgraphSDL);

    await server.close();
  });

  test('should create a proposal that removes a subgraph from a federated graph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with multiple subgraphs
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const subgraph1SchemaSDL = `
      type Query {
        users: [User!]!
      }
      
      type User {
        id: ID!
        name: String!
      }
    `;

    const subgraph2SchemaSDL = `
      type Query {
        settings: [Setting!]!
      }
      
      type Setting {
        id: ID!
        key: String!
        value: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Create a proposal that removes subgraph2
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraph2Name,
          schemaSDL: subgraph2SchemaSDL,
          isDeleted: true,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify proposal was created
    const proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(proposalResponse.proposal?.subgraphs.length).toBe(1);
    expect(proposalResponse.proposal?.subgraphs[0].name).toBe(subgraph2Name);
    expect(proposalResponse.proposal?.subgraphs[0].isDeleted).toBe(true);

    await server.close();
  });

  test('should fail to create a proposal for a non-existent federated graph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    const nonExistentFedGraphName = genID('nonExistentFedGraph');
    const proposalName = genID('proposal');

    const createProposalResponse = await client.createProposal({
      federatedGraphName: nonExistentFedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: 'testSubgraph',
          schemaSDL: 'type Query { test: String! }',
          isDeleted: false,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(createProposalResponse.response?.details).toContain(`Federated graph ${nonExistentFedGraphName} not found`);

    await server.close();
  });

  test('should create a proposal with a mix of adding, updating, and removing subgraphs', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with multiple subgraphs
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const newSubgraphName = genID('subgraph3');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const subgraph1SchemaSDL = `
      type Query {
        users: [User!]!
      }
      
      type User {
        id: ID!
        name: String!
      }
    `;

    const subgraph2SchemaSDL = `
      type Query {
        settings: [Setting!]!
      }
      
      type Setting {
        id: ID!
        key: String!
        value: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Create a proposal that:
    // 1. Updates subgraph1
    // 2. Removes subgraph2
    // 3. Adds a new subgraph
    const updatedSubgraph1SDL = `
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

    const newSubgraphSDL = `
      type Query {
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
      }
    `;

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
        },
        {
          name: subgraph2Name,
          schemaSDL: subgraph2SchemaSDL,
          isDeleted: true,
        },
        {
          name: newSubgraphName,
          schemaSDL: newSubgraphSDL,
          isDeleted: false,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify proposal was created
    const proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(proposalResponse.proposal?.subgraphs.length).toBe(3);

    // Check individual subgraph changes
    const subgraph1Change = proposalResponse.proposal?.subgraphs.find((sg) => sg.name === subgraph1Name);
    const subgraph2Change = proposalResponse.proposal?.subgraphs.find((sg) => sg.name === subgraph2Name);
    const newSubgraphChange = proposalResponse.proposal?.subgraphs.find((sg) => sg.name === newSubgraphName);

    expect(subgraph1Change).toBeDefined();
    expect(subgraph2Change).toBeDefined();
    expect(newSubgraphChange).toBeDefined();

    expect(subgraph1Change?.schemaSDL).toBe(updatedSubgraph1SDL);
    expect(subgraph1Change?.isDeleted).toBe(false);

    expect(subgraph2Change?.isDeleted).toBe(true);

    expect(newSubgraphChange?.schemaSDL).toBe(newSubgraphSDL);
    expect(newSubgraphChange?.isDeleted).toBe(false);

    await server.close();
  });

  test('should fail to enable proposals with developer billing plan', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'developer@1' },
    });

    // Try to enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(enableResponse.response?.details).toContain('Upgrade to a scale plan to enable proposals');

    await server.close();
  });

  test('should fail to enable proposals with launch billing plan', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'launch@1' },
    });

    // Try to enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(enableResponse.response?.details).toContain('Upgrade to a scale plan to enable proposals');

    await server.close();
  });

  test('should fail to create a proposal when proposals are not enabled for namespace', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Don't enable proposals for the namespace

    // Setup test data
    const subgraphName = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const proposalName = genID('proposal');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = `
      type Query {
        hello: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Try to create a proposal without enabling proposals for the namespace
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: `
            type Query {
              hello: String!
              newField: Int!
            }
          `,
          isDeleted: false,
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createProposalResponse.response?.details).toContain('Proposals are not enabled for namespace');

    await server.close();
  });
});
