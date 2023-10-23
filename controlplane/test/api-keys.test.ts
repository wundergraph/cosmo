import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateAPIKeyResponse, ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { uid } from 'uid';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util';
import { SetupTest } from './test-util';

let dbname = '';

describe('API Keys', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create and delete a api key', async (testContext) => {
    const { client, userTestData, server } = await SetupTest(testContext, dbname);

    let response: CreateAPIKeyResponse;
    response = await client.createAPIKey({ name: uid(8), expires: ExpiresAt.NEVER, userID: userTestData.userId });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({ name: uid(8), expires: ExpiresAt.THIRTY_DAYS, userID: userTestData.userId });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({ name: uid(8), expires: ExpiresAt.SIX_MONTHS, userID: userTestData.userId });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({ name: uid(8), expires: ExpiresAt.ONE_YEAR, userID: userTestData.userId });
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // test to check that 2 api keys cant have the same name
    response = await client.createAPIKey({ name: 'test', expires: ExpiresAt.ONE_YEAR, userID: userTestData.userId });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    response = await client.createAPIKey({ name: 'test', expires: ExpiresAt.ONE_YEAR, userID: userTestData.userId });
    expect(response.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

    // test when api key name is wrong
    response = await client.createAPIKey({
      name: 'a'.repeat(100),
      expires: ExpiresAt.NEVER,
      userID: userTestData.userId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);

    response = await client.createAPIKey({
      name: '',
      expires: ExpiresAt.NEVER,
      userID: userTestData.userId,
    });
    expect(response.response?.code).toBe(EnumStatusCode.ERR);

    let deleteResponse = await client.deleteAPIKey({ name: 'test' });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

    deleteResponse = await client.deleteAPIKey({ name: 'test1' });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });
});
