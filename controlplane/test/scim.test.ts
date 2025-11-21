import { uid } from 'uid';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PromiseClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import Keycloak from '../src/core/services/Keycloak.js';
import { afterAllSetup, beforeAllSetup, TestAuthenticator, UserTestData } from '../src/core/test-util.js';
import { AuthContext } from '../src/types/index.js';
import { SetupKeycloak, SetupTest } from './test-util.js';

// https://developer.okta.com/docs/reference/scim/scim-20/
describe('Scim server v2.0', (ctx) => {
  let dbname = '';
  let baseAddress = '';
  let realmName = '';
  let userTestData: UserTestData & AuthContext;
  let otherOrgUserTestData: (UserTestData & AuthContext) | undefined;
  let keycloakClient: Keycloak;
  let server: any;
  let client: PromiseClient<typeof PlatformService>;
  let authenticator: TestAuthenticator;

  beforeAll(async () => {
    dbname = await beforeAllSetup();

    const setupDetails = await SetupTest({
      dbname,
      enabledFeatures: ['scim'],
      createScimKey: true,
      enableMultiUsers: true,
    });
    baseAddress = setupDetails.baseAddress;
    userTestData = setupDetails.users.adminAliceCompanyA;
    otherOrgUserTestData = setupDetails.users.adminJimCompanyB;
    keycloakClient = setupDetails.keycloakClient;
    realmName = setupDetails.realm;
    server = setupDetails.server;
    client = setupDetails.client;
    authenticator = setupDetails.authenticator;
    await SetupKeycloak({
      keycloakClient,
      realmName,
      userTestData: setupDetails.users.adminAliceCompanyA,
    });
  });

  afterAll(async () => {
    await server?.close();
    await afterAllSetup(dbname);
  });

  test('Should test scim server base route', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });
    expect(res.status).toBe(200);
  });

  test('Should return 401 if the authorization fails', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/scim+json',
      },
    });

    expect(res.status).toBe(401);
  });

  test('Should test scim server /Users route', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });

    const response = await res.json();
    expect(res.status).toBe(200);
    expect(response.totalResults).toBe(4);
  });

  test('Should test scim server /Users route with filter', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/Users?filter=userName eq "${userTestData.email}"`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });

    const response = await res.json();
    expect(res.status).toBe(200);
    expect(response.totalResults).toBe(1);
  });

  test('Should test scim server /Users/:userID route', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/Users/${userTestData.userId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });

    const response = await res.json();
    expect(res.status).toBe(200);
    expect(response.userName).toBe(userTestData.email);
  });

  // Skipping because the invitation is sent using the `studio` client which doesn't in the test context,
  // so the operation fails and a rollback occurs
  test.skip('that when a user does not exists an invitation is sent', async (testContext) => {
    const email = uid(8) + '@wg.com';
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: {
          givenName: 'Test',
          familyName: 'User',
        },
        emails: [
          {
            primary: true,
            value: email,
            type: 'work',
          },
        ],
        displayName: 'Test User',
        locale: 'en-US',
        externalId: '00ujl29u0le5T6Aj10h7',
        groups: [],
        password: 'wunder@123',
        active: true,
      }),
    });

    const createUserBody = await createUserResp.json();

    expect(createUserResp.status).toBe(201);

    const pendingOrgMembers = await client.getPendingOrganizationMembers({});
    expect(pendingOrgMembers.response?.code).toBe(EnumStatusCode.OK);
    expect(pendingOrgMembers.totalCount).toBe(1);

    const emails = pendingOrgMembers.pendingInvitations.map((inv) => inv.email);
    const exists = emails.includes(email);

    expect(exists).toBe(true);
  });

  test('that adding an existing user from another organization, invitest the user', async (testContext) => {
    const email = otherOrgUserTestData!.email;

    // Remove the user from the organization
    await client.removeOrganizationMember({ email });

    // Create the user invitation
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: {
          givenName: 'Test',
          familyName: 'User',
        },
        emails: [
          {
            primary: true,
            value: email,
            type: 'work',
          },
        ],
        displayName: 'Test User',
        locale: 'en-US',
        externalId: '00ujl29u0le5T6Aj10h7',
        groups: [],
        password: 'wunder@123',
        active: true,
      }),
    });

    expect(createUserResp.status).toBe(201);

    const pendingOrgMembers = await client.getPendingOrganizationMembers({});
    expect(pendingOrgMembers.response?.code).toBe(EnumStatusCode.OK);
    expect(pendingOrgMembers.totalCount).toBe(1);

    const emails = pendingOrgMembers.pendingInvitations.map((inv) => inv.email);
    const exists = emails.includes(email);

    expect(exists).toBe(true);
  });

  test('that adding an existing user from another organization multiple times does not create multiple invitations', async (testContext) => {
    const email = otherOrgUserTestData!.email;

    // Remove the user from the organization
    await client.removeOrganizationMember({ email });

    // Create the user invitation
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: {
          givenName: 'Test',
          familyName: 'User',
        },
        emails: [
          {
            primary: true,
            value: email,
            type: 'work',
          },
        ],
        displayName: 'Test User',
        locale: 'en-US',
        externalId: '00ujl29u0le5T6Aj10h7',
        groups: [],
        password: 'wunder@123',
        active: true,
      }),
    });

    expect(createUserResp.status).toBe(201);

    const createUserResp2 = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: {
          givenName: 'Test',
          familyName: 'User',
        },
        emails: [
          {
            primary: true,
            value: email,
            type: 'work',
          },
        ],
        displayName: 'Test User',
        locale: 'en-US',
        externalId: '00ujl29u0le5T6Aj10h7',
        groups: [],
        password: 'wunder@123',
        active: true,
      }),
    });

    expect(createUserResp2.status).toBe(201);

    const pendingOrgMembers = await client.getPendingOrganizationMembers({});
    expect(pendingOrgMembers.response?.code).toBe(EnumStatusCode.OK);
    expect(pendingOrgMembers.totalCount).toBe(1);

    const emails = pendingOrgMembers.pendingInvitations.map((inv) => inv.email);
    const exists = emails.includes(email);

    expect(exists).toBe(true);
  });

  test('that an user can be updated after accepting the organization invitation', async (testContext) => {
    const email = otherOrgUserTestData!.email;

    // Remove the user from the organization
    await client.removeOrganizationMember({ email });

    // Create the user invitation
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: {
          givenName: 'Test',
          familyName: 'User2',
        },
        emails: [
          {
            primary: true,
            value: email,
            type: 'work',
          },
        ],
        displayName: 'Test User2',
        locale: 'en-US',
        externalId: '00ujl29u0le5T6Aj10h1',
        groups: [],
        password: 'wunder@123',
        active: true,
      }),
    });

    const createUserBody = await createUserResp.json();

    expect(createUserResp.status).toBe(201);

    // Accept the invitation
    authenticator.changeUserWithSuppliedContext(otherOrgUserTestData!);
    const acceptInvitationResponse = await client.acceptOrDeclineInvitation({
      organizationId: userTestData!.organizationId,
      accept: true,
    });

    expect(acceptInvitationResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the user
    authenticator.changeUserWithSuppliedContext(userTestData!);
    const updateUserResp = await fetch(`${baseAddress}/scim/v2/Users/${createUserBody.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: createUserBody.id,
        userName: createUserBody.userName,
        name: {
          givenName: 'Another',
          middleName: '',
          familyName: 'User',
        },
        emails: [
          {
            primary: true,
            value: createUserBody.userName,
            type: 'work',
            display: createUserBody.userName,
          },
        ],
        active: false,
        password: 'wunder@1234',
        groups: [],
        meta: {
          resourceType: 'User',
        },
      }),
    });
    const updateUserBody = await updateUserResp.json();

    expect(updateUserResp.status).toBe(200);

    const res = await fetch(`${baseAddress}/scim/v2/Users/${updateUserBody.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });

    const response = await res.json();
    expect(res.status).toBe(200);
    expect(response.userName).toBe(createUserBody.userName);
    expect(response.name.givenName).toBe('Another');
    expect(response.name.familyName).toBe('User');
    expect(response.active).toBe(false);
  });

  test('that an user can be patched after accepting the organization invitation', async (testContext) => {
    const email = otherOrgUserTestData!.email;

    // Remove the user from the organization
    await client.removeOrganizationMember({ email });

    // Create the user invitation
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        name: {
          givenName: 'Test',
          familyName: 'User1',
        },
        emails: [
          {
            primary: true,
            value: email,
            type: 'work',
          },
        ],
        displayName: 'Test User1',
        locale: 'en-US',
        externalId: '00ujl29u0le5T6Aj10h5',
        groups: [],
        password: 'wunder@123',
        active: true,
      }),
    });

    const createUserBody = await createUserResp.json();

    expect(createUserResp.status).toBe(201);

    // Accept the invitation
    authenticator.changeUserWithSuppliedContext(otherOrgUserTestData!);
    const acceptInvitationResponse = await client.acceptOrDeclineInvitation({
      organizationId: userTestData!.organizationId,
      accept: true,
    });

    expect(acceptInvitationResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the user
    authenticator.changeUserWithSuppliedContext(userTestData!);
    const updateUserResp = await fetch(`${baseAddress}/scim/v2/Users/${createUserBody.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            value: {
              active: false,
            },
          },
        ],
      }),
    });
    expect(updateUserResp.status).toBe(204);

    const res = await fetch(`${baseAddress}/scim/v2/Users/${createUserBody.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });

    const response = await res.json();
    expect(res.status).toBe(200);
    expect(response.userName).toBe(createUserBody.userName);
    expect(response.active).toBe(false);
  });
});

describe('Scim server when scim is not enabled v2.0', (ctx) => {
  let dbname = '';
  let baseAddress = '';
  let realmName = '';
  let userTestData: UserTestData & AuthContext;
  let keycloakClient: Keycloak;
  let server: any;

  beforeAll(async () => {
    dbname = await beforeAllSetup();

    const setupDetails = await SetupTest({ dbname, createScimKey: false });
    baseAddress = setupDetails.baseAddress;
    userTestData = setupDetails.users.adminAliceCompanyA;
    keycloakClient = setupDetails.keycloakClient;
    realmName = setupDetails.realm;
    server = setupDetails.server;
    await SetupKeycloak({
      keycloakClient,
      realmName,
      userTestData: setupDetails.users.adminAliceCompanyA,
    });
  });

  afterAll(async () => {
    await server?.close();
    await afterAllSetup(dbname);
  });

  test('Should test scim server when scim feature is not enabled', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });
    const response = await res.json();
    expect(res.status).toBe(400);
    expect(response.detail).toBe('Scim feature is not enabled for this organization.');
  });
});

describe('Scim server when scim is enabled, but no scim key', (ctx) => {
  let dbname = '';
  let baseAddress = '';
  let realmName = '';
  let userTestData: UserTestData & AuthContext;
  let keycloakClient: Keycloak;
  let server: any;

  beforeAll(async () => {
    dbname = await beforeAllSetup();

    const setupDetails = await SetupTest({ dbname, enabledFeatures: ['scim'], createScimKey: false });
    baseAddress = setupDetails.baseAddress;
    userTestData = setupDetails.users.adminAliceCompanyA;
    keycloakClient = setupDetails.keycloakClient;
    realmName = setupDetails.realm;
    server = setupDetails.server;
    await SetupKeycloak({
      keycloakClient,
      realmName,
      userTestData: setupDetails.users.adminAliceCompanyA,
    });
  });

  afterAll(async () => {
    await server?.close();
    await afterAllSetup(dbname);
  });

  test('Should test scim server when the key passed is not scim key', async (testContext) => {
    const res = await fetch(`${baseAddress}/scim/v2/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });
    const response = await res.json();
    expect(res.status).toBe(400);
    expect(response.detail).toBe('API key doesnt have the permission to perform scim operations.');
  });
});
