import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SetupTest } from '../test-util.js';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';

describe('Create organization', () => {
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should link Keycloak group when a new organization is created', async () => {
    const { client, server, keycloakClient, realm } = await SetupTest({ dbname, });

    const orgName = genID('org');
    const createOrganizationResponse = await client.createOrganization({
      name: orgName,
      slug: orgName,
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.byId(createOrganizationResponse.organization!.id);

    expect(org).toBeDefined();
    expect(org?.kcGroupId).toBeDefined();

    const kcGroup = await keycloakClient.client.groups.findOne({ realm, id: org!.kcGroupId! });
    expect(kcGroup).toBeDefined();
    expect(kcGroup?.subGroupCount).toBe(3);

    await server.close();
  });
});