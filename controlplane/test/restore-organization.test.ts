import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel, TestUser } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { createDeleteOrganizationWorker } from '../src/core/workers/DeleteOrganizationWorker.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Restore Organization', (ctx) => {
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

  test('should removed queued job and keep organization', async () => {
    const { client, server, keycloakClient, realm, users, authenticator, queues, blobStorage } = await SetupTest({
      dbname,
      chClient,
    });
    const mainUserContext = users[TestUser.adminAliceCompanyA];

    const orgName = genID();
    await client.createOrganization({
      name: orgName,
      slug: orgName,
    });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(orgName);
    expect(org).toBeDefined();

    authenticator.changeUserWithSuppliedContext({
      ...mainUserContext,
      organizationId: org!.id,
      organizationName: org!.name,
      organizationSlug: org!.slug,
    });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphRes.subgraphs.length).toBe(1);

    const graphKey = `${org!.id}/${graphRes.graph?.id}/routerconfigs/latest.json`;

    expect(blobStorage.keys().includes(graphKey)).toEqual(true);

    const worker = createDeleteOrganizationWorker({
      redisConnection: server.redisForWorker,
      db: server.db,
      logger: server.log,
      keycloakClient,
      keycloakRealm: realm,
      blobStorage,
      deleteOrganizationAuditLogsQueue: queues.deleteOrganizationAuditLogsQueue,
    });

    await orgRepo.queueOrganizationDeletion({
      organizationId: org!.id,
      queuedBy: mainUserContext.userDisplayName,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    const restoreOrgResult = await client.restoreOrganization({ userID: mainUserContext.userId });
    expect(restoreOrgResult.response?.code).toBe(EnumStatusCode.OK);

    const job = await queues.deleteOrganizationQueue.getJob({ organizationId: org!.id });
    expect(job).toBeUndefined();

    const graphsRes = await client.getFederatedGraphs({});
    expect(graphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsRes.graphs.length).toBe(1);

    const subgraphsRes = await client.getSubgraphs({});
    expect(subgraphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsRes.graphs.length).toBe(1);

    const orgAfterDeletion = await orgRepo.bySlug(orgName);
    expect(orgAfterDeletion).not.toBeNull();

    expect(blobStorage.keys().includes(graphKey)).toEqual(true);

    await worker.close();

    await server.close();
  });
});