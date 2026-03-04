import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
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

  test('that an organization admin can invite other users to the organization', async () => {
    const { authenticator, client, mailerClient, server, users: { adminAliceCompanyA, adminJimCompanyB } } = await SetupTest({ dbname, enableMultiUsers: true, });

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

    await server.close();
  });

  test('that an organization developer cannot invite other users to the organization', async () => {
    const { authenticator, client, mailerClient, server, users: { devJoeCompanyA, adminJimCompanyB } } = await SetupTest({ dbname, enableMultiUsers: true, });

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

    await server.close();
  });

  test('that an organization admin can remove a user invitation', async () => {
    const { authenticator, client, mailerClient, server, users: { adminAliceCompanyA, adminJimCompanyB } } = await SetupTest({ dbname, enableMultiUsers: true, });

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

    await server.close();
  });

  test('that an organization developer cannot remove a user invitation', async () => {
    const { authenticator, client, mailerClient, server, users: { adminAliceCompanyA, devJoeCompanyA, adminJimCompanyB } } = await SetupTest({ dbname, enableMultiUsers: true, });

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

    await server.close();
  });
});