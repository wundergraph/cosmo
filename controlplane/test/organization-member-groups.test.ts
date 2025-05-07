import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, TestUser } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Organization Member Group tests', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to promote developer to admin', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.devJoeCompanyA?.userId,
      groupId: adminGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.devJoeCompanyA?.userId);
    expect(orgMemberUpdated?.groups).toHaveLength(1);
    expect(orgMemberUpdated?.groups[0].name).toBe('admin');

    await server.close();
  });

  test('Should be able to promote viewer to admin', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groupId: adminGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.viewerTimCompanyA?.userId);
    expect(orgMemberUpdated?.groups).toHaveLength(1);
    expect(orgMemberUpdated?.groups[0].name).toBe('admin');

    await server.close();
  });

  test('Should be able to promote viewer to developer', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groupId: developerGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.viewerTimCompanyA?.userId);
    expect(orgMemberUpdated?.groups).toHaveLength(1);
    expect(orgMemberUpdated?.groups[0].name).toContain('developer');

    await server.close();
  });

  test('Should be able to demote admin to developer', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groupId: developerGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.adminBobCompanyA?.userId);
    expect(orgMemberUpdated?.groups).toHaveLength(1);
    expect(orgMemberUpdated?.groups[0].name).toContain('developer');

    await server.close();
  });

  test('Should be able to demote admin to viewer', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const viewerGroup = orgGroups.groups.find((g) => g.name === 'viewer')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groupId: viewerGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.adminBobCompanyA?.userId);
    expect(orgMemberUpdated?.groups).toHaveLength(1);
    expect(orgMemberUpdated?.groups[0].name).toBe('viewer');

    await server.close();
  });

  test('Should be able to demote developer to viewer', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const viewerGroup = orgGroups.groups.find((g) => g.name === 'viewer')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.adminAliceCompanyA?.userId,
      orgMemberUserID: users.devJoeCompanyA?.userId,
      groupId: viewerGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgMembersResponse = await client.getOrganizationMembers({});
    expect(orgMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersResponse.members).toHaveLength(4);

    const orgMemberUpdated = orgMembersResponse.members.find((m) => m.userID === users.devJoeCompanyA?.userId);
    expect(orgMemberUpdated?.groups).toHaveLength(1);
    expect(orgMemberUpdated?.groups[0].name).toBe('viewer');

    await server.close();
  });

  test('Non admin should not be able update user groups', async (testContext) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    authenticator.changeUser(TestUser.devJoeCompanyA)

    const updateGroupResponse = await client.updateOrgMemberGroup({
      userID: users.devJoeCompanyA?.userId,
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groupId: developerGroup.groupId,
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateGroupResponse.response?.details).toBe(
      'User does not have the permissions to update the group of an organization member.',
    );

    await server.close();
  });
});
