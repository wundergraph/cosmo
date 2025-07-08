import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProposalNamingConvention } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
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
async function enableProposalsForNamespace(client: any, namespace = DEFAULT_NAMESPACE) {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });

  return enableResponse;
}

// Helper function to set check/publish severity for namespace
async function setProposalSeverity(
  client: any,
  namespace = DEFAULT_NAMESPACE,
  checkSeverity: 'warn' | 'error',
  publishSeverity: 'warn' | 'error',
) {
  const configResponse = await client.configureNamespaceProposalConfig({
    namespace,
    checkSeverityLevel: checkSeverity === 'error' ? 1 : 0, // Using numeric values for LintSeverity enum (0=warn, 1=error)
    publishSeverityLevel: publishSeverity === 'error' ? 1 : 0,
  });

  return {
    response: configResponse,
  };
}

// Helper function to create a proposal
async function createTestProposal(
  client: any,
  options: {
    federatedGraphName: string;
    proposalName: string;
    subgraphName: string;
    updatedSubgraphSDL: string;
    namespace?: string;
  },
) {
  const { federatedGraphName, proposalName, subgraphName, updatedSubgraphSDL, namespace = DEFAULT_NAMESPACE } = options;

  const createProposalResponse = await client.createProposal({
    federatedGraphName,
    namespace,
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
    namingConvention: ProposalNamingConvention.INCREMENTAL,
  });

  return createProposalResponse;
}

// Helper function to create a proposal with a deleted subgraph
async function createTestProposalWithDeletedSubgraph(
  client: any,
  options: {
    federatedGraphName: string;
    proposalName: string;
    subgraphName: string;
    namespace?: string;
  },
) {
  const { federatedGraphName, proposalName, subgraphName, namespace = DEFAULT_NAMESPACE } = options;

  const createProposalResponse = await client.createProposal({
    federatedGraphName,
    namespace,
    name: proposalName,
    subgraphs: [
      {
        name: subgraphName,
        schemaSDL: '', // Empty SDL for deletion
        isDeleted: true,
        isNew: false,
        labels: [],
      },
    ],
  });

  return createProposalResponse;
}

