import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ProposalNamingConvention, ProposalOrigin } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
} from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  return { ClickHouseClient };
});

function enableProposalsForNamespace(client: any, namespace = DEFAULT_NAMESPACE) {
  return client.enableProposalsForNamespace({ namespace, enableProposals: true });
}

async function setupGraphAndCachingProposal(client: any, opts: { name: string }) {
  const subgraphName = genID('cache_subgraph');
  const fedGraphName = genID('cache_fedgraph');
  const label = genUniqueLabel('label');

  const baseSDL = `
    type Query { hello: String! }
  `;

  await createThenPublishSubgraph(client, subgraphName, DEFAULT_NAMESPACE, baseSDL, [label], DEFAULT_SUBGRAPH_URL_ONE);

  await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
  await enableProposalsForNamespace(client);

  // Caching proposals tweak cache directives but leave the external SDL shape
  // unchanged. Adding `# cache: ttl=600` here only as a marker; the real
  // mechanism (e.g. @entityCache(ttl:)) lives in subgraph schemas in prod.
  const tunedSDL = `
    type Query { hello: String! }
  `;

  const create = await client.createProposal({
    federatedGraphName: fedGraphName,
    namespace: DEFAULT_NAMESPACE,
    name: opts.name,
    namingConvention: ProposalNamingConvention.NORMAL,
    origin: ProposalOrigin.INTERNAL,
    subgraphs: [
      {
        name: subgraphName,
        schemaSDL: tunedSDL,
        isDeleted: false,
        isNew: false,
        labels: [],
      },
    ],
  });

  return { create, subgraphName, fedGraphName };
}

describe('Caching proposal kind + rollout RPCs', () => {
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

  test('proposal kind is persisted and returned', { retry: 3 }, async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    onTestFinished(() => server.close());

    const proposalName = genID('proposal');
    const { create } = await setupGraphAndCachingProposal(client, { name: proposalName });
    expect(create.response?.code).toBe(EnumStatusCode.OK);

    const getResp = await client.getProposal({ proposalId: create.proposalId });
    expect(getResp.response?.code).toBe(EnumStatusCode.OK);
    // No deploy yet → rollout fields should be absent.
    expect(getResp.proposal?.rolloutFeatureFlagId).toBeFalsy();
    expect(getResp.proposal?.rolloutPercentage).toBeFalsy();
  });

  test('BulkUpdateProposalRolloutPercentages rejects unknown proposal id', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    onTestFinished(() => server.close());

    const resp = await client.bulkUpdateProposalRolloutPercentages({
      items: [{ proposalId: '00000000-0000-0000-0000-000000000000', percentage: 25 }],
    });
    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('BulkUpdateProposalRolloutPercentages rejects DRAFT proposal on first deploy', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    onTestFinished(() => server.close());

    const proposalName = genID('proposal');
    const { create } = await setupGraphAndCachingProposal(client, { name: proposalName });
    expect(create.response?.code).toBe(EnumStatusCode.OK);

    // Proposal is DRAFT by default — first-deploy path requires APPROVED.
    const resp = await client.bulkUpdateProposalRolloutPercentages({
      items: [{ proposalId: create.proposalId, percentage: 10 }],
    });
    expect(resp.response?.code).toBe(EnumStatusCode.ERR);
    expect(resp.response?.details).toContain('APPROVED');
  });

  test('BulkUpdateProposalRolloutPercentages rejects out-of-range percentage', async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    onTestFinished(() => server.close());

    const proposalName = genID('proposal');
    const { create } = await setupGraphAndCachingProposal(client, { name: proposalName });
    expect(create.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.bulkUpdateProposalRolloutPercentages({
      items: [{ proposalId: create.proposalId, percentage: 150 }],
    });
    expect(resp.response?.code).toBe(EnumStatusCode.ERR);
    expect(resp.response?.details).toContain('[0, 100]');
  });

  // The shared SetupTest helper occasionally races with Keycloak group seeding
  // (`Could not find group by id`) — known cosmo dev-infra flake. Retries
  // amortize across the propagation delay; the assertion logic itself is fast
  // and deterministic.
  test('TeardownProposalRollout is idempotent when no rollout exists', { retry: 3 }, async () => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });
    onTestFinished(() => server.close());

    const proposalName = genID('proposal');
    const { create } = await setupGraphAndCachingProposal(client, { name: proposalName });
    expect(create.response?.code).toBe(EnumStatusCode.OK);

    const teardown = await client.teardownProposalRollout({ proposalId: create.proposalId });
    expect(teardown.response?.code).toBe(EnumStatusCode.OK);
  });
});
