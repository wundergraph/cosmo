import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { SetupTest } from '../test-util.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';

describe('isMemberOf', () => {
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return true when user is an active member of the organization', async () => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(users.adminAliceCompanyA.organizationSlug);

    expect(org).toBeDefined();

    const isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: users.adminAliceCompanyA.userId,
    });

    expect(isMember).toBe(true);

    await server.close();
  });

  test('Should return false when user is not a member of the organization', async () => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(users.adminAliceCompanyA.organizationSlug);

    expect(org).toBeDefined();
    expect(users.adminJimCompanyB).toBeDefined();

    // adminJimCompanyB is from a different organization (company-b)
    const isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: users.adminJimCompanyB!.userId,
    });

    expect(isMember).toBe(false);

    await server.close();
  });

  test('Should return false when user is a member but inactive', async () => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(users.adminAliceCompanyA.organizationSlug);

    expect(org).toBeDefined();
    expect(users.devJoeCompanyA).toBeDefined();

    // Verify devJoeCompanyA is initially an active member
    let isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: users.devJoeCompanyA!.userId,
    });
    expect(isMember).toBe(true);

    // Get the organization member record
    const orgMembers = await orgRepo.getMembers({
      organizationID: org!.id,
    });
    const devJoeMember = orgMembers.find((m) => m.userID === users.devJoeCompanyA!.userId);
    expect(devJoeMember).toBeDefined();

    // Deactivate the member
    await orgRepo.setOrganizationMemberActive({
      id: devJoeMember!.orgMemberID,
      organizationId: org!.id,
      active: false,
    });

    // Verify isMemberOf now returns false
    isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: users.devJoeCompanyA!.userId,
    });
    expect(isMember).toBe(false);

    await server.close();
  });

  test('Should return true when inactive member is reactivated', async () => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(users.adminAliceCompanyA.organizationSlug);

    expect(org).toBeDefined();
    expect(users.devJoeCompanyA).toBeDefined();

    // Get the organization member record
    const orgMembers = await orgRepo.getMembers({
      organizationID: org!.id,
    });
    const devJoeMember = orgMembers.find((m) => m.userID === users.devJoeCompanyA!.userId);
    expect(devJoeMember).toBeDefined();

    // Deactivate the member
    await orgRepo.setOrganizationMemberActive({
      id: devJoeMember!.orgMemberID,
      organizationId: org!.id,
      active: false,
    });

    // Verify isMemberOf returns false
    let isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: users.devJoeCompanyA!.userId,
    });
    expect(isMember).toBe(false);

    // Reactivate the member
    await orgRepo.setOrganizationMemberActive({
      id: devJoeMember!.orgMemberID,
      organizationId: org!.id,
      active: true,
    });

    // Verify isMemberOf now returns true
    isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: users.devJoeCompanyA!.userId,
    });
    expect(isMember).toBe(true);

    await server.close();
  });

  test('Should return false for non-existent user', async () => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(users.adminAliceCompanyA.organizationSlug);

    expect(org).toBeDefined();

    const nonExistentUserId = randomUUID();
    const isMember = await orgRepo.isMemberOf({
      organizationId: org!.id,
      userId: nonExistentUserId,
    });

    expect(isMember).toBe(false);

    await server.close();
  });

  test('Should return false for non-existent organization', async () => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);

    const nonExistentOrgId = randomUUID();
    const isMember = await orgRepo.isMemberOf({
      organizationId: nonExistentOrgId,
      userId: users.adminAliceCompanyA.userId,
    });

    expect(isMember).toBe(false);

    await server.close();
  });
});
