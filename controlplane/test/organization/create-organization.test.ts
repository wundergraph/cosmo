import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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

  test('Should fail when provided a name with only spaces', async () => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: '             ',
      slug: genID('org'),
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('Invalid name. It must be of 3-32 characters in length.');

    await server.close();
  });

  test('Should fail when provided a name that is too short', async () => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: 'aa',
      slug: genID('org'),
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('Invalid name. It must be of 3-32 characters in length.');

    await server.close();
  });

  test('Should fail when provided a name that is too long', async () => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: 'a'.repeat(50),
      slug: genID('org'),
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('Invalid name. It must be of 3-32 characters in length.');

    await server.close();
  });

  test('Should fail when provided a slug with only spaces', async () => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: genID('org'),
      slug: '          ',
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('Slug should start and end with an alphanumeric character. Spaces and special characters other that hyphen not allowed.');

    await server.close();
  });

  test.each(['login', 'create', 'signup'])('Should fail when creating an organization with the reserved slug "%s"', async (slug) => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: genID('org'),
      slug,
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('This slug is a reserved keyword.');

    await server.close();
  })

  test('Should fail when provided a slug that is too short', async () => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: genID('org'),
      slug: 'aa',
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('Invalid slug. It must be of 3-32 characters in length, start and end with an alphanumeric character and may contain hyphens in between.');

    await server.close();
  });

  test('Should fail when provided a slug that is too long', async () => {
    const { client, server } = await SetupTest({ dbname, });
    const createOrganizationResponse = await client.createOrganization({
      name: genID('org'),
      slug: 'a'.repeat(50),
      plan: 'developer',
    });

    expect(createOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(createOrganizationResponse.response?.details).toBe('Invalid slug. It must be of 3-32 characters in length, start and end with an alphanumeric character and may contain hyphens in between.');

    await server.close();
  });
});