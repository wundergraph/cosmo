import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  LintSeverity,
  ProposalNamingConvention,
  ProposalOrigin,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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

// Helper function to enable proposals for namespace
async function enableProposalsForNamespace(client: any, namespace = DEFAULT_NAMESPACE) {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });
  return enableResponse;
}

describe('Proposal Data Isolation Tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should not allow access to proposals from different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup for Company A
    const subgraphNameA = genID('subgraph-a');
    const fedGraphNameA = genID('fedGraph-a');
    const labelA = genUniqueLabel('label-a');
    const proposalNameA = genID('proposal-a');

    const subgraphSchemaA = `
      type Query {
        helloA: String!
      }
    `;

    // Create resources in Company A
    await createThenPublishSubgraph(
      client,
      subgraphNameA,
      DEFAULT_NAMESPACE,
      subgraphSchemaA,
      [labelA],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphNameA, DEFAULT_NAMESPACE, [joinLabel(labelA)], DEFAULT_ROUTER_URL);

    // Enable proposals for Company A
    const enableResponseA = await enableProposalsForNamespace(client);
    expect(enableResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal in Company A
    const newSchemaA = `
      type Query {
        helloA: String!
        worldA: String!
      }
    `;

    const createProposalResponseA = await client.createProposal({
      federatedGraphName: fedGraphNameA,
      name: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphNameA,
          schemaSDL: newSchemaA,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponseA.response?.code).toBe(EnumStatusCode.OK);
    const proposalIdA = createProposalResponseA.proposalId;

    // Switch to Company B user
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB!);

    // Setup for Company B with proposals enabled
    const subgraphNameB = genID('subgraph-b');
    const fedGraphNameB = genID('fedGraph-b');
    const labelB = genUniqueLabel('label-b');

    const subgraphSchemaB = `
      type Query {
        helloB: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameB,
      DEFAULT_NAMESPACE,
      subgraphSchemaB,
      [labelB],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphNameB, DEFAULT_NAMESPACE, [joinLabel(labelB)], DEFAULT_ROUTER_URL);

    const enableResponseB = await enableProposalsForNamespace(client);
    expect(enableResponseB.response?.code).toBe(EnumStatusCode.OK);

    // Try to access Company A's proposal from Company B - should fail
    const getProposalResponse = await client.getProposal({
      proposalId: proposalIdA,
    });
    expect(getProposalResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(getProposalResponse.proposal).toBeUndefined();

    await server.close();
  });

  test('Should not allow updating proposals from different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup for Company A
    const subgraphNameA = genID('subgraph-a');
    const fedGraphNameA = genID('fedGraph-a');
    const labelA = genUniqueLabel('label-a');
    const proposalNameA = genID('proposal-a');

    const subgraphSchemaA = `
      type Query {
        helloA: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameA,
      DEFAULT_NAMESPACE,
      subgraphSchemaA,
      [labelA],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphNameA, DEFAULT_NAMESPACE, [joinLabel(labelA)], DEFAULT_ROUTER_URL);

    const enableResponseA = await enableProposalsForNamespace(client);
    expect(enableResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal in Company A
    const newSchemaA = `
      type Query {
        helloA: String!
        worldA: String!
      }
    `;

    const createProposalResponseA = await client.createProposal({
      federatedGraphName: fedGraphNameA,
      name: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphNameA,
          schemaSDL: newSchemaA,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Switch to Company B user
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB!);

    // Setup for Company B
    const subgraphNameB = genID('subgraph-b');
    const fedGraphNameB = genID('fedGraph-b');
    const labelB = genUniqueLabel('label-b');

    const subgraphSchemaB = `
      type Query {
        helloB: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameB,
      DEFAULT_NAMESPACE,
      subgraphSchemaB,
      [labelB],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphNameB, DEFAULT_NAMESPACE, [joinLabel(labelB)], DEFAULT_ROUTER_URL);

    const enableResponseB = await enableProposalsForNamespace(client);
    expect(enableResponseB.response?.code).toBe(EnumStatusCode.OK);

    // Try to update Company A's proposal from Company B - should fail
    const updatedSchema = `
      type Query {
        helloA: String!
        worldA: String!
        maliciousField: String!
      }
    `;

    const updateProposalResponse = await client.updateProposal({
      federatedGraphName: fedGraphNameA, // Company A's federated graph
      proposalName: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphNameA,
              schemaSDL: updatedSchema,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });
    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Should not list proposals from different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup for Company A
    const subgraphNameA = genID('subgraph-a');
    const fedGraphNameA = genID('fedGraph-a');
    const labelA = genUniqueLabel('label-a');
    const proposalNameA1 = genID('proposal-a1');
    const proposalNameA2 = genID('proposal-a2');

    const subgraphSchemaA = `
      type Query {
        helloA: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameA,
      DEFAULT_NAMESPACE,
      subgraphSchemaA,
      [labelA],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphNameA, DEFAULT_NAMESPACE, [joinLabel(labelA)], DEFAULT_ROUTER_URL);

    const enableResponseA = await enableProposalsForNamespace(client);
    expect(enableResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Create two proposals in Company A
    const newSchemaA1 = `
      type Query {
        helloA: String!
        worldA1: String!
      }
    `;

    await client.createProposal({
      federatedGraphName: fedGraphNameA,
      name: proposalNameA1,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphNameA,
          schemaSDL: newSchemaA1,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });

    const newSchemaA2 = `
      type Query {
        helloA: String!
        worldA2: String!
      }
    `;

    await client.createProposal({
      federatedGraphName: fedGraphNameA,
      name: proposalNameA2,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphNameA,
          schemaSDL: newSchemaA2,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });

    // Switch to Company B user
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB!);

    // Enable proposals for Company B as well (each org has its own namespace)
    const enableResponseB = await enableProposalsForNamespace(client);
    expect(enableResponseB.response?.code).toBe(EnumStatusCode.OK);

    // Try to list Company A's proposals from Company B
    // This should fail because the federated graph doesn't exist in Company B's organization
    const getProposalsResponse = await client.getProposalsByFederatedGraph({
      federatedGraphName: fedGraphNameA,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
    });
    // The federated graph doesn't exist in Company B's organization
    expect(getProposalsResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    // Should not return any proposals
    expect(getProposalsResponse.proposals.length).toBe(0);

    await server.close();
  });

  test('Should not access proposal checks from different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup for Company A
    const subgraphNameA = genID('subgraph-a');
    const fedGraphNameA = genID('fedGraph-a');
    const labelA = genUniqueLabel('label-a');
    const proposalNameA = genID('proposal-a');

    const subgraphSchemaA = `
      type Query {
        helloA: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameA,
      DEFAULT_NAMESPACE,
      subgraphSchemaA,
      [labelA],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphNameA, DEFAULT_NAMESPACE, [joinLabel(labelA)], DEFAULT_ROUTER_URL);

    const enableResponseA = await enableProposalsForNamespace(client);
    expect(enableResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal in Company A (which creates a schema check)
    const newSchemaA = `
      type Query {
        helloA: String!
        worldA: String!
      }
    `;

    const createProposalResponseA = await client.createProposal({
      federatedGraphName: fedGraphNameA,
      name: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphNameA,
          schemaSDL: newSchemaA,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponseA.response?.code).toBe(EnumStatusCode.OK);
    const proposalIdA = createProposalResponseA.proposalId;

    // Switch to Company B user
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB!);

    // Setup for Company B
    const subgraphNameB = genID('subgraph-b');
    const fedGraphNameB = genID('fedGraph-b');
    const labelB = genUniqueLabel('label-b');

    const subgraphSchemaB = `
      type Query {
        helloB: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameB,
      DEFAULT_NAMESPACE,
      subgraphSchemaB,
      [labelB],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphNameB, DEFAULT_NAMESPACE, [joinLabel(labelB)], DEFAULT_ROUTER_URL);

    const enableResponseB = await enableProposalsForNamespace(client);
    expect(enableResponseB.response?.code).toBe(EnumStatusCode.OK);

    // Try to access Company A's proposal checks from Company B - should fail
    const getProposalChecksResponse = await client.getProposalChecks({
      proposalId: proposalIdA,
      limit: 10,
      offset: 0,
    });
    expect(getProposalChecksResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(getProposalChecksResponse.checks.length).toBe(0);

    await server.close();
  });

  test('Should not access namespace proposal config from different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Enable proposals for Company A's namespace
    const enableResponseA = await enableProposalsForNamespace(client);
    expect(enableResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Configure proposal settings for Company A
    const configureResponseA = await client.configureNamespaceProposalConfig({
      namespace: DEFAULT_NAMESPACE,
      checkSeverityLevel: LintSeverity.warn,
      publishSeverityLevel: LintSeverity.error,
    });
    expect(configureResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Verify Company A can read its config
    const getConfigResponseA = await client.getNamespaceProposalConfig({
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getConfigResponseA.response?.code).toBe(EnumStatusCode.OK);
    expect(getConfigResponseA.enabled).toBe(true);

    // Switch to Company B user
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB!);

    // Company B should not see Company A's namespace config
    // When getting config for default namespace, Company B should see its own namespace's config
    const getConfigResponseB = await client.getNamespaceProposalConfig({
      namespace: DEFAULT_NAMESPACE,
    });
    // Company B's default namespace should have proposals disabled (not configured yet)
    expect(getConfigResponseB.response?.code).toBe(EnumStatusCode.OK);
    expect(getConfigResponseB.enabled).toBe(false);

    await server.close();
  });

  test('Should isolate proposals between different federated graphs in same organization', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup first federated graph with unique subgraph
    const subgraphName1 = genID('subgraph-1');
    const fedGraphName1 = genID('fedGraph-1');
    const label1 = genUniqueLabel('label-1');
    const proposalName1 = genID('proposal-1');

    const subgraphSchema1 = `
      type User {
        id: ID!
        name: String!
      }
      type Query {
        users: [User!]!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphName1,
      DEFAULT_NAMESPACE,
      subgraphSchema1,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphName1, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);

    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create proposal for first federated graph
    const newSchema1 = `
      type User {
        id: ID!
        name: String!
        email: String!
      }
      type Query {
        users: [User!]!
      }
    `;

    const createProposalResponse1 = await client.createProposal({
      federatedGraphName: fedGraphName1,
      name: proposalName1,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName1,
          schemaSDL: newSchema1,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponse1.response?.code).toBe(EnumStatusCode.OK);

    // Setup second federated graph with different unique subgraph (different labels = isolated)
    const subgraphName2 = genID('subgraph-2');
    const fedGraphName2 = genID('fedGraph-2');
    const label2 = genUniqueLabel('label-2');
    const proposalName2 = genID('proposal-2');

    // Create federated graph first
    await createFederatedGraph(client, fedGraphName2, DEFAULT_NAMESPACE, [joinLabel(label2)], DEFAULT_ROUTER_URL);

    const subgraphSchema2 = `
      type Product {
        id: ID!
        title: String!
      }
      type Query {
        products: [Product!]!
      }
    `;

    const createProposalResponse2 = await client.createProposal({
      federatedGraphName: fedGraphName2,
      name: proposalName2,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName2,
          schemaSDL: subgraphSchema2,
          isDeleted: false,
          isNew: true, // Subgraph doesn't exist yet
          labels: [label2],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponse2.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal so the subgraph can be published
    const approveResponse = await client.updateProposal({
      federatedGraphName: fedGraphName2,
      proposalName: proposalName2,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });
    expect(approveResponse.response?.code).toBe(EnumStatusCode.OK);

    // Now publish the subgraph - it should match the approved proposal
    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName2,
      namespace: DEFAULT_NAMESPACE,
      schema: subgraphSchema2,
      labels: [label2],
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // Create another proposal for second federated graph (we already created one above)
    const newSchema2 = `
      type Product {
        id: ID!
        title: String!
        price: Float!
        description: String!
      }
      type Query {
        products: [Product!]!
      }
    `;

    const proposalName2b = genID('proposal-2b');
    const createProposalResponse2b = await client.createProposal({
      federatedGraphName: fedGraphName2,
      name: proposalName2b,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphName2,
          schemaSDL: newSchema2,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponse2b.response?.code).toBe(EnumStatusCode.OK);

    // Get proposals for first federated graph - should only return its proposal
    const getProposals1 = await client.getProposalsByFederatedGraph({
      federatedGraphName: fedGraphName1,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
    });
    expect(getProposals1.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposals1.proposals.length).toBe(1);
    expect(getProposals1.proposals[0].name).toBe(proposalName1);

    // Get proposals for second federated graph - should only return its proposals
    const getProposals2 = await client.getProposalsByFederatedGraph({
      federatedGraphName: fedGraphName2,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
    });
    expect(getProposals2.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposals2.proposals.length).toBe(2);
    // Should contain both proposals for fedGraphName2, but not proposals from fedGraphName1
    const proposalNames2 = getProposals2.proposals.map((p) => p.name);
    expect(proposalNames2).toContain(proposalName2);
    expect(proposalNames2).toContain(proposalName2b);
    expect(proposalNames2).not.toContain(proposalName1);

    // Test getProposal - should only return proposal from the correct federated graph
    const proposalId1 = createProposalResponse1.proposalId;
    const getProposal1 = await client.getProposal({
      proposalId: proposalId1,
    });
    expect(getProposal1.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposal1.proposal?.name).toBe(proposalName1);
    expect(getProposal1.proposal?.federatedGraphName).toBe(fedGraphName1);

    // Get proposal2 - should work
    const proposalId2 = createProposalResponse2.proposalId;
    const getProposal2 = await client.getProposal({
      proposalId: proposalId2,
    });
    expect(getProposal2.response?.code).toBe(EnumStatusCode.OK);
    expect(getProposal2.proposal?.name).toBe(proposalName2);
    expect(getProposal2.proposal?.federatedGraphName).toBe(fedGraphName2);

    // Verify that proposals are correctly isolated - proposal1 should belong to fedGraphName1
    expect(getProposal1.proposal?.federatedGraphName).not.toBe(fedGraphName2);
    expect(getProposal2.proposal?.federatedGraphName).not.toBe(fedGraphName1);

    // Test getProposalChecks - should only return checks for proposals from the correct federated graph
    // First, we need to create a check for proposal1 by updating it
    const updateProposal1Response = await client.updateProposal({
      federatedGraphName: fedGraphName1,
      proposalName: proposalName1,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphName1,
              schemaSDL: newSchema1,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });
    expect(updateProposal1Response.response?.code).toBe(EnumStatusCode.OK);

    // Get checks for proposal1
    const getChecks1 = await client.getProposalChecks({
      proposalId: proposalId1,
      limit: 10,
      offset: 0,
    });
    expect(getChecks1.response?.code).toBe(EnumStatusCode.OK);
    // Should have at least one check
    expect(getChecks1.checks.length).toBeGreaterThan(0);

    // Test updateProposal with updatedSubgraphs - should only work for correct federated graph
    const updateProposal2Response = await client.updateProposal({
      federatedGraphName: fedGraphName2,
      proposalName: proposalName2b,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphName2,
              schemaSDL: newSchema2,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });
    expect(updateProposal2Response.response?.code).toBe(EnumStatusCode.OK);

    // Try to update proposal1 using fedGraphName2 - should fail
    const updateProposal1WrongFedGraph = await client.updateProposal({
      federatedGraphName: fedGraphName2,
      proposalName: proposalName1,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'updatedSubgraphs',
        value: {
          subgraphs: [
            {
              name: subgraphName1,
              schemaSDL: newSchema1,
              isDeleted: false,
              isNew: false,
              labels: [],
            },
          ],
        },
      },
    });
    expect(updateProposal1WrongFedGraph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Should not allow approving or closing proposals from different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup for Company A
    const subgraphNameA = genID('subgraph-a');
    const fedGraphNameA = genID('fedGraph-a');
    const labelA = genUniqueLabel('label-a');
    const proposalNameA = genID('proposal-a');

    const subgraphSchemaA = `
      type Query {
        helloA: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameA,
      DEFAULT_NAMESPACE,
      subgraphSchemaA,
      [labelA],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraphNameA, DEFAULT_NAMESPACE, [joinLabel(labelA)], DEFAULT_ROUTER_URL);

    const enableResponseA = await enableProposalsForNamespace(client);
    expect(enableResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal in Company A
    const newSchemaA = `
      type Query {
        helloA: String!
        worldA: String!
      }
    `;

    const createProposalResponseA = await client.createProposal({
      federatedGraphName: fedGraphNameA,
      name: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        {
          name: subgraphNameA,
          schemaSDL: newSchemaA,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
      origin: ProposalOrigin.INTERNAL,
      namingConvention: ProposalNamingConvention.NORMAL,
    });
    expect(createProposalResponseA.response?.code).toBe(EnumStatusCode.OK);

    // Switch to Company B user
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB!);

    // Setup for Company B
    const subgraphNameB = genID('subgraph-b');
    const fedGraphNameB = genID('fedGraph-b');
    const labelB = genUniqueLabel('label-b');

    const subgraphSchemaB = `
      type Query {
        helloB: String!
      }
    `;

    await createThenPublishSubgraph(
      client,
      subgraphNameB,
      DEFAULT_NAMESPACE,
      subgraphSchemaB,
      [labelB],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphNameB, DEFAULT_NAMESPACE, [joinLabel(labelB)], DEFAULT_ROUTER_URL);

    const enableResponseB = await enableProposalsForNamespace(client);
    expect(enableResponseB.response?.code).toBe(EnumStatusCode.OK);

    // Try to approve Company A's proposal from Company B - should fail
    const approveResponse = await client.updateProposal({
      federatedGraphName: fedGraphNameA,
      proposalName: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });
    expect(approveResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Try to approve Company A's proposal from Company B - should fail
    const approveResponseB = await client.updateProposal({
      federatedGraphName: fedGraphNameB,
      proposalName: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });
    expect(approveResponseB.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Try to close Company A's proposal from Company B - should fail
    const closeResponse = await client.updateProposal({
      federatedGraphName: fedGraphNameA,
      proposalName: proposalNameA,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'CLOSED',
      },
    });
    expect(closeResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });
});
