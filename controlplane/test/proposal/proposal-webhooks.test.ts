import { PartialMessage } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { ProposalNamingConvention, ProposalOrigin } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
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
  DEFAULT_SUBGRAPH_URL_THREE,
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

describe('Schema updated webhook tests', () => {
  let chClient: ClickHouseClient;

  // Store captured webhook payloads
  let capturedWebhooks: Array<{ url: string; payload: any }> = [];

  // Setup msw mock server to capture webhook calls
  const mockServer = setupServer(
    http.post('http://webhook-fedgraph1.test', async ({ request }) => {
      const payload = await request.json();
      capturedWebhooks.push({ url: 'http://webhook-fedgraph1.test', payload });
      return HttpResponse.json({ success: true });
    }),
    http.post('http://webhook-fedgraph2.test', async ({ request }) => {
      const payload = await request.json();
      capturedWebhooks.push({ url: 'http://webhook-fedgraph2.test', payload });
      return HttpResponse.json({ success: true });
    }),
  );

  beforeEach(() => {
    chClient = new ClickHouseClient();
    capturedWebhooks = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockServer.resetHandlers();
  });

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    mockServer.close();
    await afterAllSetup(dbname);
  });

  test('should include correct composedSchemaVersionId and send PROPOSAL_STATE_UPDATED webhook when publishing subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup: Create two separate federated graphs with different subgraphs
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');
    const proposal1Name = genID('proposal1');
    const proposal2Name = genID('proposal2');

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
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
      }
    `;

    // Create first federated graph and subgraph
    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createFederatedGraph(client, fedGraph1Name, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);

    // Create second federated graph and subgraph
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label2],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(
      client,
      fedGraph2Name,
      DEFAULT_NAMESPACE,
      [joinLabel(label2)],
      'http://localhost:3003',
    );

    // Get federated graph IDs
    const fedGraph1Res = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(fedGraph1Res.response?.code).toBe(EnumStatusCode.OK);
    const fedGraph1Id = fedGraph1Res.graph!.id;

    const fedGraph2Res = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(fedGraph2Res.response?.code).toBe(EnumStatusCode.OK);
    const fedGraph2Id = fedGraph2Res.graph!.id;

    // Create webhook configs for each federated graph with different endpoints
    const eventsMeta1: PartialMessage<EventMeta>[] = [
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'federatedGraphSchemaUpdated',
          value: {
            graphIds: [fedGraph1Id],
          },
        },
      },
      {
        eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
        meta: {
          case: 'proposalStateUpdated',
          value: {
            graphIds: [fedGraph1Id],
          },
        },
      },
    ];

    const webhook1Res = await client.createOrganizationWebhookConfig({
      endpoint: 'http://webhook-fedgraph1.test',
      events: [
        OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED],
        OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
      ],
      eventsMeta: eventsMeta1,
    });
    expect(webhook1Res.response?.code).toBe(EnumStatusCode.OK);

    const eventsMeta2: PartialMessage<EventMeta>[] = [
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'federatedGraphSchemaUpdated',
          value: {
            graphIds: [fedGraph2Id],
          },
        },
      },
      {
        eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
        meta: {
          case: 'proposalStateUpdated',
          value: {
            graphIds: [fedGraph2Id],
          },
        },
      },
    ];

    const webhook2Res = await client.createOrganizationWebhookConfig({
      endpoint: 'http://webhook-fedgraph2.test',
      events: [
        OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED],
        OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
      ],
      eventsMeta: eventsMeta2,
    });
    expect(webhook2Res.response?.code).toBe(EnumStatusCode.OK);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create proposal for fedGraph1
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

    const createProposal1Response = await client.createProposal({
      federatedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposal1Name,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: updatedSubgraph1SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposal1Response.response?.code).toBe(EnumStatusCode.OK);

    // Create proposal for fedGraph2
    const updatedSubgraph2SDL = `
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

    const createProposal2Response = await client.createProposal({
      federatedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposal2Name,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraph2Name,
          schemaSDL: updatedSubgraph2SDL,
          isDeleted: false,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposal2Response.response?.code).toBe(EnumStatusCode.OK);

    // Approve both proposals
    await client.updateProposal({
      proposalName: createProposal1Response.proposalName,
      federatedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    await client.updateProposal({
      proposalName: createProposal2Response.proposalName,
      federatedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Clear captured webhooks before publishing (webhook configs creation may trigger some)
    capturedWebhooks = [];

    // Publish subgraph1 schema - this should mark proposal1 as PUBLISHED
    const publishSubgraph1Response = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraph1SDL,
    });

    expect(publishSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);

    // Wait a bit for webhook to be sent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify FEDERATED_GRAPH_SCHEMA_UPDATED webhook for fedGraph1 was called
    const fedGraph1SchemaWebhooks = capturedWebhooks.filter(
      (w) => w.url === 'http://webhook-fedgraph1.test' && w.payload.event === 'FEDERATED_GRAPH_SCHEMA_UPDATED',
    );
    expect(fedGraph1SchemaWebhooks.length).toBeGreaterThan(0);

    // Get the latest schema updated webhook for fedGraph1
    const latestFedGraph1SchemaWebhook = fedGraph1SchemaWebhooks.at(-1)!;

    // Get the latest composition for fedGraph1 and verify schemaVersionId matches the webhook payload
    const fedGraph1Compositions = await client.getCompositions({
      fedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(fedGraph1Compositions.response?.code).toBe(EnumStatusCode.OK);
    const latestFedGraph1Composition = fedGraph1Compositions.compositions.find((c) => c.isLatestValid);
    expect(latestFedGraph1Composition).toBeDefined();
    expect(latestFedGraph1SchemaWebhook.payload.payload.federated_graph.composedSchemaVersionId).toBe(
      latestFedGraph1Composition!.schemaVersionId,
    );

    // Verify PROPOSAL_STATE_UPDATED webhook was sent for proposal1
    const proposal1StateWebhooks = capturedWebhooks.filter(
      (w) =>
        w.url === 'http://webhook-fedgraph1.test' &&
        w.payload.event === 'PROPOSAL_STATE_UPDATED' &&
        w.payload.payload?.proposal?.id === createProposal1Response.proposalId,
    );
    expect(proposal1StateWebhooks.length).toBe(1);
    expect(proposal1StateWebhooks[0].payload.payload.proposal.state).toBe('PUBLISHED');

    // Verify PROPOSAL_STATE_UPDATED webhook with state 'PUBLISHED' was NOT sent for proposal2 (it's not published yet)
    const proposal2PublishedWebhooksBeforePublish = capturedWebhooks.filter(
      (w) =>
        w.payload.event === 'PROPOSAL_STATE_UPDATED' &&
        w.payload.payload?.proposal?.id === createProposal2Response.proposalId &&
        w.payload.payload?.proposal?.state === 'PUBLISHED',
    );
    expect(proposal2PublishedWebhooksBeforePublish.length).toBe(0);

    // Clear captured webhooks
    capturedWebhooks = [];

    // Publish subgraph2 schema - this should mark proposal2 as PUBLISHED
    const publishSubgraph2Response = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSubgraph2SDL,
    });

    expect(publishSubgraph2Response.response?.code).toBe(EnumStatusCode.OK);

    // Wait a bit for webhook to be sent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify FEDERATED_GRAPH_SCHEMA_UPDATED webhook for fedGraph2 was called
    const fedGraph2SchemaWebhooks = capturedWebhooks.filter(
      (w) => w.url === 'http://webhook-fedgraph2.test' && w.payload.event === 'FEDERATED_GRAPH_SCHEMA_UPDATED',
    );
    expect(fedGraph2SchemaWebhooks.length).toBeGreaterThan(0);

    // Get the latest schema updated webhook for fedGraph2
    const latestFedGraph2SchemaWebhook = fedGraph2SchemaWebhooks.at(-1)!;

    // Get the latest composition for fedGraph2 and verify schemaVersionId matches the webhook payload
    const fedGraph2Compositions = await client.getCompositions({
      fedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(fedGraph2Compositions.response?.code).toBe(EnumStatusCode.OK);
    const latestFedGraph2Composition = fedGraph2Compositions.compositions.find((c) => c.isLatestValid);
    expect(latestFedGraph2Composition).toBeDefined();
    expect(latestFedGraph2SchemaWebhook.payload.payload.federated_graph.composedSchemaVersionId).toBe(
      latestFedGraph2Composition!.schemaVersionId,
    );

    // Verify PROPOSAL_STATE_UPDATED webhook was sent for proposal2
    const proposal2StateWebhooks = capturedWebhooks.filter(
      (w) =>
        w.url === 'http://webhook-fedgraph2.test' &&
        w.payload.event === 'PROPOSAL_STATE_UPDATED' &&
        w.payload.payload?.proposal?.id === createProposal2Response.proposalId,
    );
    expect(proposal2StateWebhooks.length).toBe(1);
    expect(proposal2StateWebhooks[0].payload.payload.proposal.state).toBe('PUBLISHED');

    await server.close();
  });

  test('should include correct composedSchemaVersionId and send PROPOSAL_STATE_UPDATED webhook when deleting subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup: Create two federated graphs, each with two subgraphs (we'll delete one from each)
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1'); // Will be deleted from fedGraph1
    const subgraph2Name = genID('subgraph2'); // Stays in fedGraph1
    const subgraph3Name = genID('subgraph3'); // Will be deleted from fedGraph2
    const subgraph4Name = genID('subgraph4'); // Stays in fedGraph2
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');
    const proposal1Name = genID('proposal1');
    const proposal2Name = genID('proposal2');

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

    const subgraph3SchemaSDL = `
      type Query {
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
      }
    `;

    const subgraph4SchemaSDL = `
      type Query {
        orders: [Order!]!
      }
      
      type Order {
        id: ID!
        productId: ID!
      }
    `;

    // Create fedGraph1 with two subgraphs
    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label1],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraph1Name, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);

    // Create fedGraph2 with two subgraphs
    await createThenPublishSubgraph(
      client,
      subgraph3Name,
      DEFAULT_NAMESPACE,
      subgraph3SchemaSDL,
      [label2],
      DEFAULT_SUBGRAPH_URL_THREE,
    );

    await createThenPublishSubgraph(
      client,
      subgraph4Name,
      DEFAULT_NAMESPACE,
      subgraph4SchemaSDL,
      [label2],
      'http://localhost:4004',
    );

    await createFederatedGraph(
      client,
      fedGraph2Name,
      DEFAULT_NAMESPACE,
      [joinLabel(label2)],
      'http://localhost:3003',
    );

    // Get federated graph IDs
    const fedGraph1Res = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
    });
    const fedGraph1Id = fedGraph1Res.graph!.id;

    const fedGraph2Res = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
    });
    const fedGraph2Id = fedGraph2Res.graph!.id;

    // Create webhook configs
    await client.createOrganizationWebhookConfig({
      endpoint: 'http://webhook-fedgraph1.test',
      events: [
        OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED],
        OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
      ],
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: { graphIds: [fedGraph1Id] },
          },
        },
        {
          eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
          meta: {
            case: 'proposalStateUpdated',
            value: { graphIds: [fedGraph1Id] },
          },
        },
      ],
    });

    await client.createOrganizationWebhookConfig({
      endpoint: 'http://webhook-fedgraph2.test',
      events: [
        OrganizationEventName[OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED],
        OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
      ],
      eventsMeta: [
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          meta: {
            case: 'federatedGraphSchemaUpdated',
            value: { graphIds: [fedGraph2Id] },
          },
        },
        {
          eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
          meta: {
            case: 'proposalStateUpdated',
            value: { graphIds: [fedGraph2Id] },
          },
        },
      ],
    });

    // Enable proposals
    await enableProposalsForNamespace(client);

    // Create proposal for fedGraph1 that deletes subgraph1
    const createProposal1Response = await client.createProposal({
      federatedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposal1Name,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraph1Name,
          schemaSDL: subgraph1SchemaSDL,
          isDeleted: true,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposal1Response.response?.code).toBe(EnumStatusCode.OK);

    // Create proposal for fedGraph2 that deletes subgraph3
    const createProposal2Response = await client.createProposal({
      federatedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      name: proposal2Name,
      namingConvention: ProposalNamingConvention.INCREMENTAL,
      origin: ProposalOrigin.INTERNAL,
      subgraphs: [
        {
          name: subgraph3Name,
          schemaSDL: subgraph3SchemaSDL,
          isDeleted: true,
          isNew: false,
          labels: [],
        },
      ],
    });

    expect(createProposal2Response.response?.code).toBe(EnumStatusCode.OK);

    // Approve both proposals
    await client.updateProposal({
      proposalName: createProposal1Response.proposalName,
      federatedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    await client.updateProposal({
      proposalName: createProposal2Response.proposalName,
      federatedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });

    // Clear captured webhooks before deleting
    capturedWebhooks = [];

    // Delete subgraph1 - this should mark proposal1 as PUBLISHED
    const deleteSubgraph1Response = await client.deleteFederatedSubgraph({
      subgraphName: subgraph1Name,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteSubgraph1Response.response?.code).toBe(EnumStatusCode.OK);

    // Wait a bit for webhook to be sent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify FEDERATED_GRAPH_SCHEMA_UPDATED webhook for fedGraph1 was called
    const fedGraph1SchemaWebhooks = capturedWebhooks.filter(
      (w) => w.url === 'http://webhook-fedgraph1.test' && w.payload.event === 'FEDERATED_GRAPH_SCHEMA_UPDATED',
    );
    expect(fedGraph1SchemaWebhooks.length).toBeGreaterThan(0);

    const latestFedGraph1SchemaWebhook = fedGraph1SchemaWebhooks.at(-1)!;

    // Get the latest composition for fedGraph1 and verify schemaVersionId matches the webhook payload
    const fedGraph1Compositions = await client.getCompositions({
      fedGraphName: fedGraph1Name,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(fedGraph1Compositions.response?.code).toBe(EnumStatusCode.OK);
    const latestFedGraph1Composition = fedGraph1Compositions.compositions.find((c) => c.isLatestValid);
    expect(latestFedGraph1Composition).toBeDefined();
    expect(latestFedGraph1SchemaWebhook.payload.payload.federated_graph.composedSchemaVersionId).toBe(
      latestFedGraph1Composition!.schemaVersionId,
    );

    // Verify PROPOSAL_STATE_UPDATED webhook was sent for proposal1
    const proposal1StateWebhooks = capturedWebhooks.filter(
      (w) =>
        w.url === 'http://webhook-fedgraph1.test' &&
        w.payload.event === 'PROPOSAL_STATE_UPDATED' &&
        w.payload.payload?.proposal?.id === createProposal1Response.proposalId,
    );
    expect(proposal1StateWebhooks.length).toBe(1);
    expect(proposal1StateWebhooks[0].payload.payload.proposal.state).toBe('PUBLISHED');

    // Verify PROPOSAL_STATE_UPDATED webhook with state 'PUBLISHED' was NOT sent for proposal2 (it's not published yet)
    const proposal2PublishedWebhooksBeforeDelete = capturedWebhooks.filter(
      (w) =>
        w.payload.event === 'PROPOSAL_STATE_UPDATED' &&
        w.payload.payload?.proposal?.id === createProposal2Response.proposalId &&
        w.payload.payload?.proposal?.state === 'PUBLISHED',
    );
    expect(proposal2PublishedWebhooksBeforeDelete.length).toBe(0);

    // Clear captured webhooks
    capturedWebhooks = [];

    // Delete subgraph3 - this should mark proposal2 as PUBLISHED
    const deleteSubgraph3Response = await client.deleteFederatedSubgraph({
      subgraphName: subgraph3Name,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(deleteSubgraph3Response.response?.code).toBe(EnumStatusCode.OK);

    // Wait a bit for webhook to be sent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify FEDERATED_GRAPH_SCHEMA_UPDATED webhook for fedGraph2 was called
    const fedGraph2SchemaWebhooks = capturedWebhooks.filter(
      (w) => w.url === 'http://webhook-fedgraph2.test' && w.payload.event === 'FEDERATED_GRAPH_SCHEMA_UPDATED',
    );
    expect(fedGraph2SchemaWebhooks.length).toBeGreaterThan(0);

    const latestFedGraph2SchemaWebhook = fedGraph2SchemaWebhooks.at(-1)!;

    // Get the latest composition for fedGraph2 and verify schemaVersionId matches the webhook payload
    const fedGraph2Compositions = await client.getCompositions({
      fedGraphName: fedGraph2Name,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(fedGraph2Compositions.response?.code).toBe(EnumStatusCode.OK);
    const latestFedGraph2Composition = fedGraph2Compositions.compositions.find((c) => c.isLatestValid);
    expect(latestFedGraph2Composition).toBeDefined();
    expect(latestFedGraph2SchemaWebhook.payload.payload.federated_graph.composedSchemaVersionId).toBe(
      latestFedGraph2Composition!.schemaVersionId,
    );

    // Verify PROPOSAL_STATE_UPDATED webhook was sent for proposal2
    const proposal2StateWebhooks = capturedWebhooks.filter(
      (w) =>
        w.url === 'http://webhook-fedgraph2.test' &&
        w.payload.event === 'PROPOSAL_STATE_UPDATED' &&
        w.payload.payload?.proposal?.id === createProposal2Response.proposalId,
    );
    expect(proposal2StateWebhooks.length).toBe(1);
    expect(proposal2StateWebhooks[0].payload.payload.proposal.state).toBe('PUBLISHED');

    await server.close();
  });
});
