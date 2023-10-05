import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { pino } from 'pino';
import { CreateAPIKeyResponse, ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { uid } from 'uid';
import database from '../src/core/plugins/database';
import routes from '../src/core/routes';
import { afterAllSetup, beforeAllSetup, createTestAuthenticator, seedTest } from '../src/core/test-util';
import Keycloak from '../src/core/services/Keycloak';
import { MockPlatformWebhookService } from '../src/core/webhooks/PlatformWebhookService';

let dbname = '';

describe('API Keys', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create and delete a api key', async (testContext) => {
    const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    const server = Fastify();

    await server.register(database, {
      databaseConnectionUrl,
      debugSQL: false,
      runMigration: true,
    });

    testContext.onTestFailed(async () => {
      await server.close();
    });

    const { authenticator, userTestData } = createTestAuthenticator();

    const realm = 'test';
    const apiUrl = 'http://localhost:8080';
    const clientId = 'studio';
    const adminUser = 'admin';
    const adminPassword = 'changeme';
    const webBaseUrl = 'http://localhost:3000';

    const keycloakClient = new Keycloak({
      apiUrl,
      realm,
      clientId,
      adminUser,
      adminPassword,
    });

    const platformWebhooks = new MockPlatformWebhookService();

    await server.register(fastifyConnectPlugin, {
      routes: routes({
        db: server.db,
        logger: pino(),
        authenticator,
        jwtSecret: 'secret',
        keycloakRealm: realm,
        keycloakClient,
        platformWebhooks,
        webBaseUrl,
      }),
    });

    const addr = await server.listen({
      port: 0,
    });

    await seedTest(databaseConnectionUrl, userTestData);

    const transport = createConnectTransport({
      httpVersion: '1.1',
      baseUrl: addr,
    });

    const client = createPromiseClient(PlatformService, transport);

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
