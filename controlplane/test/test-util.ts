import Fastify from 'fastify';
import { pino } from 'pino';
import { TestContext } from 'vitest';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient } from '@connectrpc/connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import database from '../src/core/plugins/database';
import { createTestAuthenticator, seedTest } from '../src/core/test-util';
import Keycloak from '../src/core/services/Keycloak';
import { MockPlatformWebhookService } from '../src/core/webhooks/PlatformWebhookService';
import routes from '../src/core/routes';

export const SetupTest = async function (testContext: TestContext, dbname: string) {
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
      slack: {
        clientID: '',
        clientSecret: '',
      },
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

  const platformClient = createPromiseClient(PlatformService, transport);
  const nodeClient = createPromiseClient(NodeService, transport);

  return { client: platformClient, nodeClient, server, userTestData };
};
