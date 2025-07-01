import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SetupTest } from '../test-util.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';
import { OrganizationGroupRepository } from "../../src/core/repositories/OrganizationGroupRepository.js";

describe('Leave organization', () => {
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should remove member from organization groups when leaving', async () => {
    const { client, server, keycloakClient, realm, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const orgGroupRepo = new OrganizationGroupRepository(server.db);

    const org = await orgRepo.bySlug(users.adminAliceCompanyA.organizationSlug);
    const orgGroup = await orgGroupRepo.byName({ organizationId: org!.id, name: 'viewer' });

    expect(org).toBeDefined();
    expect(org?.kcGroupId).toBeDefined();
    expect(orgGroup).toBeDefined();

    // Add a second member to the organization
    const orgMember = await orgRepo.addOrganizationMember({
      organizationID: org!.id,
      userID: users.adminJimCompanyB!.userId,
    })

    expect(orgMember).toBeDefined();

    // Update the group, in tests we might not link the group with the user in Keycloak
    const updateOrgMemberGroupResponse = await client.updateOrgMemberGroup({
      orgMemberUserID: users.adminJimCompanyB!.userId,
      groups: [orgGroup!.groupId],
    });

    expect(updateOrgMemberGroupResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that the user the corresponding groups in Keycloak
    let kcUserGroups = await keycloakClient.getKeycloakUserGroups({ realm, userID: users.adminJimCompanyB!.userId });
    let viewerGroup = kcUserGroups.find((group) => group.id === orgGroup?.kcGroupId);

    expect(kcUserGroups).toHaveLength(2);
    expect(viewerGroup).toBeDefined();

    // Leave the organization
    authenticator.changeUserWithSuppliedContext({
      ...users.adminJimCompanyB!,
      organizationId: users.adminAliceCompanyA.organizationId,
      organizationName: users.adminAliceCompanyA.organizationName,
      organizationSlug: users.adminAliceCompanyA.organizationSlug,
    })

    const leaveOrganizationResponse = await client.leaveOrganization({});
    expect(leaveOrganizationResponse.response?.code).toBe(EnumStatusCode.OK);

    // Make sure that the user was removed from all Keycloak groups for the organization
    kcUserGroups = await keycloakClient.getKeycloakUserGroups({ realm, userID: users.adminJimCompanyB!.userId });
    viewerGroup = kcUserGroups.find((group) => group.id === orgGroup?.kcGroupId);

    expect(kcUserGroups).toHaveLength(1);
    expect(viewerGroup).toBeUndefined();

    await server.close();
  });

  test('Owner should not be able to leave organization', async () => {
    const { client, server } = await SetupTest({ dbname });

    const leaveOrganizationResponse = await client.leaveOrganization({});

    expect(leaveOrganizationResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(leaveOrganizationResponse.response?.details).toBe('Creator of a organization cannot leave the organization.');

    await server.close();
  });
});