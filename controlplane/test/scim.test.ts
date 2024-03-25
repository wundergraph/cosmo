import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { uid } from 'uid';
import { UserTestData, afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
import Keycloak from '../src/core/services/Keycloak.js';
import { SetupKeycloak, SetupTest, removeKeycloakSetup } from './test-util.js';

let dbname = '';
let baseAddress = '';
let userTestData: UserTestData;
let keycloakClient: Keycloak;

describe('Scim server', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
    const setupDetails = await SetupTest({ dbname });
    baseAddress = setupDetails.baseAddress;
    userTestData = setupDetails.userTestData;
    keycloakClient = setupDetails.keycloakClient;
    await SetupKeycloak({
      keycloakClient,
      realmName: 'test',
      userTestData,
    });
  });

  afterAll(async () => {
    await removeKeycloakSetup({ keycloakClient, realmName: 'test' });
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
    expect(response.totalResults).toBe(1);
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
  });

  test('Should test create user and then get user', async (testContext) => {
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'test.user@okta.local',
        name: {
          givenName: 'Test',
          familyName: 'User',
        },
        emails: [
          {
            primary: true,
            value: 'test.user@okta.local',
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

    const res = await fetch(`${baseAddress}/scim/v2/Users/${createUserBody.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
    });

    const response = await res.json();
    expect(res.status).toBe(200);
    expect(response.userName).toBe('test.user@okta.local');
  });

  test('Should test update user', async (testContext) => {
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'test.user2@okta.local',
        name: {
          givenName: 'Test',
          familyName: 'User2',
        },
        emails: [
          {
            primary: true,
            value: 'test.user2@okta.local',
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

  test('Should test /Users/:userID patch route', async (testContext) => {
    const createUserResp = await fetch(`${baseAddress}/scim/v2/Users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userTestData.apiKey}`,
        'Content-Type': 'application/scim+json',
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'test.user1@okta.local',
        name: {
          givenName: 'Test',
          familyName: 'User1',
        },
        emails: [
          {
            primary: true,
            value: 'test.user1@okta.local',
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
