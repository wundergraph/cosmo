import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { uid } from "uid";
import { afterAllSetup, beforeAllSetup, TestUser } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Organization Group tests', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should not be able to create group when RBAC not is enabled', async () => {
    const { client, server } = await SetupTest({ dbname });

    const createdGroupResponse = await client.createOrganizationGroup({
      name: uid(),
      description: '',
    });

    expect(createdGroupResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);

    const groupsResponse = await client.getOrganizationGroups({});

    expect(groupsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(groupsResponse.groups.length).toBe(3);

    await server.close();
  });

  test('Should be able to create group when RBAC is enabled', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const createdGroupResponse = await client.createOrganizationGroup({
      name: uid(),
      description: '',
    });

    expect(createdGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const groupsResponse = await client.getOrganizationGroups({});

    expect(groupsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(groupsResponse.groups.length).toBe(4);

    await server.close();
  });

  test('Should not be able to update builtin group', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const orgGroups = await client.getOrganizationGroups({});
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const updateResponse = await client.updateOrganizationGroup({
      groupId: developerGroup.groupId,
      rules: [{
        role: 'organization-admin',
        namespaces: [],
        resources: [],
      }],
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.ERR);

    await server.close();
  });

  test('Should be able to update existing group', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const createdGroupResponse = await client.createOrganizationGroup({
      name: uid(),
      description: '',
    });

    expect(createdGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateResponse = await client.updateOrganizationGroup({
      groupId: createdGroupResponse.group?.groupId,
      rules: [{
        role: 'organization-admin',
        namespaces: [],
        resources: [],
      }],
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const updatedGroupsResponse = await client.getOrganizationGroups({});
    const updatedDeveloperGroup = updatedGroupsResponse.groups.find((g) => g.groupId === createdGroupResponse.group?.groupId)!;

    expect(updatedDeveloperGroup.rules.length).toBe(1);
    expect(updatedDeveloperGroup.rules[0].role).toBe('organization-admin');

    await server.close();
  });
});

describe('Group membership tests', () => {
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
