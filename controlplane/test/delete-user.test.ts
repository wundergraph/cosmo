import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { pino } from 'pino';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addSeconds, formatISO, subDays } from 'date-fns';
import { UserRepository } from '../src/core/repositories/UserRepository.js';
import { ApiKeyRepository } from '../src/core/repositories/ApiKeyRepository.js';
import * as schema from '../src/db/schema.js';
import { ApiKeyGenerator } from '../src/core/services/ApiGenerator.js';
import Keycloak from '../src/core/services/Keycloak.js';
import { AuthContext } from '../src/types/index.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel, TestUser, UserTestData } from '../src/core/test-util.js';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
import {
  createFederatedGraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  SetupKeycloak,
  SetupTest,
} from './test-util.js';

let dbname = '';

const createTempUser = async (
  db: PostgresJsDatabase<typeof schema>,
  keycloakClient: Keycloak,
  realm: string,
  organizationSlug: string,
): Promise<UserTestData & AuthContext> => {
  try {
    const userRepo = new UserRepository(pino(), db);
    const orgRepo = new OrganizationRepository(pino(), db, undefined);
    const apiKeyRepo = new ApiKeyRepository(db);

    const apiKeyPersonal = ApiKeyGenerator.generate();
    const apiKey = ApiKeyGenerator.generate();

    const randomId = randomUUID();
    const userEmail = randomId + '@wg.com';
    const userPersonalOrgId = randomId;
    const userPersonalOrgSlug = randomId;

    const keycloakUserID = await SetupKeycloak({
      keycloakClient,
      realmName: realm,
      userTestData: {
        userId: randomUUID(),
        organizationId: userPersonalOrgId,
        organizationName: userPersonalOrgSlug,
        organizationSlug: userPersonalOrgSlug,
        email: userEmail,
        apiKey: apiKeyPersonal,
        roles: ['admin'],
      },
    });

    await userRepo.addUser({
      id: keycloakUserID,
      email: userEmail,
    });

    // Create personal org
    const personalOrg = await orgRepo.createOrganization({
      organizationID: userPersonalOrgId,
      organizationName: userPersonalOrgSlug,
      organizationSlug: userPersonalOrgSlug,
      ownerID: keycloakUserID,
    });
    const personalOrgMember = await orgRepo.addOrganizationMember({
      organizationID: personalOrg.id,
      userID: keycloakUserID,
    });
    await orgRepo.addOrganizationMemberRoles({
      memberID: personalOrgMember.id,
      roles: ['admin'],
    });
    await apiKeyRepo.addAPIKey({
      key: apiKeyPersonal,
      name: userEmail,
      organizationID: personalOrg.id,
      userID: keycloakUserID,
      expiresAt: ExpiresAt.NEVER,
      targetIds: [],
      permissions: [],
    });

    // Add to existing org
    const groups = await keycloakClient.client.groups.find({
      realm,
      search: organizationSlug,
    });
    const adminGroup = groups[0];
    await keycloakClient.client.users.addToGroup({
      id: keycloakUserID,
      realm,
      groupId: adminGroup.id!,
    });
    const org = await orgRepo.bySlug(organizationSlug);
    const orgMember = await orgRepo.addOrganizationMember({
      organizationID: org!.id,
      userID: keycloakUserID,
    });
    await orgRepo.addOrganizationMemberRoles({
      memberID: orgMember.id,
      roles: ['admin'],
    });
    await apiKeyRepo.addAPIKey({
      key: apiKey,
      name: userEmail,
      organizationID: org!.id,
      userID: keycloakUserID,
      expiresAt: ExpiresAt.NEVER,
      targetIds: [],
      permissions: [],
    });

    return {
      auth: 'api_key',
      userId: keycloakUserID,
      organizationId: personalOrg.id,
      organizationName: personalOrg.name,
      email: userEmail,
      apiKey: apiKeyPersonal,
      organizationSlug: personalOrg.slug,
      hasWriteAccess: true,
      isAdmin: true,
      userDisplayName: userEmail,
      roles: ['admin'],
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};

describe.sequential('Delete user tests', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('User and their organizations are deleted', async (testContext) => {
    const { client, server, users, keycloakClient, authenticator, realm } = await SetupTest({ dbname });
    const mainUserContext = users[TestUser.adminAliceCompanyA];
    const tempUserContext = await createTempUser(server.db, keycloakClient, realm, mainUserContext.organizationSlug);

    const organizationRepo = new OrganizationRepository(pino(), server.db);
    const memberships = await organizationRepo.memberships({ userId: tempUserContext.userId });
    expect(memberships).toHaveLength(2);

    // Verify org members of original org
    const orgMembersRes = await client.getOrganizationMembers({});
    expect(orgMembersRes.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersRes.members).toHaveLength(2);

    authenticator.changeUserWithSuppliedContext(tempUserContext);

    const res = await client.deleteUser({});
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const membershipsAfterDeletion = await organizationRepo.memberships({ userId: tempUserContext.userId });
    expect(membershipsAfterDeletion).toHaveLength(0);

    authenticator.changeUserWithSuppliedContext(mainUserContext);

    // Verify org members of original org again
    const orgMembersRes2 = await client.getOrganizationMembers({});
    expect(orgMembersRes2.response?.code).toBe(EnumStatusCode.OK);
    expect(orgMembersRes2.members).toHaveLength(1);
    expect(orgMembersRes2.members[0].userID).toEqual(mainUserContext.userId);

    await server.close();
  });

  test('User cannot be deleted if they are the only admin of a multi member org', async (testContext) => {
    const { client, server, users, keycloakClient, authenticator, realm } = await SetupTest({ dbname });
    const mainUserContext = users[TestUser.adminAliceCompanyA];
    const tempUserContext = await createTempUser(server.db, keycloakClient, realm, mainUserContext.organizationSlug);

    await client.updateOrgMemberRole({
      userID: mainUserContext.userId,
      orgMemberUserID: tempUserContext.userId,
      role: 'developer',
    });

    const res = await client.deleteUser({});
    expect(res.response?.code).toBe(EnumStatusCode.ERR);
    expect(res.response?.details).toEqual(
      'Cannot delete because you are the only admin of organizations with several members: company-a.',
    );

    await server.close();
  });

  test('API keys created by user is deleted upon deletion', async (testContext) => {
    const { client, server, users, keycloakClient, authenticator, realm } = await SetupTest({ dbname });
    const mainUserContext = users[TestUser.adminAliceCompanyA];
    const tempUserContext = await createTempUser(server.db, keycloakClient, realm, mainUserContext.organizationSlug);

    // Verify api keys before deletion
    const apiKeysRes1 = await client.getAPIKeys({});
    expect(apiKeysRes1.response?.code).toBe(EnumStatusCode.OK);
    expect(apiKeysRes1.apiKeys).toHaveLength(2);
    expect(apiKeysRes1.apiKeys.find((k) => k.createdBy === tempUserContext.email)).toBeDefined();

    authenticator.changeUserWithSuppliedContext(tempUserContext);

    const res = await client.deleteUser({});
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext(mainUserContext);

    // Verify api keys before deletion
    const apiKeysRes2 = await client.getAPIKeys({});
    expect(apiKeysRes2.response?.code).toBe(EnumStatusCode.OK);
    expect(apiKeysRes2.apiKeys).toHaveLength(1);
    expect(apiKeysRes2.apiKeys[0].createdBy).toEqual(mainUserContext.email);

    await server.close();
  });

  test('Compositions retains created by user email', async (testContext) => {
    const { client, server, users, keycloakClient, authenticator, realm } = await SetupTest({ dbname });
    const mainUserContext = users[TestUser.adminAliceCompanyA];
    const tempUserContext = await createTempUser(server.db, keycloakClient, realm, mainUserContext.organizationSlug);

    authenticator.changeUserWithSuppliedContext({
      ...tempUserContext,
      organizationId: mainUserContext.organizationId,
      apiKey: mainUserContext.apiKey,
    });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const res = await client.deleteUser({});
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext(mainUserContext);

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addSeconds(new Date(), 5)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions).toHaveLength(1);
    expect(compositionsRes.compositions[0].createdBy).toEqual(tempUserContext.email);

    await server.close();
  });

  test('SSO configuration is deleted on keycloak', async (testContext) => {
    const { client, server, users, keycloakClient, authenticator, realm } = await SetupTest({ dbname });
    const mainUserContext = users[TestUser.adminAliceCompanyA];
    const tempUserContext = await createTempUser(server.db, keycloakClient, realm, mainUserContext.organizationSlug);

    authenticator.changeUserWithSuppliedContext(tempUserContext);

    const createOIDCRes = await client.createOIDCProvider({
      clientID: '123',
      clientSecrect: '345',
      discoveryEndpoint: `http://localhost:8080/realms/${realm}/.well-known/openid-configuration`,
      mappers: [],
    });
    expect(createOIDCRes.response?.code).toBe(EnumStatusCode.OK);

    const oidcRepo = new OidcRepository(server.db);
    const provider = await oidcRepo.getOidcProvider({ organizationId: tempUserContext.organizationId });
    expect(provider).toBeDefined();

    const idp1 = await keycloakClient.client.identityProviders.findOne({
      alias: provider!.alias,
      realm,
    });
    expect(idp1).toBeDefined();

    const res = await client.deleteUser({});
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const idp2 = await keycloakClient.client.identityProviders.findOne({
      alias: provider!.alias,
      realm,
    });
    expect(idp2).toBeNull();

    await server.close();
  });
});
