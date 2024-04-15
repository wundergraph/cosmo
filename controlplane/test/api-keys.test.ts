import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateAPIKeyResponse, ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { uid } from 'uid';
import { TestUser, afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
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

    let response: CreateAPIKeyResponse;
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.THIRTY_DAYS,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.SIX_MONTHS,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.ONE_YEAR,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // test to check that 2 api keys cant have the same name
    response = await client.createAPIKey({
      name: 'test',
      expires: ExpiresAt.ONE_YEAR,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({
      name: 'test',
      expires: ExpiresAt.ONE_YEAR,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    // test when api key name is wrong
    response = await client.createAPIKey({
      name: 'a'.repeat(100),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);

    response = await client.createAPIKey({
      name: '',
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);

    let deleteResponse = await client.deleteAPIKey({ name: 'test' });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

    deleteResponse = await client.deleteAPIKey({ name: 'test1' });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });
});

describe('Create API Keys as admins with RBAC enabled', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create an api key with selected resources', async (testContext) => {
    const { client, users, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResp.graph).toBeDefined();
    expect(getSubgraphResp.graph?.targetId).toBeDefined();

    const ids: string[] = [];
    if (getSubgraphResp.graph) {
      ids.push(getSubgraphResp.graph.targetId);
    }

    const response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      subgraphTargetIds: ids,
      federatedGraphTargetIds: [],
      allowAllResources: false,
    });

    console.log(response);
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should be able to create an api key with selected all resources', async (testContext) => {
    const { client, users, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      subgraphTargetIds: [],
      federatedGraphTargetIds: [],
      allowAllResources: true,
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be able to create an api key when no resources are selected and all resources is not selected', async (testContext) => {
    const { client, users, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.adminAliceCompanyA.userId,
      subgraphTargetIds: [],
      federatedGraphTargetIds: [],
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Can not create an api key without associating it with any resources.');

    await server.close();
  });
});

describe('Create API Keys as developers with RBAC enabled', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should not be able to create an api key with resources the user doesnt have access', async (testContext) => {
    const { client, users, server, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['rbac'],
      enableMultiUsers: true,
    });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResp.graph).toBeDefined();
    expect(getSubgraphResp.graph?.targetId).toBeDefined();

    const ids: string[] = [];
    if (getSubgraphResp.graph) {
      ids.push(getSubgraphResp.graph.targetId);
    }

    authenticator.changeUser(TestUser.devJoeCompanyA);

    const response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.devJoeCompanyA?.userId,
      subgraphTargetIds: ids,
      federatedGraphTargetIds: [],
      allowAllResources: false,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(response.response?.details).toBe(
      'You are not authorized to perform the current action as RBAC is enabled. Please communicate with the organization admin to gain access.',
    );

    await server.close();
  });

  test('Should not be able to create an api key as a developer with all resources option selected', async (testContext) => {
    const { client, users, server, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    authenticator.changeUser(TestUser.devJoeCompanyA);

    const response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.devJoeCompanyA?.userId,
      subgraphTargetIds: [],
      federatedGraphTargetIds: [],
      allowAllResources: true,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(response.response?.details).toBe(
      'You are not authorized to perform the current action. Only admins can create an API key that has access to all resources.',
    );

    await server.close();
  });

  test('Should not be able to create an api key when no resources are selected and all resources is not selected', async (testContext) => {
    const { client, users, server, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'], enableMultiUsers: true });

    authenticator.changeUser(TestUser.devJoeCompanyA);

    const response = await client.createAPIKey({
      name: uid(8),
      expires: ExpiresAt.NEVER,
      userID: users.devJoeCompanyA?.userId,
      subgraphTargetIds: [],
      federatedGraphTargetIds: [],
      allowAllResources: false,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Can not create an api key without associating it with any resources.');

    await server.close();
  });
});