describe('Proposal schema matching tests', () => {
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

  test('should pass check with matching schema when proposal is approved and check severity is set to warn', async () => {
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

    // Set proposal check severity to warn
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'warn');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

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
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Check schema - should pass with no warning since it matches the approved proposal
    const checkResponse = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(updatedSubgraphSDL)),
    });

    expect(checkResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponse.proposalMatchMessage).toBeUndefined();

    // Try with a schema that doesn't match the proposal
    const nonMatchingSchema = `
      type Query {
        hello: String!
        differentField: Boolean!
      }
    `;

    const checkResponse2 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(nonMatchingSchema)),
    });

    expect(checkResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponse2.proposalMatchMessage).toBeDefined();
    expect(checkResponse2.proposalMatchMessage).toContain(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    await server.close();
  });

  test('should fail check with non-matching schema when proposal is approved and check severity is set to error', async () => {
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

    // Set proposal check severity to error
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'error', 'warn');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

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
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try with a schema that doesn't match the proposal - should fail with error
    const nonMatchingSchema = `
      type Query {
        hello: String!
        differentField: Boolean!
      }
    `;

    const checkResponse = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(nonMatchingSchema)),
    });

    expect(checkResponse.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponse.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Check with matching schema - should succeed
    const checkResponse2 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(updatedSubgraphSDL)),
    });

    expect(checkResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponse2.proposalMatchMessage).toBeUndefined();

    await server.close();
  });

  test('should pass publish with matching schema when proposal is approved and publish severity is set to warn', async () => {
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

    // Set proposal publish severity to warn
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'warn');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

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
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Publish with non-matching schema - should warn but still work
    const nonMatchingSchema = `
      type Query {
        hello: String!
        differentField: Boolean!
      }
    `;

    // Publish with schema matching the proposal - should work fine
    const publishResponse = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: nonMatchingSchema,
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponse.proposalMatchMessage).toBeDefined();
    expect(publishResponse.proposalMatchMessage).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    const publishResponse2 = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraphSDL,
    });
    expect(publishResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponse2.proposalMatchMessage).toBeUndefined();

    await server.close();
  });

  test('should fail publish with non-matching schema when proposal is approved and publish severity is set to error', async () => {
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

    // Set proposal publish severity to error
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'error');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

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
      updatedSubgraphSDL,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to publish with non-matching schema - should fail with error
    const nonMatchingSchema = `
      type Query {
        hello: String!
        differentField: Boolean!
      }
    `;

    const publishResponse = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: nonMatchingSchema,
    });

    expect(publishResponse.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(publishResponse.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Publish with matching schema - should succeed
    const publishResponse2 = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraphSDL,
    });

    expect(publishResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponse2.proposalMatchMessage).toBeUndefined();

    await server.close();
  });

  test('should handle multiple approved proposals and match any of them', async () => {
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
    const proposalName1 = genID('proposal1');
    const proposalName2 = genID('proposal2');

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

    // Set proposal check/publish severity to error
    const severityResponse = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'error', 'error');
    expect(severityResponse.response.response?.code).toBe(EnumStatusCode.OK);

    // Create and approve first proposal
    const updatedSubgraphSDL1 = `
      type Query {
        hello: String!
        proposal1Field: Int!
      }
    `;

    const createProposalResponse1 = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName: proposalName1,
      subgraphName,
      updatedSubgraphSDL: updatedSubgraphSDL1,
    });

    expect(createProposalResponse1.response?.code).toBe(EnumStatusCode.OK);

    await client.updateProposal({
      proposalName: createProposalResponse1.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Create and approve second proposal
    const updatedSubgraphSDL2 = `
      type Query {
        hello: String!
        proposal2Field: Boolean!
      }
    `;

    const createProposalResponse2 = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName: proposalName2,
      subgraphName,
      updatedSubgraphSDL: updatedSubgraphSDL2,
    });

    expect(createProposalResponse2.response?.code).toBe(EnumStatusCode.OK);

    await client.updateProposal({
      proposalName: createProposalResponse2.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Check with schema matching first proposal - should succeed
    const checkResponse1 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(updatedSubgraphSDL1)),
    });

    expect(checkResponse1.response?.code).toBe(EnumStatusCode.OK);

    // Check with schema matching second proposal - should also succeed
    const checkResponse2 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(updatedSubgraphSDL2)),
    });

    expect(checkResponse2.response?.code).toBe(EnumStatusCode.OK);

    // Check with schema matching neither proposal - should fail
    const nonMatchingSchema = `
      type Query {
        hello: String!
        unmatchedField: String!
      }
    `;

    const checkResponse3 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(nonMatchingSchema)),
    });

    expect(checkResponse3.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponse3.proposalMatchMessage).toBeDefined();
    expect(checkResponse3.proposalMatchMessage).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    await server.close();
  });

  test('should allow subgraph deletion with approved proposal when publish severity is set to warn', async () => {
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

    // Set proposal publish severity to warn
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'warn');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal for deleting the subgraph
    const createProposalResponse = await createTestProposalWithDeletedSubgraph(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Delete the subgraph - should succeed with no warning since it matches the approved proposal
    const deleteResponse = await client.deleteFederatedSubgraph({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(deleteResponse.proposalMatchMessage).toBeUndefined();

    await server.close();
  });

  test('should allow subgraph deletion when no proposal exists but warn if publish severity is set to warn', async () => {
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

    // Set proposal publish severity to warn
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'warn');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Delete the subgraph without a proposal - should succeed but with a warning
    const deleteResponse = await client.deleteFederatedSubgraph({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(deleteResponse.proposalMatchMessage).toBeDefined();
    expect(deleteResponse.proposalMatchMessage).toBe(
      `The subgraph ${subgraphName} is not proposed to be deleted in any of the approved proposals.`,
    );

    await server.close();
  });

  test('should fail subgraph deletion without approved proposal when publish severity is set to error', async () => {
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

    // Set proposal publish severity to error
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'error');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Try to delete the subgraph without a proposal - should fail
    const deleteResponse = await client.deleteFederatedSubgraph({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(deleteResponse.response?.details).toBe(
      `The subgraph ${subgraphName} is not proposed to be deleted in any of the approved proposals.`,
    );

    await server.close();
  });

  test('should handle multiple approved proposals with deleted subgraphs', async () => {
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
    const proposal1Name = genID('proposal1');
    const proposal2Name = genID('proposal2');

    const subgraph1SchemaSDL = `
      type Query {
        hello: String!
      }
    `;

    const subgraph2SchemaSDL = `
      type Query {
        goodbye: String!
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

    // Set proposal check/publish severity to error
    const severityResponse = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'error', 'error');
    expect(severityResponse.response.response?.code).toBe(EnumStatusCode.OK);

    // Create and approve first proposal for deleting subgraph1
    const createProposalResponse1 = await createTestProposalWithDeletedSubgraph(client, {
      federatedGraphName: fedGraphName,
      proposalName: proposal1Name,
      subgraphName: subgraph1Name,
    });

    expect(createProposalResponse1.response?.code).toBe(EnumStatusCode.OK);

    await client.updateProposal({
      proposalName: createProposalResponse1.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Create and approve second proposal for deleting subgraph2
    const createProposalResponse2 = await createTestProposalWithDeletedSubgraph(client, {
      federatedGraphName: fedGraphName,
      proposalName: proposal2Name,
      subgraphName: subgraph2Name,
    });

    expect(createProposalResponse2.response?.code).toBe(EnumStatusCode.OK);

    await client.updateProposal({
      proposalName: createProposalResponse2.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Delete subgraph1 - should succeed as it has an approved proposal
    const deleteResponse1 = await client.deleteFederatedSubgraph({
      subgraphName: subgraph1Name,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteResponse1.response?.code).toBe(EnumStatusCode.OK);
    expect(deleteResponse1.proposalMatchMessage).toBeUndefined();

    // Delete subgraph2 - should also succeed as it has an approved proposal
    const deleteResponse2 = await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteResponse2.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(deleteResponse2.proposalMatchMessage).toBeUndefined();

    await server.close();
  });

  test('should handle schema check for a subgraph with an approved deletion proposal', async () => {
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

    // Set proposal check severity to error
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'error', 'warn');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal for deleting the subgraph
    const createProposalResponse = await createTestProposalWithDeletedSubgraph(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to check schema for a subgraph that's approved to be deleted
    // This should return an error because the proposed state is that the subgraph should be deleted, not updated
    const modifiedSchema = `
      type Query {
        hello: String!
        newField: Int!
      }
    `;

    const checkResponse = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(modifiedSchema)),
    });

    expect(checkResponse.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponse.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    const checkResponse2 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from('')),
      delete: true,
    });

    expect(checkResponse2.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('should handle check with delete=true when no approved deletion proposal exists', async () => {
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

    // Test with check severity set to 'warn'
    const { response: warnResponse } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'warn');
    expect(warnResponse.response?.code).toBe(EnumStatusCode.OK);

    // Run check with delete=true when no proposal exists for deletion
    const checkResponse = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from('')),
      delete: true,
    });

    // Should pass but with a warning message
    expect(checkResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponse.proposalMatchMessage).toBeDefined();
    expect(checkResponse.proposalMatchMessage).toBe(
      `The subgraph ${subgraphName} is not proposed to be deleted in any of the approved proposals.`,
    );

    // Now set check severity to 'error' and test again
    const { response: errorResponse } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'error', 'warn');
    expect(errorResponse.response?.code).toBe(EnumStatusCode.OK);

    // Run check with delete=true when no proposal exists and check severity is 'error'
    const checkResponseError = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from('')),
      delete: true,
    });

    // Should fail with an error
    expect(checkResponseError.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponseError.response?.details).toBe(
      `The subgraph ${subgraphName} is not proposed to be deleted in any of the approved proposals.`,
    );

    // Add a test for a case with proposal for schema modification but not deletion
    const proposalName = genID('proposal');

    // Create a proposal with schema change, not deletion
    const updatedSchema = `
      type Query {
        hello: String!
        anotherField: Boolean!
      }
    `;

    const createProposalResponse = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName,
      subgraphName,
      updatedSubgraphSDL: updatedSchema,
    });

    expect(createProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Run check with delete=true when there's a proposal for schema change but not deletion
    const checkResponse3 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from('')),
      delete: true,
    });

    // Should still fail as there's no proposal for deletion
    expect(checkResponse3.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponse3.response?.details).toBe(
      `The subgraph ${subgraphName} is not proposed to be deleted in any of the approved proposals.`,
    );

    await server.close();
  });

  test('should verify proposal schema matching is namespace-specific', async () => {
    // This test verifies that proposal schema matching works correctly across namespaces.
    // Specifically, it tests that a schema approved in one namespace won't be considered
    // valid in another namespace, even with identical graph and subgraph names.
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Create two namespaces for testing isolation between them
    const namespace1 = DEFAULT_NAMESPACE;
    const namespace2 = 'test';

    // Create namespace2 (namespace1 is the default already created)
    const createNamespaceResponse = await client.createNamespace({
      name: namespace2,
    });
    expect(createNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    // Setup the same federated graph and subgraph in both namespaces
    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName1 = genID('proposal1');
    const proposalName2 = genID('proposal2');

    const baseSchemaSDL = `
      type Query {
        hello: String!
      }
    `;

    // Create and publish subgraph in namespace 1
    await createThenPublishSubgraph(client, subgraphName, namespace1, baseSchemaSDL, [label], DEFAULT_SUBGRAPH_URL_ONE);

    // Create federated graph in namespace 1
    await createFederatedGraph(client, fedGraphName, namespace1, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Create and publish the same subgraph in namespace 2
    await createThenPublishSubgraph(client, subgraphName, namespace2, baseSchemaSDL, [label], DEFAULT_SUBGRAPH_URL_ONE);

    // Create the same federated graph in namespace 2
    await createFederatedGraph(client, fedGraphName, namespace2, [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for both namespaces
    const enableResponse1 = await enableProposalsForNamespace(client, namespace1);
    expect(enableResponse1.response?.code).toBe(EnumStatusCode.OK);

    const enableResponse2 = await enableProposalsForNamespace(client, namespace2);
    expect(enableResponse2.response?.code).toBe(EnumStatusCode.OK);

    // Set proposal check severity to error for both namespaces
    const severityResponse1 = await setProposalSeverity(client, namespace1, 'error', 'error');
    expect(severityResponse1.response.response?.code).toBe(EnumStatusCode.OK);

    const severityResponse2 = await setProposalSeverity(client, namespace2, 'error', 'error');
    expect(severityResponse2.response.response?.code).toBe(EnumStatusCode.OK);

    // Create different proposals in each namespace
    const updatedSDLNamespace1 = `
      type Query {
        hello: String!
        namespace1Field: Int!
      }
    `;

    const updatedSDLNamespace2 = `
      type Query {
        hello: String!
        namespace2Field: Boolean!
      }
    `;

    // Create and approve proposal in namespace 1
    const createProposalResponse1 = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName: proposalName1,
      subgraphName,
      updatedSubgraphSDL: updatedSDLNamespace1,
      namespace: namespace1,
    });
    expect(createProposalResponse1.response?.code).toBe(EnumStatusCode.OK);

    const approveProposalResponse1 = await client.updateProposal({
      proposalName: createProposalResponse1.proposalName,
      federatedGraphName: fedGraphName,
      namespace: namespace1,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });
    expect(approveProposalResponse1.response?.code).toBe(EnumStatusCode.OK);

    // Create and approve proposal in namespace 2
    const createProposalResponse2 = await createTestProposal(client, {
      federatedGraphName: fedGraphName,
      proposalName: proposalName2,
      subgraphName,
      updatedSubgraphSDL: updatedSDLNamespace2,
      namespace: namespace2,
    });
    expect(createProposalResponse2.response?.code).toBe(EnumStatusCode.OK);

    const approveProposalResponse2 = await client.updateProposal({
      proposalName: createProposalResponse2.proposalName,
      federatedGraphName: fedGraphName,
      namespace: namespace2,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });
    expect(approveProposalResponse2.response?.code).toBe(EnumStatusCode.OK);

    // Check in namespace 1 with schema from namespace 1 - should succeed
    const checkResponse1 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: namespace1,
      schema: Uint8Array.from(Buffer.from(updatedSDLNamespace1)),
    });
    expect(checkResponse1.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponse1.proposalMatchMessage).toBeUndefined();

    // Check in namespace 1 with schema from namespace 2 - should fail
    const checkResponse2 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: namespace1,
      schema: Uint8Array.from(Buffer.from(updatedSDLNamespace2)),
    });
    expect(checkResponse2.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponse2.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Check in namespace 2 with schema from namespace 2 - should succeed
    const checkResponse3 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: namespace2,
      schema: Uint8Array.from(Buffer.from(updatedSDLNamespace2)),
    });
    expect(checkResponse3.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResponse3.proposalMatchMessage).toBeUndefined();

    // Check in namespace 2 with schema from namespace 1 - should fail
    const checkResponse4 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: namespace2,
      schema: Uint8Array.from(Buffer.from(updatedSDLNamespace1)),
    });
    expect(checkResponse4.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(checkResponse4.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Similar test with publish operation
    // Publish in namespace 1 with namespace 2's schema - should fail
    const publishResponse1 = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: namespace1,
      schema: updatedSDLNamespace2,
    });
    expect(publishResponse1.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(publishResponse1.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Publish in namespace 2 with namespace 1's schema - should fail
    const publishResponse2 = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: namespace2,
      schema: updatedSDLNamespace1,
    });
    expect(publishResponse2.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(publishResponse2.response?.details).toBe(
      `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Publish with correct schema in their respective namespaces - should succeed
    const publishResponse3 = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: namespace1,
      schema: updatedSDLNamespace1,
    });
    expect(publishResponse3.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponse3.proposalMatchMessage).toBeUndefined();

    const publishResponse4 = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: namespace2,
      schema: updatedSDLNamespace2,
    });
    expect(publishResponse4.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponse4.proposalMatchMessage).toBeUndefined();

    await server.close();
  });

  test('should match publishing a new subgraph with an approved proposal for a new subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup a federated graph with a single subgraph
    const existingSubgraphName = genID('existing-subgraph');
    const newSubgraphName = genID('new-subgraph'); // This subgraph doesn't exist yet
    const newSubgraphName2 = genID('new-subgraph2'); // This subgraph doesn't exist yet
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const existingSubgraphSDL = `
      type Query {
        existingField: String!
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

    // Set proposal publish severity to error
    const { response } = await setProposalSeverity(client, DEFAULT_NAMESPACE, 'warn', 'error');
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Create a proposal with a new subgraph (not yet existing)
    const newSubgraphSDL = `
      type Query {
        newField: String!
      }
    `;

    // Create a proposal for the new subgraph
    const createProposalResponse = await client.createProposal({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      name: proposalName,
      subgraphs: [
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

    // Approve the proposal
    const updateProposalResponse = await client.updateProposal({
      proposalName: createProposalResponse.proposalName,
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    expect(updateProposalResponse.response?.code).toBe(EnumStatusCode.OK);

    // Try to publish the new subgraph with a schema that doesn't match the proposal
    const nonMatchingSchema = `
      type Query {
        differentField: Int!
      }
    `;

    // First create the subgraph before publishing
    await client.createFederatedSubgraph({
      name: newSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
    });

    const publishResponse1 = await client.publishFederatedSubgraph({
      name: newSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: nonMatchingSchema,
    });

    // Should fail because the schema doesn't match the approved proposal
    expect(publishResponse1.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(publishResponse1.response?.details).toBe(
      `The subgraph ${newSubgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    // Publish with schema matching the proposal - should succeed
    const publishResponse2 = await client.publishFederatedSubgraph({
      name: newSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: newSubgraphSDL,
    });

    expect(publishResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResponse2.proposalMatchMessage).toBeUndefined();

    // Check that the new subgraph was correctly added to the federated graph
    const getFedGraphResponse = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getFedGraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFedGraphResponse.subgraphs?.length).toBe(2);
    expect(getFedGraphResponse.subgraphs?.some((sg) => sg.name === newSubgraphName)).toBe(true);

    await client.createFederatedSubgraph({
      name: newSubgraphName2,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
    });

    const publishResponse3 = await client.publishFederatedSubgraph({
      name: newSubgraphName2,
      namespace: DEFAULT_NAMESPACE,
      schema: newSubgraphSDL,
    });

    // Should fail because the subgraph with newSubgraphName2 doesn't exist yet in the proposal
    expect(publishResponse3.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(publishResponse3.response?.details).toBe(
      `The subgraph ${newSubgraphName2}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    await server.close();
  });
});
