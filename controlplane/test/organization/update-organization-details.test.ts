import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  TestUser,
} from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('UpdateOrganizationDetails', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should update the organization name', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const whoAmIResponse = await client.whoAmI({});
    expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

    const newName = 'Updated Org Name';

    const response = await client.updateOrganizationDetails({
      organizationName: newName,
      organizationSlug: whoAmIResponse.organizationSlug,
      userID: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const verifyResponse = await client.whoAmI({});
    expect(verifyResponse.organizationName).toBe(newName);
  });

  test('Should update the organization slug', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const whoAmIResponse = await client.whoAmI({});
    expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

    // Slugs are always normalized to lowercase server-side, so generate a lowercase slug
    const newSlug = genID('newslug').toLowerCase();

    const response = await client.updateOrganizationDetails({
      organizationName: whoAmIResponse.organizationName,
      organizationSlug: newSlug,
      userID: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const verifyResponse = await client.whoAmI({});
    expect(verifyResponse.organizationSlug).toBe(newSlug);
  });

  test('Should fail when organization name is invalid (too short)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const whoAmIResponse = await client.whoAmI({});
    expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.updateOrganizationDetails({
      organizationName: 'aa',
      organizationSlug: whoAmIResponse.organizationSlug,
      userID: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('Invalid name. It must be of 3-32 characters in length.');
  });

  test('Should fail when organization name is invalid (too long)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const whoAmIResponse = await client.whoAmI({});
    expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.updateOrganizationDetails({
      organizationName: 'a'.repeat(50),
      organizationSlug: whoAmIResponse.organizationSlug,
      userID: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('Invalid name. It must be of 3-32 characters in length.');
  });

  test('Should fail when slug is already taken', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    // Create another organization to take the slug (slug must be lowercase)
    const otherOrgSlug = genID('other').toLowerCase();
    const createOtherResponse = await client.createOrganization({
      name: otherOrgSlug,
      slug: otherOrgSlug,
      plan: 'developer',
    });
    expect(createOtherResponse.response?.code).toBe(EnumStatusCode.OK);

    const whoAmIResponse = await client.whoAmI({});
    expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.updateOrganizationDetails({
      organizationName: whoAmIResponse.organizationName,
      organizationSlug: otherOrgSlug,
      userID: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(response.response?.details).toContain('already exists');
  });

  test.each([TestUser.devJoeCompanyA, TestUser.viewerTimCompanyA])(
    '%s (non-admin) should NOT be able to update organization details',
    async (testUser) => {
      const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const whoAmIResponse = await client.whoAmI({});
      expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

      // Switch to a user whose stored DB role is non-admin
      authenticator.changeUser(testUser);

      const response = await client.updateOrganizationDetails({
        organizationName: 'New Name',
        organizationSlug: whoAmIResponse.organizationSlug,
        userID: '',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );

  test('organization-admin should be able to update organization details', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const whoAmIResponse = await client.whoAmI({});
    expect(whoAmIResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-admin' })),
    });

    const response = await client.updateOrganizationDetails({
      organizationName: 'Admin Updated Name',
      organizationSlug: whoAmIResponse.organizationSlug,
      userID: '',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });
});
