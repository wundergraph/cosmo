import { Client } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { PlatformService, ProposalNamingConvention } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
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

const webhookUrl = 'http://proposal-batch-publish-webhook.test';

const reviewsSDL = 'type Query { reviews: [String!]! }';
const searchSDL = 'type Query { search: [String!]! }';
const proposedReviewsSDL = 'type Query { reviews: [String!]! topReviews: [String!]! }';
const proposedSearchSDL = 'type Query { search: [String!]! suggest: [String!]! }';

/** A federated graph of reviews and search with proposals on, and one approved proposal changing both. */
async function setUpApprovedProposal(client: Client<typeof PlatformService>, publishSeverity: 'warn' | 'error') {
  const fedGraphName = genID('fedGraph');
  const reviews = genID('reviews');
  const search = genID('search');
  const label = genUniqueLabel('label');

  await createThenPublishSubgraph(client, reviews, DEFAULT_NAMESPACE, reviewsSDL, [label], DEFAULT_SUBGRAPH_URL_ONE);
  await createThenPublishSubgraph(client, search, DEFAULT_NAMESPACE, searchSDL, [label], DEFAULT_SUBGRAPH_URL_TWO);
  await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

  expect(
    (await client.enableProposalsForNamespace({ namespace: DEFAULT_NAMESPACE, enableProposals: true })).response?.code,
  ).toBe(EnumStatusCode.OK);
  expect(
    (
      await client.configureNamespaceProposalConfig({
        namespace: DEFAULT_NAMESPACE,
        checkSeverityLevel: 0,
        publishSeverityLevel: publishSeverity === 'error' ? 1 : 0,
      })
    ).response?.code,
  ).toBe(EnumStatusCode.OK);

  const proposal = await client.createProposal({
    federatedGraphName: fedGraphName,
    namespace: DEFAULT_NAMESPACE,
    name: genID('proposal'),
    namingConvention: ProposalNamingConvention.INCREMENTAL,
    subgraphs: [
      { name: reviews, schemaSDL: proposedReviewsSDL, isDeleted: false, isNew: false, labels: [] },
      { name: search, schemaSDL: proposedSearchSDL, isDeleted: false, isNew: false, labels: [] },
    ],
  });
  expect(proposal.response?.code).toBe(EnumStatusCode.OK);

  const approve = await client.updateProposal({
    proposalName: proposal.proposalName,
    federatedGraphName: fedGraphName,
    namespace: DEFAULT_NAMESPACE,
    updateAction: { case: 'state', value: 'APPROVED' },
  });
  expect(approve.response?.code).toBe(EnumStatusCode.OK);

  const graph = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });

  return { proposalId: proposal.proposalId, graphId: graph.graph?.id ?? '', reviews, search };
}

describe('Batch publish and proposals', () => {
  let capturedWebhooks: Record<string, any>[] = [];

  const mockServer = setupServer(
    http.post(webhookUrl, async ({ request }) => {
      capturedWebhooks.push((await request.json()) as Record<string, any>);
      return HttpResponse.json({ success: true });
    }),
  );

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    capturedWebhooks = [];
  });

  afterAll(async () => {
    mockServer.close();
    await afterAllSetup(dbname);
  });

  test.for([false, true])(
    'a batch publish of an approved proposal marks it PUBLISHED and says so (async: %s)',
    async (async, testContext) => {
      const { client, server } = await SetupTest({
        dbname,
        chClient: new ClickHouseClient(),
        setupBilling: { plan: 'enterprise' },
        enabledFeatures: ['proposals'],
      });
      testContext.onTestFinished(() => server.close());

      const { proposalId, graphId, reviews, search } = await setUpApprovedProposal(client, 'warn');

      await client.createOrganizationWebhookConfig({
        endpoint: webhookUrl,
        events: [OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED]],
        eventsMeta: [
          {
            eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
            meta: { case: 'proposalStateUpdated', value: { graphIds: [graphId] } },
          },
        ],
      });

      const publish = await client.publishFederatedSubgraphs({
        namespace: DEFAULT_NAMESPACE,
        async,
        subgraphs: [
          { name: reviews, schema: proposedReviewsSDL },
          { name: search, schema: proposedSearchSDL },
        ],
      });
      expect(publish.response?.code).toBe(EnumStatusCode.OK);

      await vi.waitFor(async () => {
        const proposal = await client.getProposal({ proposalId });
        expect(proposal.proposal?.state).toBe('PUBLISHED');
      });

      await vi.waitFor(() => {
        expect(capturedWebhooks).toHaveLength(1);
      });
      expect(capturedWebhooks[0].event).toBe('PROPOSAL_STATE_UPDATED');
      expect(capturedWebhooks[0].payload.proposal).toMatchObject({ id: proposalId, state: 'PUBLISHED' });
    },
  );

  test('a batch publish leaves the proposal APPROVED until every subgraph in it is published', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient: new ClickHouseClient(),
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    testContext.onTestFinished(() => server.close());

    const { proposalId, reviews } = await setUpApprovedProposal(client, 'warn');

    const publish = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [{ name: reviews, schema: proposedReviewsSDL }],
    });
    expect(publish.response?.code).toBe(EnumStatusCode.OK);

    const proposal = await client.getProposal({ proposalId });
    expect(proposal.proposal?.state).toBe('APPROVED');
  });

  test('with publish severity error, a batch with a schema no approved proposal holds publishes nothing', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient: new ClickHouseClient(),
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    testContext.onTestFinished(() => server.close());

    const { proposalId, reviews, search } = await setUpApprovedProposal(client, 'error');

    const publish = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: reviews, schema: proposedReviewsSDL },
        { name: search, schema: 'type Query { search: [String!]! other: Int }' },
      ],
    });
    expect(publish.response?.code).toBe(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL);
    expect(publish.response?.details).toBe(
      `The subgraph ${search}'s schema does not match to this subgraph's schema in any approved proposal.`,
    );

    const sdl = await client.getLatestSubgraphSDL({ name: reviews, namespace: DEFAULT_NAMESPACE });
    expect(sdl.sdl).toBe(reviewsSDL);
    expect((await client.getProposal({ proposalId })).proposal?.state).toBe('APPROVED');
  });
});
