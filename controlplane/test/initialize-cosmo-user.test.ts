import { randomUUID } from "node:crypto";
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
import { UserRepository } from "../src/core/repositories/UserRepository.js";
import { OrganizationRepository } from "../src/core/repositories/OrganizationRepository.js";
import { SetupTest } from './test-util.js';

let dbname = '';

describe('initializeCosmoUser', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test.each(['', '     '])('should return `Bad Request` when token is empty or whitespace', async (token: string) => {
    const { client, server } = await SetupTest({ dbname });

    const response = await client.initializeCosmoUser({ token });
    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    await server.close();
  });

  test('that an invalid token returns `Bad Request`', async () => {
    const { client, server } = await SetupTest({ dbname });

    const response = await client.initializeCosmoUser({ token: 'not.avalid.token' });
    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    await server.close();
  });

  test('that a user that already exists in Cosmo is not modified', async () => {
    const { client, server, keycloakClient, users, realm } = await SetupTest({ dbname });
    const signIn = createAuthenticator({ keycloakBaseUrl: keycloakClient.client.baseUrl, realm });

    const userRepo = new UserRepository(server.log, server.db);
    const orgRepo = new OrganizationRepository(server.log, server.db);

    // Make sure that the user exists in the database
    const user = await userRepo.byEmail(users.adminAliceCompanyA.email);
    expect(user).not.toBeNull();

    // Make sure that the user is a member of at least one organization
    const orgMemberships = await orgRepo.memberships({ userId: user!.id });
    expect(orgMemberships.length).toBe(1);

    // Authenticate the user to get an ID token
    const { id_token: idToken } = await signIn(users.adminAliceCompanyA.email, 'wunder@123');

    // Initialize the user in the database by accessing the RPC
    const initializeCosmoUserResponse = await client.initializeCosmoUser({ token: idToken });
    expect(initializeCosmoUserResponse?.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a user that does not exists in Cosmo is initialized correctly', async () => {
    const { client, server, keycloakClient, realm } = await SetupTest({ dbname });
    const signIn = createAuthenticator({ keycloakBaseUrl: keycloakClient.client.baseUrl, realm });

    const userEmail = randomUUID() + '@wg.com';
    const userRepo = new UserRepository(server.log, server.db);
    const orgRepo = new OrganizationRepository(server.log, server.db);

    // To simulate that the was just created in Keycloak without going through any Cosmo process
    // (AKA setting everything in Keycloak), we are going to manually create the user in Keycloak
    const { id: keycloakUserId } = await keycloakClient.client.users.create({
      email: userEmail,
      enabled: true,
      emailVerified: true,
      firstName: 'Fake',
      lastName: 'User',
      realm,
      credentials: [{
        type: 'password',
        value: 'wunder@123',
        temporary: false,
      }],
    });

    // Ensure that the user does not exist in the database
    let user = await userRepo.byEmail(userEmail);
    expect(user).toBeNull();

    // Authenticate the new user to get an ID token
    const { id_token: idToken } = await signIn(userEmail, 'wunder@123');

    // Initialize the user in the database by accessing the RPC
    const initializeCosmoUserResponse = await client.initializeCosmoUser({ token: idToken });
    expect(initializeCosmoUserResponse?.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that everything is initialized as expected
    user = await userRepo.byEmail(userEmail);
    expect(user?.id).toBe(keycloakUserId);

    const orgMemberships = await orgRepo.memberships({ userId: keycloakUserId });
    expect(orgMemberships.length).toBe(1);

    // Ensure that the user has been added to the corresponding groups in Keycloak
    const keycloakGroups = await keycloakClient.getKeycloakUserGroups({ realm, userID: keycloakUserId });
    expect(keycloakGroups.length).toBe(1);
    expect(keycloakGroups[0].path).toBe(`/${orgMemberships[0].slug}/admin`);

    await server.close();
  });
});

type AuthResponse = {
  id_token: string;
}

function createAuthenticator({ keycloakBaseUrl, realm }: { keycloakBaseUrl: string, realm: string }) {
  return async (username: string, password: string): Promise<AuthResponse> => {
    const response = await fetch(
      `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username,
          password,
          scope: 'openid',
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to authenticate user: ${response.statusText}`);
    }

    const respObj = await response.json() as AuthResponse;
    if (!respObj.id_token) {
      throw new Error('No ID token returned from Keycloak');
    }

    return respObj;
  };
}