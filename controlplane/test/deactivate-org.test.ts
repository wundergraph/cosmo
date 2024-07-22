import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { afterAllSetup, beforeAllSetup, genID, TestUser } from '../src/core/test-util.js';
import { createDeleteOrganizationWorker } from '../src/core/workers/DeleteOrganizationWorker.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Deactivate Organization', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should deactivate org and delete after scheduled', async (testContext) => {
    const { client, server, keycloakClient, realm, queues, users, authenticator } = await SetupTest({ dbname });
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

    const idp1 = await keycloakClient.client.identityProviders.findOne({
      alias: provider!.alias,
      realm,
    });
    expect(idp1).toBeDefined();

    const worker = createDeleteOrganizationWorker({
      redisConnection: server.redisForWorker,
      db: server.db,
      logger: server.log,
      keycloakClient,
      keycloakRealm: realm,
    });

    const job = await orgRepo.deactivateOrganization({
      organizationId: org!.id,
      keycloakClient,
      keycloakRealm: realm,
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

  test('Should reactivate org and remove the scheduled deletion', async (testContext) => {
    const { client, server, keycloakClient, realm, queues, users, authenticator } = await SetupTest({ dbname });
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
    });

    await orgRepo.deactivateOrganization({
      organizationId: org!.id,
      keycloakClient,
      keycloakRealm: realm,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    const activeJob = await queues.deleteOrganizationQueue.getJob({
      organizationId: org!.id,
    });
    expect(activeJob).toBeDefined();

    const deactivatedOrg = await orgRepo.bySlug(orgName);
    expect(deactivatedOrg?.deactivation).toBeDefined();

    await orgRepo.reactivateOrganization({
      organizationId: org!.id,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    const removedJob = await queues.deleteOrganizationQueue.getJob({
      organizationId: org!.id,
    });
    expect(removedJob).toBeUndefined();

    const reactivatedOrg = await orgRepo.bySlug(orgName);
    expect(reactivatedOrg?.deactivation).toBeUndefined();

    await worker.close();

    await server.close();
  });
});
