import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
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
async function enableProposalsForNamespace(client: any, namespace = DEFAULT_NAMESPACE) {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });

  return enableResponse;
}

// Helper function to create a proposal
async function createTestProposal(
  client: any,
  options: {
    federatedGraphName: string;
    proposalName: string;
    subgraphName: string;
    subgraphSchemaSDL: string;
    updatedSubgraphSDL: string;
  },
) {
  const { federatedGraphName, proposalName, subgraphName, subgraphSchemaSDL, updatedSubgraphSDL } = options;

  const createProposalResponse = await client.createProposal({
    federatedGraphName,
    namespace: DEFAULT_NAMESPACE,
    name: proposalName,
    subgraphs: [
      {
        name: subgraphName,
        schemaSDL: updatedSubgraphSDL,
        isDeleted: false,
        isNew: false,
        labels: [],
      },
    ],
    didHubCreate: false,
  });

  return createProposalResponse;
}

describe('Update proposal tests', () => {
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

  test('should update proposal state from DRAFT to APPROVED', async () => {
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

    const createProposalResponse = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
      subgraphSchemaSDL,
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the proposal state to APPROVED
    const updateProposalResponse = await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the updated proposal state
    const getProposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(getProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposalResponse.proposal?.state).toBe('APPROVED');

    await server.close();
  });

  test('should update proposal state from DRAFT to CLOSED', async () => {
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

    // Create a proposal
    const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const createProposalResponse = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
      subgraphSchemaSDL,
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the proposal state to REJECTED
    const updateProposalResponse = await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'CLOSED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the updated proposal state
    const getProposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(getProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposalResponse.proposal?.state).toBe('CLOSED');

    await server.close();
  });

  test('should update proposal schema changes', async () => {
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

    // Create initial proposal
    const initialUpdatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const createProposalResponse = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
      subgraphSchemaSDL,
      updatedSubgraphSDL: initialUpdatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the proposal with new schema changes
    const furtherUpdatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
        anotherField: Boolean!
      }
    `;

    const updateProposalResponse = await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphName,
              schemaSDL: furtherUpdatedSubgraphSDL,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the updated proposal schema
    const getProposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(getProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposalResponse.proposal?.subgraphs.length).toBe(1);
    expect(getProposalResponse.proposal?.subgraphs[0].name).toBe(subgraphName);
    expect(getProposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(furtherUpdatedSubgraphSDL);

    await server.close();
  });

  test('should handle adding subgraphs to an existing proposal', async () => {
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
        posts: [Post!]!
      }
      
      type Post {
        id: ID!
        title: String!
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

    // Create a proposal that initially only updates subgraph1
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

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the proposal to also modify subgraph2
    const updatedSubgraph2SDL = `
      type Query {
        posts: [Post!]!
        post(id: ID!): Post
      }
      
      type Post {
        id: ID!
        title: String!
        content: String!
      }
    `;

    const updateProposalResponse = await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraph1Name,
              schemaSDL: updatedSubgraph1SDL,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
            {
              name: subgraph2Name,
              schemaSDL: updatedSubgraph2SDL,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the updated proposal includes both subgraphs
    const getProposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(getProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposalResponse.proposal?.subgraphs.length).toBe(2);

    const subgraph1 = getProposalResponse.proposal?.subgraphs.find((sg) => sg.name === subgraph1Name);
    const subgraph2 = getProposalResponse.proposal?.subgraphs.find((sg) => sg.name === subgraph2Name);

    expect(subgraph1).toBeDefined();
    expect(subgraph2).toBeDefined();
    expect(subgraph1?.schemaSDL).toBe(updatedSubgraph1SDL);
    expect(subgraph2?.schemaSDL).toBe(updatedSubgraph2SDL);

    await server.close();
  });

  test('should handle removing subgraphs from an existing proposal', async () => {
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
        posts: [Post!]!
      }
      
      type Post {
        id: ID!
        title: String!
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

    // Create a proposal that updates both subgraphs
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

    const updatedSubgraph2SDL = `
      type Query {
        posts: [Post!]!
        post(id: ID!): Post
      }
      
      type Post {
        id: ID!
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
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
          isNew: false,
        },
        {
          name: subgraph2Name,
          schemaSDL: updatedSubgraph2SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the proposal to only include subgraph1 changes
    const updateProposalResponse = await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraph1Name,
              schemaSDL: updatedSubgraph1SDL,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify the updated proposal only includes subgraph1
    const getProposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(getProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposalResponse.proposal?.subgraphs.length).toBe(1);
    expect(getProposalResponse.proposal?.subgraphs[0].name).toBe(subgraph1Name);
    expect(getProposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(updatedSubgraph1SDL);

    await server.close();
  });

  test('should fail to update a non-existent proposal', async () => {
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
    const nonExistentProposalName = genID('nonExistentProposal');

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

    // Attempt to update a non-existent proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: nonExistentProposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateProposalResponse.response?.details).toContain(`Proposal ${nonExistentProposalName} not found`);

    await server.close();
  });

  test('should fetch proposal checks after updating a proposal', async () => {
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

    // Create initial proposal
    const initialUpdatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const createProposalResponse = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
      subgraphSchemaSDL,
      updatedSubgraphSDL: initialUpdatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.checkId).toBeDefined();

    // Update the proposal with new schema changes
    const furtherUpdatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
        anotherField: Boolean!
      }
    `;

    const updateProposalResponse = await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphName,
              schemaSDL: furtherUpdatedSubgraphSDL,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(updateProposalResponse.checkId).toBeDefined();

    // Fetch checks for the proposal
    const checksResponse = await client.getChecksOfProposal({
      proposalId: createProposalResponse.proposalId,
      limit: 10,
      offset: 0,
    });

    expect(checksResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResponse.checks.length).toBe(2); // Two checks: initial and update
    expect(checksResponse.checks[0].id).toBe(updateProposalResponse.checkId); // Most recent first
    expect(checksResponse.checks[1].id).toBe(createProposalResponse.checkId);

    await server.close();
  });

  test('should successfully transition proposal through the full lifecycle', async () => {
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

    // 1. Create the proposal (in DRAFT state)
    const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const createProposalResponse = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
      subgraphSchemaSDL,
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify initial state
    let proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('DRAFT');

    // 2. Update the proposal schema
    const enhancedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
        enhancedField: String
      }
    `;

    await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphName,
              schemaSDL: enhancedSubgraphSDL,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });

    // 3. Update the proposal state to APPROVED
    await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Verify APPROVED state
    proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('APPROVED');
    expect(proposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(enhancedSubgraphSDL);

    // 4. Get all proposals for the federated graph
    const allProposalsResponse = await client.getProposalsOfFederatedGraph({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(allProposalsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(allProposalsResponse.proposals.length).toBe(1);
    expect(allProposalsResponse.proposals[0].id).toBe(createProposalResponse.proposalId);
    expect(allProposalsResponse.proposals[0].state).toBe('APPROVED');

    await server.close();
  });

  test('should change proposal state to PUBLISHED when all subgraphs have their schema published', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with two subgraphs
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
        posts: [Post!]!
      }
      
      type Post {
        id: ID!
        title: String!
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

    // Create a proposal that updates both subgraphs
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

    const updatedSubgraph2SDL = `
      type Query {
        posts: [Post!]!
        post(id: ID!): Post
      }
      
      type Post {
        id: ID!
        title: String!
        content: String!
      }
    `;

    // Create proposal
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
        {
          name: subgraph2Name,
          schemaSDL: updatedSubgraph2SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Verify proposal is in APPROVED state
    let proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('APPROVED');

    // Publish first subgraph schema (simulating the actual publishing)
    await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraph1SDL,
    });

    // Check if proposal state is still APPROVED (not all subgraphs are published)
    proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('APPROVED');

    // Publish second subgraph schema
    await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraph2SDL,
    });

    // Verify proposal state is now PUBLISHED
    proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('PUBLISHED');

    await server.close();
  });

  test('should change proposal state to PUBLISHED when a subgraph proposed for deletion is deleted', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with two subgraphs
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
        posts: [Post!]!
      }
      
      type Post {
        id: ID!
        title: String!
      }
    `;

    // Create and publish both subgraphs
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

    // Create a proposal that modifies subgraph1 and deletes subgraph2
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

    // Create proposal with one subgraph update and one subgraph deletion
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
        {
          name: subgraph2Name,
          schemaSDL: subgraph2SchemaSDL,
          isDeleted: true, // Mark this subgraph for deletion
          isNew: false,
          labels: [],
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Verify proposal is in APPROVED state
    let proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('APPROVED');

    // Publish first subgraph schema with updates
    await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraph1SDL,
    });

    // Check if proposal state is still APPROVED (not all subgraphs are processed)
    proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('APPROVED');

    // Delete the second subgraph
    const deleteSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify proposal state is now PUBLISHED
    proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('PUBLISHED');

    await server.close();
  });

  test('should change proposal state to PUBLISHED when a newly added subgraph is published', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
    });

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup a federated graph with one existing subgraph
    const existingSubgraphName = genID('existing-subgraph');
    const newSubgraphName = genID('new-subgraph'); // This subgraph doesn't exist yet
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const existingSubgraphSchemaSDL = `
      type Query {
        users: [User!]!
      }
      
      type User {
        id: ID!
        name: String!
      }
    `;

    // Create and publish the existing subgraph
    await createThenPublishSubgraph(
      client,
      existingSubgraphName,
      DEFAULT_NAMESPACE,
      existingSubgraphSchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Define the schema for the new subgraph that doesn't exist yet
    const newSubgraphSchemaSDL = `
      type Query {
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
      }
    `;

    // Create a proposal that includes the new subgraph
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
        {
          name: newSubgraphName,
          schemaSDL: newSubgraphSchemaSDL,
          isDeleted: false,
          isNew: true,
          labels: [label],
        },
      ],
      didHubCreate: false,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    await client.updateProposal({
      proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Verify proposal is in APPROVED state
    let proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('APPROVED');

    // Publish the new subgraph
    const publishSubgraphResponse = await client.publishFederatedSubgraph({
      name: newSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: newSubgraphSchemaSDL,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      labels: [label],
    });

    expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(publishSubgraphResponse.proposalMatchMessage).toBeUndefined();

    // Verify proposal state is now PUBLISHED
    proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });
    expect(proposalResponse.proposal?.state).toBe('PUBLISHED');

    await server.close();
  });
});
