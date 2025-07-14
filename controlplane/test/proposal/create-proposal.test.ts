import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ProposalNamingConvention } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
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

  test.each(['organization-admin', 'organization-developer', 'graph-admin'])(
    '%s should successfully create a new proposal for a federated graph',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({
        dbname,
        chClient,
        setupBilling: { plan: 'enterprise' },
        enabledFeatures: ['proposals'],
      });

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

      // Enable proposals for the namespace
      const enableResponse = await enableProposalsForNamespace(client);
      expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

      // Create a proposal with a schema change to the subgraph
      const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const createProposalResponse = await client.createProposal({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        name: proposalName,
        namingConvention: ProposalNamingConvention.INCREMENTAL,
        subgraphs: [
          {
            name: subgraphName,
            schemaSDL: updatedSubgraphSDL,
            isDeleted: false,
            isNew: false,
            labels: [],
          },
        ],
      });

      expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(createProposalResponse.proposalId).toBeDefined();
      expect(createProposalResponse.checkId).toBeDefined();

      // Verify proposal was created
      const proposalResponse = await client.getProposal({
        proposalId: createProposalResponse.proposalId,
      });

      expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(proposalResponse.proposal?.name).toBe(`p-1/${proposalName}`);
      expect(proposalResponse.proposal?.federatedGraphName).toBe(fedGraphName);
      expect(proposalResponse.proposal?.state).toBe('DRAFT');
      expect(proposalResponse.proposal?.subgraphs.length).toBe(1);
      expect(proposalResponse.proposal?.subgraphs[0].name).toBe(subgraphName);
      expect(proposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(updatedSubgraphSDL);
      expect(proposalResponse.proposal?.subgraphs[0].isDeleted).toBe(false);

      await server.close();
    },
  );

  test('graph-admin should successfully create a new proposal for a federated graph on allowed namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal with a schema change to the subgraph
    const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'graph-admin',
          namespaces: [getNamespaceResponse.namespace!.id],
        }),
      ),
    });

    let createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.proposalId).toBeDefined();
    expect(createProposalResponse.checkId).toBeDefined();

    // Verify proposal was created
    const proposalResponse = await client.getProposal({
      proposalId: createProposalResponse.proposalId,
    });

    expect(proposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(proposalResponse.proposal?.name).toBe(`p-1/${proposalName}`);
    expect(proposalResponse.proposal?.federatedGraphName).toBe(fedGraphName);
    expect(proposalResponse.proposal?.state).toBe('DRAFT');
    expect(proposalResponse.proposal?.subgraphs.length).toBe(1);
    expect(proposalResponse.proposal?.subgraphs[0].name).toBe(subgraphName);
    expect(proposalResponse.proposal?.subgraphs[0].schemaSDL).toBe(updatedSubgraphSDL);
    expect(proposalResponse.proposal?.subgraphs[0].isDeleted).toBe(false);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'graph-admin',
          namespaces: [randomUUID()],
        }),
      ),
    });

    createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not successfully create a new proposal for a federated graph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal with a schema change to the subgraph
    const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('should create a proposal with multiple subgraph changes', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

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
      namingConvention: ProposalNamingConvention.INCREMENTAL,
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
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

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
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: newSubgraphName,
          schemaSDL: newSubgraphSDL,
          isDeleted: false,
          labels: [label],
          isNew: true,
        },
      ],
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

    const checksResponse = await client.getProposalChecks({
      proposalId: createProposalResponse.proposalId,
    });

    expect(checksResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResponse.checks.length).toBe(1);
    expect(checksResponse.checks[0].checkedSubgraphs.length).toBe(1);
    expect(checksResponse.checks[0].checkedSubgraphs[0].subgraphName).toBe(newSubgraphName);

    await server.close();
  });

  test('should create a proposal that removes a subgraph from a federated graph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal that removes subgraph2
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraph2Name,
          schemaSDL: subgraph2SchemaSDL,
          isDeleted: true,
          isNew: false,
          labels: [],
        },
      ],
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
      enabledFeatures: ['proposals'],
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
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: 'testSubgraph',
          schemaSDL: 'type Query { test: String! }',
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
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
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

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
      namingConvention: ProposalNamingConvention.INCREMENTAL,
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
          isDeleted: true,
          isNew: false,
          labels: [],
        },
        {
          name: newSubgraphName,
          schemaSDL: newSubgraphSDL,
          isDeleted: false,
          isNew: true,
          labels: [label],
        },
      ],
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
      enabledFeatures: ['proposals'],
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
      namingConvention: ProposalNamingConvention.INCREMENTAL,
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
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createProposalResponse.response?.details).toContain('Proposals are not enabled for namespace');

    await server.close();
  });

  test('should not fail to create a proposal with the same name for the same federated graph if the client is not cli', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create first proposal
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
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.proposalId).toBeDefined();
    expect(createProposalResponse.proposalName).toBe(`p-1/${proposalName}`);

    // Try to create a second proposal with the same name for the same federated graph
    const secondProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName, // Same proposal name
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: `
            type Query {
              hello: String!
              anotherField: String!
            }
          `,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(secondProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(secondProposalResponse.proposalId).toBeDefined();
    expect(secondProposalResponse.proposalName).toBe(`p-2/${proposalName}`);

    await server.close();
  });

  test('should allow creating proposals with the same name for different federated graphs', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup common test data
    const subgraphName = genID('subgraph');
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');
    const proposalName = genID('proposal'); // Same proposal name to be used for both graphs

    const subgraphSchemaSDL = `
      type Query {
        hello: String!
      }
    `;

    // Create subgraph1 with label1 and fedGraph1
    await createThenPublishSubgraph(
      client,
      subgraphName + '1',
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraph1Name, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);

    // Create subgraph2 with label2 and fedGraph2
    await createThenPublishSubgraph(
      client,
      subgraphName + '2',
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label2],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraph2Name, DEFAULT_NAMESPACE, [joinLabel(label2)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create first proposal for fedGraph1
    const updatedSubgraphSDL1 = `
      type Query {
        hello: String!
        newField1: Int!
      }
    `;

    const createProposalResponse1 = await client.createProposal({
      federatedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName + '1',
          schemaSDL: updatedSubgraphSDL1,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse1.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse1.proposalId).toBeDefined();

    // Create second proposal with the same name but for fedGraph2
    const updatedSubgraphSDL2 = `
      type Query {
        hello: String!
        newField2: String!
      }
    `;

    const createProposalResponse2 = await client.createProposal({
      federatedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName, // Same proposal name
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName + '2',
          schemaSDL: updatedSubgraphSDL2,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    // Expect success for the second proposal as well
    expect(createProposalResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse2.proposalId).toBeDefined();

    // Verify both proposals were created successfully
    const proposal1Response = await client.getProposal({
      proposalId: createProposalResponse1.proposalId,
    });

    const proposal2Response = await client.getProposal({
      proposalId: createProposalResponse2.proposalId,
    });

    expect(proposal1Response.response?.code).toBe(EnumStatusCode.OK);
    expect(proposal2Response.response?.code).toBe(EnumStatusCode.OK);

    // Verify they have the same name but different federated graphs
    expect(proposal1Response.proposal?.name).toBe(`p-1/${proposalName}`);
    expect(proposal2Response.proposal?.name).toBe(`p-1/${proposalName}`);
    expect(proposal1Response.proposal?.federatedGraphName).toBe(fedGraph1Name);
    expect(proposal2Response.proposal?.federatedGraphName).toBe(fedGraph2Name);

    await server.close();
  });

  test('should fail to create a proposal when no subgraphs are passed', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup a federated graph
    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to create a proposal without any subgraphs
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [], // empty array
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createProposalResponse.response?.details).toContain(
      'No subgraphs provided. At least one subgraph is required to create a proposal.',
    );

    await server.close();
  });

  test('should fail to create a proposal when subgraphs are duplicated', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal with the same subgraph listed twice with different schemas
    const updatedSubgraphSDL1 = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const updatedSubgraphSDL2 = `
      type Query {
        hello: String!
        anotherField: Boolean!
      }
    `;

    // Try to create a proposal with the same subgraph appearing twice
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: subgraphName, // Same subgraph name used twice
          schemaSDL: updatedSubgraphSDL1,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
        {
          name: subgraphName, // Duplicate subgraph name
          schemaSDL: updatedSubgraphSDL2,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    // Expect an error response due to duplicate subgraphs
    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createProposalResponse.response?.details).toContain(
      `The subgraphs provided in the proposal have to be unique. Please check the names of the subgraphs and try again.`,
    );

    await server.close();
  });

  test('should fail to create a proposal with a subgraph that is both new and marked for deletion', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup a federated graph with a single subgraph
    const existingSubgraphName = genID('existing-subgraph');
    const newSubgraphName = genID('new-subgraph');
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
      existingSubgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Define a schema for the new subgraph
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

    // Try to create a proposal where the same subgraph is both new and marked for deletion
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      subgraphs: [
        {
          name: newSubgraphName,
          schemaSDL: newSubgraphSchemaSDL,
          isDeleted: false,
          isNew: true,
          labels: [label],
        },
        {
          name: newSubgraphName, // Same subgraph name
          schemaSDL: newSubgraphSchemaSDL,
          isDeleted: true, // Marked for deletion
          isNew: false, // Not marked as new in this entry
          labels: [],
        },
      ],
    });

    // Expect an error response
    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createProposalResponse.response?.details).toContain(
      `The subgraphs provided in the proposal have to be unique. Please check the names of the subgraphs and try again.`,
    );

    await server.close();
  });
});

