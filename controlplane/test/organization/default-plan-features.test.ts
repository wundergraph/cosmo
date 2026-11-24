import { randomUUID, type UUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SetupTest } from '../test-util.js';
import { TEST_DIRECT_GRANT_CLIENT_ID } from '../keycloak-test-utils.js';
import { afterAllSetup, beforeAllSetup, createTestContext, genID, TestUser } from '../../src/core/test-util.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';

describe('Default plan features of a new organization', () => {
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('every way an organization is created gives it proposals and groups from the enterprise default plan', async (testContext) => {
    vi.stubEnv('DEFAULT_PLAN', 'enterprise');
    testContext.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const { client, server, authenticator, keycloakClient, realm } = await SetupTest({
      dbname,
      billingDefaultPlanId: 'enterprise',
    });
    testContext.onTestFinished(() => server.close());

    // Seeded by the repository before the billing plans exist, as the chart's seed job and bin/trial.ts create one.
    authenticator.changeUser(TestUser.adminAliceCompanyA);
    const seededResponse = await client.enableProposalsForNamespace({ namespace: 'default', enableProposals: true });
    expect(seededResponse.response?.code).toBe(EnumStatusCode.OK);

    // Created over the API by a signed-in user, as Hub does.
    const slug = genID('org');
    const createResponse = await client.createOrganization({ name: slug, slug, plan: '' });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);
    const createdId = createResponse.organization!.id as UUID;

    authenticator.changeUserWithSuppliedContext(createTestContext(slug, createdId));
    const createdProposals = await client.enableProposalsForNamespace({ namespace: 'default', enableProposals: true });
    expect(createdProposals.response?.code).toBe(EnumStatusCode.OK);
    const createdGroup = await client.createOrganizationGroup({ name: 'reviewers', description: '' });
    expect(createdGroup.response?.code).toBe(EnumStatusCode.OK);

    // Created on a new user's first sign-in.
    const email = `${randomUUID()}@wg.com`;
    const { id: keycloakUserId } = await keycloakClient.client.users.create({
      realm,
      email,
      enabled: true,
      emailVerified: true,
      firstName: 'New',
      lastName: 'User',
      credentials: [{ type: 'password', value: 'wunder@123', temporary: false }],
    });
    const tokenResponse = await fetch(`${keycloakClient.client.baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: TEST_DIRECT_GRANT_CLIENT_ID,
        username: email,
        password: 'wunder@123',
        scope: 'openid',
      }),
    });
    const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
    const initializeResponse = await client.initializeCosmoUser({ token });
    expect(initializeResponse.response?.code).toBe(EnumStatusCode.OK);

    const [signInOrganization] = await new OrganizationRepository(server.log, server.db).memberships({
      userId: keycloakUserId,
    });
    authenticator.changeUserWithSuppliedContext(
      createTestContext(signInOrganization.slug, signInOrganization.id as UUID),
    );
    const signInProposals = await client.enableProposalsForNamespace({ namespace: 'default', enableProposals: true });
    expect(signInProposals.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    expect(await orgRepo.getFeature({ organizationId: createdId, featureId: 'federated-graphs' })).toEqual({
      id: 'federated-graphs',
      enabled: true,
      limit: -1,
    });
    expect(await orgRepo.getFeature({ organizationId: createdId, featureId: 'users' })).toEqual({
      id: 'users',
      enabled: true,
      limit: -1,
    });
  });

  test('an organization created without a default plan has no RBAC', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const slug = genID('org');
    const createResponse = await client.createOrganization({ name: slug, slug, plan: 'developer' });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);
    const organizationId = createResponse.organization!.id as UUID;

    authenticator.changeUserWithSuppliedContext(createTestContext(slug, organizationId));
    const groupResponse = await client.createOrganizationGroup({ name: 'reviewers', description: '' });
    expect(groupResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
  });
});
