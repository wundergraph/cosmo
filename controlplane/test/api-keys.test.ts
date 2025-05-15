import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateAPIKeyResponse, ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { uid } from 'uid';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('API Keys', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create and delete a api key', async (testContext) => {
    const { client, users, server } = await SetupTest({ dbname });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    let response: CreateAPIKeyResponse;
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.THIRTY_DAYS,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.SIX_MONTHS,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.ONE_YEAR,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // test to check that 2 api keys cant have the same name
    response = await client.createAPIKey({
      name: 'test',
      expires: ExpiresAt.ONE_YEAR,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: 'test',
      expires: ExpiresAt.ONE_YEAR,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    // test when api key name is wrong
    response = await client.createAPIKey({
      name: 'a'.repeat(100),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);

    response = await client.createAPIKey({
      name: '',
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      groupId: adminGroup.groupId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);

    let deleteResponse = await client.deleteAPIKey({ name: 'test' });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

    deleteResponse = await client.deleteAPIKey({ name: 'test1' });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Should be able to update API key group', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const apiKeyName = uid();
    const createApiKeyResponse = await client.createAPIKey({
      name: apiKeyName,
      expires: ExpiresAt.NEVER,
      groupId: adminGroup.groupId,
    });

    expect(createApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateApiKeyResponse = await client.updateAPIKey({
      name: apiKeyName,
      groupId: developerGroup.groupId,
    });

    expect(updateApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    const apiKeysResponse = await client.getAPIKeys({});
    const apiKey = apiKeysResponse.apiKeys?.find((k) => k.name === apiKeyName);

    expect(apiKeysResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(apiKey?.group).not.toBeUndefined();
    expect(apiKey?.group?.name).toBe('developer');

    await server.close();
  });
});
