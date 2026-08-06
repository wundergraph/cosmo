import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('InviteUsers', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an organization admin can batch invite users', async (testContext) => {
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

    const resp = await client.inviteUsers({
      emails: [adminJimCompanyB!.email],
      groups: [developer!.groupId],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.invitationErrors).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();

    const pendingResp = await client.getPendingOrganizationMembers({});
    expect(pendingResp.response?.code).toBe(EnumStatusCode.OK);
    const existing = pendingResp.pendingInvitations.find((inv) => inv.email === adminJimCompanyB!.email);
    expect(existing).toBeDefined();
  });

  test('that a developer cannot batch invite users', async (testContext) => {
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

    const resp = await client.inviteUsers({
      emails: [adminJimCompanyB!.email],
      groups: [],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(spy).not.toHaveBeenCalled();
  });

  test('that a viewer cannot batch invite users', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { viewerTimCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(viewerTimCompanyA!);

    const resp = await client.inviteUsers({
      emails: [adminJimCompanyB!.email],
      groups: [],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(spy).not.toHaveBeenCalled();
  });

  test('that inviteUsers returns invitationErrors for invalid group', async (testContext) => {
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

    // Use a non-existent group ID to trigger per-email error
    const resp = await client.inviteUsers({
      emails: [adminJimCompanyB!.email],
      groups: ['00000000-0000-0000-0000-000000000000'],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.invitationErrors.length).toBeGreaterThanOrEqual(1);
    expect(resp.invitationErrors[0].email).toBe(adminJimCompanyB!.email);
    expect(resp.invitationErrors[0].error).toBeTruthy();
  });

  test('that inviteUsers with empty emails returns OK with no errors', async (testContext) => {
    const {
      authenticator,
      client,
      server,
      users: { adminAliceCompanyA },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    const resp = await client.inviteUsers({
      emails: [],
      groups: [],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.invitationErrors).toHaveLength(0);
  });

  test('that another admin of the same org can batch invite users', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminBobCompanyA, adminJimCompanyB },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminBobCompanyA!);

    const orgGroupsResponse = await client.getOrganizationGroups({});
    const developer = orgGroupsResponse.groups.find((g) => g.name === 'developer');
    expect(developer).toBeDefined();

    const resp = await client.inviteUsers({
      emails: [adminJimCompanyB!.email],
      groups: [developer!.groupId],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.invitationErrors).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();
  });

  test('that inviteUsers rejects batch exceeding maximum size', async (testContext) => {
    const {
      authenticator,
      client,
      mailerClient,
      server,
      users: { adminAliceCompanyA },
    } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const spy = vi.spyOn(mailerClient, 'sendInviteEmail');
    spy.mockImplementation(vi.fn());

    authenticator.changeUserWithSuppliedContext(adminAliceCompanyA!);

    // Create 6 email addresses to exceed the maximum batch size of 5
    const emails = Array.from({ length: 6 }, (_, i) => `user${i}@example.com`);

    const resp = await client.inviteUsers({
      emails,
      groups: [],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
    expect(resp.invitationErrors).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
