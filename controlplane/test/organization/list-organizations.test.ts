import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SetupTest } from '../test-util.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';

describe('listOrganizations', () => {
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that the list of user organizations is returned successfully', async () => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const listOrganizationsResponse = await client.listOrganizations({});
    expect(listOrganizationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(listOrganizationsResponse.organizations.length).toBe(1);
    expect(listOrganizationsResponse.organizations[0].id).toBe(users.adminAliceCompanyA.organizationId);

    await server.close();
  });
});