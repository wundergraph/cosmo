import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueueEvents } from 'bullmq';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
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

describe('Delete Organization', (ctx) => {
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

  test('should queue org deletion and delete after scheduled', async (testContext) => {
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

    const job = await orgRepo.queueOrganizationDeletion({
      organizationId: org!.id,
      queuedBy: mainUserContext.userDisplayName,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    await job.changeDelay(0);
    await job.waitUntilFinished(new QueueEvents(job.queueName));

    const graphsRes = await client.getFederatedGraphs({});
    expect(graphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsRes.graphs.length).toBe(0);

    const subgraphsRes = await client.getSubgraphs({});
    expect(subgraphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsRes.graphs.length).toBe(0);

    const orgAfterDeletion = await orgRepo.bySlug(orgName);
    expect(orgAfterDeletion).toBeNull();

    expect(blobStorage.keys().includes(graphKey)).toEqual(false);

    await worker.close();

    await server.close();
  });

  test('Should delete OIDC when deleting org', async (testContext) => {
    const { client, server, keycloakClient, realm, users, authenticator, queues, blobStorage } = await SetupTest({
      dbname,
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

    const createOIDCRes = await client.createOIDCProvider({
      clientID: '123',
      clientSecrect: '345',
      discoveryEndpoint: `http://localhost:8080/realms/${realm}/.well-known/openid-configuration`,
      mappers: [],
    });
    expect(createOIDCRes.response?.code).toBe(EnumStatusCode.OK);

    const oidcRepo = new OidcRepository(server.db);
    const provider = await oidcRepo.getOidcProvider({ organizationId: org!.id });
    expect(provider).toBeDefined();

    const worker = createDeleteOrganizationWorker({
      redisConnection: server.redisForWorker,
      db: server.db,
      logger: server.log,
      keycloakClient,
      keycloakRealm: realm,
      blobStorage,
      deleteOrganizationAuditLogsQueue: queues.deleteOrganizationAuditLogsQueue,
    });

    const job = await orgRepo.queueOrganizationDeletion({
      organizationId: org!.id,
      queuedBy: mainUserContext.userDisplayName,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    await job.changeDelay(0);
    await job.waitUntilFinished(new QueueEvents(job.queueName));

    const provider2 = await oidcRepo.getOidcProvider({ organizationId: org!.id });
    expect(provider2).toBeUndefined();
    const idp2 = await keycloakClient.client.identityProviders.findOne({
      alias: provider!.alias,
      realm,
    });
    expect(idp2).toBeNull();

    const orgAfterDeletion = await orgRepo.bySlug(orgName);
    expect(orgAfterDeletion).toBeNull();

    await worker.close();

    await server.close();
  });

  test('Should delete organization and Keycloak groups and roles', async (testContext) => {
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

    const worker = createDeleteOrganizationWorker({
      redisConnection: server.redisForWorker,
      db: server.db,
      logger: server.log,
      keycloakClient,
      keycloakRealm: realm,
      blobStorage,
      deleteOrganizationAuditLogsQueue: queues.deleteOrganizationAuditLogsQueue,
    });

    const job = await orgRepo.queueOrganizationDeletion({
      organizationId: org!.id,
      queuedBy: mainUserContext.userDisplayName,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    await job.changeDelay(0);
    await job.waitUntilFinished(new QueueEvents(job.queueName));

    // Ensure that all organization groups are deleted
    const kcOrgGroup = await keycloakClient.client.groups.findOne({ realm, id: org!.kcGroupId! });
    expect(kcOrgGroup).toBeNull();

    const kcOrgSubgroups = await keycloakClient.fetchAllSubGroups({ realm, kcGroupId: org!.kcGroupId! });
    expect(kcOrgSubgroups).toBeNull();

    // Ensure that all organization roles are deleted
    const kcOrgRoles = await keycloakClient.client.roles.find({
      realm,
      max: -1,
      search: `${org!.slug}:`,
    });

    expect(kcOrgRoles).toHaveLength(0);

    await worker.close();

    await server.close();
  });
});