describe('Create proposal tests with normal naming convention', () => {
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

  test.each(['organization-admin', 'organization-developer', 'graph-admin'])(
    '%s should successfully create a new proposal for a federated graph (with normal naming convention)',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({
        dbname,
        chClient,
        setupBilling: { plan: 'enterprise' },
        enabledFeatures: ['proposals'],
      });

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

      // Enable proposals for the namespace
      const enableResponse = await enableProposalsForNamespace(client);
      expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

      // Create a proposal with a schema change to the subgraph
      const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const createProposalResponse = await client.createProposal({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        name: proposalName,
        namingConvention: ProposalNamingConvention.NORMAL,
        subgraphs: [
          {
            name: subgraphName,
            schemaSDL: updatedSubgraphSDL,
            isDeleted: false,
            isNew: false,
            labels: [],
          },
        ],
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
    },
  );

  test('graph-admin should successfully create a new proposal for a federated graph on allowed namespace (with normal naming convention)', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal with a schema change to the subgraph
    const updatedSubgraphSDL = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'graph-admin',
          namespaces: [getNamespaceResponse.namespace!.id],
        }),
      ),
    });

    let createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
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

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup({
          role: 'graph-admin',
          namespaces: [randomUUID()],
        }),
      ),
    });

    createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('should fail to create proposal with name starting with `/^p-\\d+$/` when using normal naming convention', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup a federated graph with a single subgraph
    const subgraphName = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = 'p-123'; // This should be rejected with cosmo-cli user-agent

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

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
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createProposalResponse.response?.details).toContain('Proposal name cannot start with p-');

    await server.close();
  });

  test('should fail to create a proposal with the same name for the same federated graph (with normal naming convention)', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

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

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create first proposal
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
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: updatedSubgraphSDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse.proposalId).toBeDefined();

    // Try to create a second proposal with the same name for the same federated graph
    const secondProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName, // Same proposal name
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName,
          schemaSDL: `
            type Query {
              hello: String!
              anotherField: String!
            }
          `,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    // Expect an error response
    expect(secondProposalResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(secondProposalResponse.response?.details).toContain(`Proposal ${proposalName} already exists.`);

    await server.close();
  });

  test('should allow creating proposals with the same name for different federated graphs (with normal naming convention)', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup common test data
    const subgraphName = genID('subgraph');
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');
    const proposalName = genID('proposal'); // Same proposal name to be used for both graphs

    const subgraphSchemaSDL = `
      type Query {
        hello: String!
      }
    `;

    // Create subgraph1 with label1 and fedGraph1
    await createThenPublishSubgraph(
      client,
      subgraphName + '1',
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraph1Name, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);

    // Create subgraph2 with label2 and fedGraph2
    await createThenPublishSubgraph(
      client,
      subgraphName + '2',
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label2],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraph2Name, DEFAULT_NAMESPACE, [joinLabel(label2)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create first proposal for fedGraph1
    const updatedSubgraphSDL1 = `
      type Query {
        hello: String!
        newField1: Int!
      }
    `;

    const createProposalResponse1 = await client.createProposal({
      federatedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName + '1',
          schemaSDL: updatedSubgraphSDL1,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposalResponse1.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse1.proposalId).toBeDefined();

    // Create second proposal with the same name but for fedGraph2
    const updatedSubgraphSDL2 = `
      type Query {
        hello: String!
        newField2: String!
      }
    `;

    const createProposalResponse2 = await client.createProposal({
      federatedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName, // Same proposal name
      namingConvention: ProposalNamingConvention.NORMAL,
      subgraphs: [
        {
          name: subgraphName + '2',
          schemaSDL: updatedSubgraphSDL2,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    // Expect success for the second proposal as well
    expect(createProposalResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(createProposalResponse2.proposalId).toBeDefined();

    // Verify both proposals were created successfully
    const proposal1Response = await client.getProposal({
      proposalId: createProposalResponse1.proposalId,
    });

    const proposal2Response = await client.getProposal({
      proposalId: createProposalResponse2.proposalId,
    });

    expect(proposal1Response.response?.code).toBe(EnumStatusCode.OK);
    expect(proposal2Response.response?.code).toBe(EnumStatusCode.OK);

    // Verify they have the same name but different federated graphs
    expect(proposal1Response.proposal?.name).toBe(proposalName);
    expect(proposal2Response.proposal?.name).toBe(proposalName);
    expect(proposal1Response.proposal?.federatedGraphName).toBe(fedGraph1Name);
    expect(proposal2Response.proposal?.federatedGraphName).toBe(fedGraph2Name);

    await server.close();
  });
});
