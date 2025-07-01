import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID, TestUser } from '../src/core/test-util.js';
import { GroupMapper } from "../../connect/src/wg/cosmo/platform/v1/platform_pb.js";
import { OrganizationGroupRepository } from "../src/core/repositories/OrganizationGroupRepository.js";
import { createOrganizationGroup, SetupTest } from './test-util.js';

let dbname = '';

describe('Organization Group tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should not be able to create group when RBAC not is enabled', async () => {
    const { client, server } = await SetupTest({ dbname });

    const createdGroupResponse = await client.createOrganizationGroup({
      name: genID('group'),
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
      name: genID('group'),
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
    const adminGroup = orgGroups.groups.find((g) => g.builtin)!;

    const updateResponse = await client.updateOrganizationGroup({
      groupId: adminGroup.groupId,
      rules: [{
        role: 'organization-admin',
        namespaces: [],
        resources: [],
      }],
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.ERR);

    await server.close();
  });

  test('Should not be able to delete builtin group', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.builtin)!;

    const deleteResponse = await client.deleteOrganizationGroup({
      groupId: adminGroup.groupId,
    });

    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR);

    await server.close();
  });

  test('Should be able to update existing group', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const group = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });
    expect(group.rules.length).toBe(1);
    expect(group.rules[0].role).toBe('organization-admin');

    await server.close();
  });

  test('Should be able to delete group', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const group = await createOrganizationGroup(client, genID('group'));
    const deleteGroupResponse = await client.deleteOrganizationGroup({ groupId: group.groupId, });

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be able to delete group with members', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);

    const group = await createOrganizationGroup(client, genID('group'));

    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groups: [group.groupId],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const deleteGroupResponse = await client.deleteOrganizationGroup({ groupId: group.groupId });

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(deleteGroupResponse.response?.details).toBe("No group to move existing members and mappers to was provided");

    await server.close();
  });

  test('that a failure is returned when updating a member to a group owned by a different organization', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    const orgGroupRepo = new OrganizationGroupRepository(server.db);
    const companyBId = users.adminJimCompanyB!.organizationId;
    const admin = await orgGroupRepo.byName({ organizationId: companyBId, name: 'admin', });

    expect(admin).toBeDefined();

    authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);

    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groups: [admin!.groupId],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateGroupResponse.response?.details).toBe("One of the submitted groups is not part of this organization");

    await server.close();
  });

  test('that a failure is returned when updating a member to non-existent group', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);
    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groups: ['eca6ae62-3ed2-4115-aa20-513b49031eb8'],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateGroupResponse.response?.details).toBe("One of the submitted groups is not part of this organization");

    await server.close();
  });

  test('that a failure is returned when updating a member without providing any group', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);
    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groups: [],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateGroupResponse.response?.details).toBe("The organization member must have at least one group");

    await server.close();
  });

  test('Deleting a group should delete it from Keycloak too', async () => {
    const { client, server, keycloakClient, realm } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    const group = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });

    let kcGroup = await keycloakClient.client.groups.find({ realm, search: group.name, });
    expect(kcGroup).toHaveLength(1);

    const deleteGroupResponse = await client.deleteOrganizationGroup({ groupId: group.groupId });
    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    kcGroup = await keycloakClient.client.groups.find({ realm, search: group.name, });
    expect(kcGroup).toHaveLength(0);

    await server.close();
  });

  test('Should move members to target group when deleting group', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);

    const orgGroups = await client.getOrganizationGroups({});
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const group = await createOrganizationGroup(client, genID('group'));

    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.adminBobCompanyA?.userId,
      groups: [group.groupId],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    const deleteGroupResponse = await client.deleteOrganizationGroup({
      groupId: group.groupId,
      toGroupId: developerGroup.groupId,
    });

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should be possible to delete a group when an OIDC have been linked to the organization', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    // Create a new group
    const createGroupResponse = await client.createOrganizationGroup({
      name: genID('group'),
      description: '',
    });

    expect(createGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a new OIDC
    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [],
      name: 'okta',
    });

    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    // Deleting the group should not fail
    const deleteGroupResponse = await client.deleteOrganizationGroup({
      groupId: createGroupResponse.group!.groupId,
    });

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be able to delete a group that has been linked to an OIDC mapper', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    // Create a new group
    const createGroupResponse = await client.createOrganizationGroup({
      name: genID('group'),
      description: '',
    });

    expect(createGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a new OIDC
    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: createGroupResponse.group!.groupId,
          ssoGroup: createGroupResponse.group!.name,
        }),
      ],
      name: 'okta',
    });

    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    // Deleting the group should fail because there is a mapper for it
    const deleteGroupResponse = await client.deleteOrganizationGroup({
      groupId: createGroupResponse.group!.groupId,
    });

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(deleteGroupResponse.response?.details).toBe('No group to move existing members and mappers to was provided');

    await server.close();
  });

  test('Should be able to update mapper when OIDC is connected', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    // Create a new group
    const createGroupResponse = await client.createOrganizationGroup({
      name: genID('group'),
      description: '',
    });

    expect(createGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Create a new OIDC
    const oidcName = genID('oidc');
    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: createGroupResponse.group!.groupId,
          ssoGroup: createGroupResponse.group!.name,
        }),
      ],
      name: oidcName,
    });

    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    // Should delete the group and update the mapper
    const deleteGroupResponse = await client.deleteOrganizationGroup({
      groupId: createGroupResponse.group!.groupId,
      toGroupId: adminGroup.groupId,
    });

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that the mapper was updated
    const getProviderResponse = await client.getOIDCProvider({});
    expect(getProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const mapper = getProviderResponse.mappers?.find((m) => m.groupId === adminGroup.groupId);

    expect(getProviderResponse.mappers).toHaveLength(1);
    expect(mapper).toBeDefined();

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

  test('Should be able to update member group', async () => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.devJoeCompanyA?.userId,
      groups: [adminGroup.groupId],
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

  test('Non admin should not be able update user groups', async () => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    authenticator.changeUser(TestUser.devJoeCompanyA)

    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groups: [developerGroup.groupId],
    });
    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(updateGroupResponse.response?.details).toBe('The user does not have the permissions to perform this operation',);

    await server.close();
  });
});

