import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { SetupTest } from './../test-util.js';

let dbname = '';

describe('Remove organization member', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an organization admin can remove a member from the organization', async () => {
    const { authenticator, client, server, users: { adminAliceCompanyA, adminBobCompanyA } } = await SetupTest({ dbname, enableMultiUsers: true, });

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    let orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members.length).toBe(4);

    const removeMemberResponse = await client.removeOrganizationMember({ email: adminBobCompanyA!.email });
    expect(removeMemberResponse.response?.code).toBe(EnumStatusCode.OK);

    orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members.length).toBe(3);

    await server.close();
  });

  test('that an organization developer cannot remove a member from the organization', async () => {
    const { authenticator, client, server, users: { adminAliceCompanyA, devJoeCompanyA, adminBobCompanyA } } = await SetupTest({ dbname, enableMultiUsers: true, });

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    let orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members.length).toBe(4);

    authenticator.changeUserWithSuppliedContext(devJoeCompanyA!);

    const removeMemberResponse = await client.removeOrganizationMember({ email: adminBobCompanyA!.email });
    expect(removeMemberResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members.length).toBe(4);

    await server.close();
  });
});