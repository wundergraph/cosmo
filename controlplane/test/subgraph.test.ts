import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import Fastify from 'fastify';

import { createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { pino } from 'pino';

import routes from '../src/core/routes';
import database from '../src/core/plugins/database';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestAuthenticator,
  genID,
  genUniqueLabel,
  seedTest,
} from '../src/core/test-util';
import Keycloak from '../src/core/services/Keycloak';
import { MockPlatformWebhookService } from '../src/core/webhooks/PlatformWebhookService';
import PrometheusClient from '../src/core/prometheus/client';

let dbname = '';

describe('Subgraph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph and publish the schema', async (testContext) => {
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

    const keycloakClient = new Keycloak({
      apiUrl,
      realm,
      clientId,
      adminUser,
      adminPassword,
    });

    const platformWebhooks = new MockPlatformWebhookService();

    const prometheus = new PrometheusClient({
      apiUrl: 'http://localhost:9090',
    });

    await server.register(fastifyConnectPlugin, {
      routes: routes({
        db: server.db,
        logger: pino(),
        authenticator,
        jwtSecret: 'secret',
        keycloakRealm: realm,
        keycloakClient,
        platformWebhooks,
        prometheus,
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
    const subgraphName = genID();
    const label = genUniqueLabel();

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should be able to create a subgraph, publish and update the label', async (testContext) => {
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

    const keycloakClient = new Keycloak({
      apiUrl,
      realm,
      clientId,
      adminUser,
      adminPassword,
    });

    const platformWebhooks = new MockPlatformWebhookService();

    const prometheus = new PrometheusClient({
      apiUrl: 'http://localhost:9090',
    });

    await server.register(fastifyConnectPlugin, {
      routes: routes({
        db: server.db,
        logger: pino(),
        authenticator,
        jwtSecret: 'secret',
        keycloakRealm: realm,
        keycloakClient,
        platformWebhooks,
        prometheus,
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
    const subgraphName = genID();
    const label = genUniqueLabel();

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });
});