describe('Multiple group membership tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to add and remove member from multiple groups', async () => {
    const { client, server, users, keycloakClient, realm } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['rbac'] });

    const group1 = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });
    const group2 = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });
    const group3 = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });

    let updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groups: [group1.groupId, group2.groupId, group3.groupId],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure the member have the corresponding groups in our database
    let getOrganizationMembersResponse = await client.getOrganizationMembers({});
    expect(getOrganizationMembersResponse.response?.code).toBe(EnumStatusCode.OK);

    let orgMember = getOrganizationMembersResponse.members.find((m) => m.userID === users.viewerTimCompanyA?.userId);

    expect(orgMember).toBeDefined();
    expect(orgMember!.groups).toHaveLength(3);
    expect(orgMember!.groups.find((group) => group.groupId === group1.groupId)).toBeDefined();
    expect(orgMember!.groups.find((group) => group.groupId === group2.groupId)).toBeDefined();
    expect(orgMember!.groups.find((group) => group.groupId === group3.groupId)).toBeDefined();

    // Ensure the user have the corresponding groups on Keycloak
    let orgRootGroup = `/${users.viewerTimCompanyA?.organizationSlug}`;
    let kcUserGroups = await keycloakClient.getKeycloakUserGroups({
      realm,
      userID: users.viewerTimCompanyA!.userId,
    });

    expect(kcUserGroups).toHaveLength(3);
    expect(kcUserGroups.find((group) => group.path === `${orgRootGroup}/${group1.name}`)).toBeDefined();
    expect(kcUserGroups.find((group) => group.path === `${orgRootGroup}/${group2.name}`)).toBeDefined();
    expect(kcUserGroups.find((group) => group.path === `${orgRootGroup}/${group3.name}`)).toBeDefined();

    // Remove the member from multiple groups
    updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groups: [group3.groupId],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure the member have the corresponding groups in our database
    getOrganizationMembersResponse = await client.getOrganizationMembers({});
    expect(getOrganizationMembersResponse.response?.code).toBe(EnumStatusCode.OK);

    orgMember = getOrganizationMembersResponse.members.find((m) => m.userID === users.viewerTimCompanyA?.userId);

    expect(orgMember).toBeDefined();
    expect(orgMember!.groups).toHaveLength(1);
    expect(orgMember!.groups.find((group) => group.groupId === group3.groupId)).toBeDefined();

    // Ensure the user have the corresponding groups on Keycloak
    orgRootGroup = `/${users.viewerTimCompanyA?.organizationSlug}`;
    kcUserGroups = await keycloakClient.getKeycloakUserGroups({
      realm,
      userID: users.viewerTimCompanyA!.userId,
    });

    expect(kcUserGroups).toHaveLength(1);
    expect(kcUserGroups.find((group) => group.path === `${orgRootGroup}/${group3.name}`)).toBeDefined();

    await server.close();
  });

  test('Should not fail when moving a group member to a group they already belong to', async () => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['rbac'] });

    const group1 = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });
    const group2 = await createOrganizationGroup(client, genID('group'), { role: 'organization-admin' });

    const updateGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.viewerTimCompanyA?.userId,
      groups: [group1.groupId, group2.groupId],
    });

    expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Delete one of the groups
    const deleteGroupResponse = await client.deleteOrganizationGroup({
      groupId: group2.groupId,
      toGroupId: group1.groupId,
    })

    expect(deleteGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure the member only have one group
    const getOrganizationGroupMembersResponse = await client.getOrganizationGroupMembers({
      groupId: group1.groupId,
    });

    expect(getOrganizationGroupMembersResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOrganizationGroupMembersResponse.members.find(
      (m) => m.id === users.viewerTimCompanyA?.userId)
    ).toBeDefined();

    await server.close();
  });
});
