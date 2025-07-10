import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateAPIKeyResponse, ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { uid } from 'uid';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  TestUser
} from '../src/core/test-util.js';
import { OrganizationRole } from '../src/db/models.js';
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

  test.each([
    'organization-admin',
    'organization-apikey-manager',
  ])('%s should be able to create, update and delete API keys', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroupsResponse = await client.getOrganizationGroups({});
    expect(orgGroupsResponse.response?.code).toBe(EnumStatusCode.OK);

    const adminGroup = orgGroupsResponse.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroupsResponse.groups.find((g) => g.name === 'developer')!;

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
    });

    // Create the API key with the `admin` group
    const apiKeyName = uid();
    const createApiKeyResponse = await client.createAPIKey({
      name: apiKeyName,
      expires: ExpiresAt.NEVER,
      groupId: adminGroup.groupId,
    });

    expect(createApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    // Update the API key to the `developer` group
    const updateApiKeyResponse = await client.updateAPIKey({
      name: apiKeyName,
      groupId: developerGroup.groupId,
    });

    expect(updateApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure that the API key have the correct group
    let getApiKeysResponse = await client.getAPIKeys({});
    let apiKey = getApiKeysResponse.apiKeys?.find((k) => k.name === apiKeyName);

    expect(getApiKeysResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(apiKey).toBeDefined();
    expect(apiKey?.group).toBeDefined();
    expect(apiKey?.group?.name).toBe('developer');

    // Finally, delete the API key
    const deleteApiKeyResponse = await client.deleteAPIKey({ name: apiKeyName });

    expect(deleteApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure the API key have been deleted
    getApiKeysResponse = await client.getAPIKeys({});
    apiKey = getApiKeysResponse.apiKeys?.find((k) => k.name === apiKeyName);

    expect(getApiKeysResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(apiKey).toBeUndefined();

    await server.close();
  });

  test.each([
    'organization-developer',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to create API keys', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroupsResponse = await client.getOrganizationGroups({});
    expect(orgGroupsResponse.response?.code).toBe(EnumStatusCode.OK);

    const adminGroup = orgGroupsResponse.groups.find((g) => g.name === 'admin')!;

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
    });

    // Create the API key with the `admin` group
    const apiKeyName = uid();
    const createApiKeyResponse = await client.createAPIKey({
      name: apiKeyName,
      expires: ExpiresAt.NEVER,
      groupId: adminGroup.groupId,
    });

    expect(createApiKeyResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-developer',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to update API keys', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroupsResponse = await client.getOrganizationGroups({});
    expect(orgGroupsResponse.response?.code).toBe(EnumStatusCode.OK);

    const adminGroup = orgGroupsResponse.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroupsResponse.groups.find((g) => g.name === 'developer')!;

    // Create the API key with the `admin` group
    const apiKeyName = uid();
    const createApiKeyResponse = await client.createAPIKey({
      name: apiKeyName,
      expires: ExpiresAt.NEVER,
      groupId: adminGroup.groupId,
    });

    expect(createApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure the role cannot update the API key
    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
    });

    const updateApiKeyResponse = await client.updateAPIKey({
      name: apiKeyName,
      groupId: developerGroup.groupId,
    });

    expect(updateApiKeyResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-developer',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to delete API keys', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });

    const orgGroupsResponse = await client.getOrganizationGroups({});
    expect(orgGroupsResponse.response?.code).toBe(EnumStatusCode.OK);

    const adminGroup = orgGroupsResponse.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroupsResponse.groups.find((g) => g.name === 'developer')!;

    // Create the API key with the `admin` group
    const apiKeyName = uid();
    const createApiKeyResponse = await client.createAPIKey({
      name: apiKeyName,
      expires: ExpiresAt.NEVER,
      groupId: adminGroup.groupId,
    });

    expect(createApiKeyResponse.response?.code).toBe(EnumStatusCode.OK);

    // Ensure the role cannot delete the API key
    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
    });

    const updateApiKeyResponse = await client.deleteAPIKey({
      name: apiKeyName,
    });

    expect(updateApiKeyResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
