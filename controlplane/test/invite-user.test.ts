import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('InviteUser', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an organization admin can invite other users to the organization', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(spy).toHaveBeenCalledOnce();

    const pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);

    const existing = pendingInvitationsResponse.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();
  });

  test('that an organization developer cannot invite other users to the organization', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { devJoeCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(devJoeCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('that an organization admin can remove a user invitation', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(spy).toHaveBeenCalledOnce();

    let pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);

    const existing = pendingInvitationsResponse.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();

    const removeInvitationResponse = await client.removeInvitation({ email: adminJimCompanyB!.email });
    expect(removeInvitationResponse.response?.code).toBe(EnumStatusCode.OK);

    pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(pendingInvitationsResponse.pendingInvitations.length).toBe(0);
  });

  test('that an organization developer cannot remove a user invitation', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA, devJoeCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(spy).toHaveBeenCalledOnce();

    const pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);

    const existing = pendingInvitationsResponse.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();

    authenticator.changeUserWithSuppliedContext(devJoeCompanyA!);
    const removeInvitationResponse = await client.removeInvitation({ email: adminJimCompanyB!.email });
    expect(removeInvitationResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('that an user can accept an organization invitation successfully', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(spy).toHaveBeenCalledOnce();

    const pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);

    const existing = pendingInvitationsResponse.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();

    // Make sure that the user can see the invitation
    authenticator.changeUserWithSuppliedContext(adminJimCompanyB!);

    const jimInvitationsResponse = await client.getInvitations({});

    expect(jimInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(jimInvitationsResponse.invitations).toHaveLength(1);

    const acceptInviteResponse = await client.acceptOrDeclineInvitation({
      organizationId: adminAliceCompanyA.organizationId,
      accept: true,
    });

    expect(acceptInviteResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that the invitation no-longer shows as pending for the user
    const jimInvitationsResponse2 = await client.getInvitations({});

    expect(jimInvitationsResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(jimInvitationsResponse2.invitations).toHaveLength(0);

    // Make sure that the user have access to both organizations
    const listOrganizationsResponse = await client.listOrganizations({});

    expect(listOrganizationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(listOrganizationsResponse.organizations).toHaveLength(2);
  });

  test('that an user can reject an organization invitation successfully', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(spy).toHaveBeenCalledOnce();

    const pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);

    const existing = pendingInvitationsResponse.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();

    // Make sure that the user can see the invitation
    authenticator.changeUserWithSuppliedContext(adminJimCompanyB!);

    const jimInvitationsResponse = await client.getInvitations({});

    expect(jimInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(jimInvitationsResponse.invitations).toHaveLength(1);

    const acceptInviteResponse = await client.acceptOrDeclineInvitation({
      organizationId: adminAliceCompanyA.organizationId,
      accept: false,
    });

    expect(acceptInviteResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that the invitation no-longer shows as pending for the user
    const jimInvitationsResponse2 = await client.getInvitations({});

    expect(jimInvitationsResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(jimInvitationsResponse2.invitations).toHaveLength(0);

    // Make sure that the user didn't join the organization
    const listOrganizationsResponse = await client.listOrganizations({});

    expect(listOrganizationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(listOrganizationsResponse.organizations).toHaveLength(1);
  });

  // This test is related to organizations that started using SCIM after already having users added as part of the
  // organizations, SCIM still sent the invitation but the user was unable to accept it as they already were
  // members of the organization

  test('that an user who is part of an organization can still accept invitations successfully', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const inviteUserResponse = await client.inviteUser({
      email: adminJimCompanyB!.email,
      groups: [developer!.groupId],
    });

    expect(inviteUserResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(spy).toHaveBeenCalledOnce();

    const pendingInvitationsResponse = await client.getPendingOrganizationMembers({});
    expect(pendingInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);

    const existing = pendingInvitationsResponse.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();

    // Add the user to the organization
    const orgMemberRepo = new OrganizationRepository(server.log, server.db);

    await orgMemberRepo.addOrganizationMember({
      userID: adminJimCompanyB!.userId,
      organizationID: adminAliceCompanyA.organizationId,
    });

    // Make sure that the user can see the invitation
    authenticator.changeUserWithSuppliedContext(adminJimCompanyB!);

    const jimInvitationsResponse = await client.getInvitations({});

    expect(jimInvitationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(jimInvitationsResponse.invitations).toHaveLength(1);

    const acceptInviteResponse = await client.acceptOrDeclineInvitation({
      organizationId: adminAliceCompanyA.organizationId,
      accept: true,
    });

    expect(acceptInviteResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that the invitation no-longer shows as pending for the user
    const jimInvitationsResponse2 = await client.getInvitations({});

    expect(jimInvitationsResponse2.response?.code).toBe(EnumStatusCode.OK);
    expect(jimInvitationsResponse2.invitations).toHaveLength(0);

    // Make sure that the user didn't join the organization
    const listOrganizationsResponse = await client.listOrganizations({});

    expect(listOrganizationsResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(listOrganizationsResponse.organizations).toHaveLength(2);

    const members = await orgMemberRepo.getMembers({
      organizationID: adminAliceCompanyA.organizationId,
    });
    expect(members.filter((m) => m.userID === adminJimCompanyB!.userId)).toHaveLength(1);
  });
});
