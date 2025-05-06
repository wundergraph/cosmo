import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, TestUser } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Organization Member Role tests', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to promote developer to admin', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const updateRoleResponse = await client.updateOrgMemberRole({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.devJoeCompanyA?.userId,
      role: 'admin',
    });
    expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.devJoeCompanyA?.userId);
    expect(orgMemberUpdated?.roles).toHaveLength(1);
    expect(orgMemberUpdated?.roles).toContain('admin');

    await server.close();
  });

  test('Should be able to promote viewer to admin', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const updateRoleResponse = await client.updateOrgMemberRole({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      role: 'admin',
    });
    expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.viewerTimCompanyA?.userId);
    expect(orgMemberUpdated?.roles).toHaveLength(1);
    expect(orgMemberUpdated?.roles).toContain('admin');

    await server.close();
  });

  test('Should be able to promote viewer to developer', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const updateRoleResponse = await client.updateOrgMemberRole({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      role: 'developer',
    });
    expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.viewerTimCompanyA?.userId);
    expect(orgMemberUpdated?.roles).toHaveLength(1);
    expect(orgMemberUpdated?.roles).toContain('developer');

    await server.close();
  });

  test('Should be able to demote admin to developer', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const updateRoleResponse = await client.updateOrgMemberRole({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.adminBobCompanyA?.userId,
      role: 'developer',
    });
    expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.adminBobCompanyA?.userId);
    expect(orgMemberUpdated?.roles).toHaveLength(1);
    expect(orgMemberUpdated?.roles).toContain('developer');

    await server.close();
  });

    test('Should be able to demote admin to viewer', async (testContext) => {
      const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

      const updateRoleResponse = await client.updateOrgMemberRole({
        userID: users.adminAliceCompanyA?.userId,
        orgMemberUserID: users.adminBobCompanyA?.userId,
        role: 'viewer',
      });
      expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.OK);

      const orgMembersResponse = await client.getOrganizationMembers({});
      expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(orgMembersResponse.members).toHaveLength(4);

      const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.adminBobCompanyA?.userId);
      expect(orgMemberUpdated?.roles).toHaveLength(1);
      expect(orgMemberUpdated?.roles).toContain('viewer');

      await server.close();
    });

    test('Should be able to demote developer to viewer', async (testContext) => {
      const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

      const updateRoleResponse = await client.updateOrgMemberRole({
        userID: users.adminAliceCompanyA?.userId,
        orgMemberUserID: users.devJoeCompanyA?.userId,
        role: 'viewer',
      });
      expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.OK);

      const orgMembersResponse = await client.getOrganizationMembers({});
      expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(orgMembersResponse.members).toHaveLength(4);

      const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.devJoeCompanyA?.userId);
      expect(orgMemberUpdated?.roles).toHaveLength(1);
      expect(orgMemberUpdated?.roles).toContain('viewer');

      await server.close();
    });

    test('Non admin should not be able update user roles', async (testContext) => {
      const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

      authenticator.changeUser(TestUser.devJoeCompanyA)

      const updateRoleResponse = await client.updateOrgMemberRole({
        userID: users.devJoeCompanyA?.userId,
        orgMemberUserID: users.viewerTimCompanyA?.userId,
        role: 'developer',
      });
      expect(updateRoleResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(updateRoleResponse.response?.details).toBe(
        'User does not have the permissions to update the role of an organization member.',
      );

      await server.close();
    });
});
