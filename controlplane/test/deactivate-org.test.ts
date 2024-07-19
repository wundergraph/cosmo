import { setTimeout } from 'node:timers/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, TestUser } from '../src/core/test-util.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { createDeleteOrganizationWorker } from '../src/core/workers/DeleteOrganizationWorker.js';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Deactivate Organization', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should deactivate org by updating roles and scheduling deletion', async (testContext) => {
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

    const roles = await orgRepo.getOrganizationMemberRoles({
      userID: mainUserContext.userId,
      organizationID: org!.id,
    });
    expect(roles).toHaveLength(1);
    expect(roles[0]).toEqual('viewer');

    const provider2 = await oidcRepo.getOidcProvider({ organizationId: org!.id });
    expect(provider2).toBeUndefined();
    const idp2 = await keycloakClient.client.identityProviders.findOne({
      alias: provider!.alias,
      realm,
    });
    expect(idp2).toBeNull();

    await job.changeDelay(0);
    await setTimeout(2000);

    const orgAfterDeletion = await orgRepo.bySlug(orgName);
    expect(orgAfterDeletion).toBeNull();

    await worker.close();

    await server.close();
  });
});
