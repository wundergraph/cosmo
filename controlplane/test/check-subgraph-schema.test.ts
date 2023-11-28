import { createPromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import Fastify from 'fastify';
import pino from 'pino';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import database from '../src/core/plugins/database.js';
import routes from '../src/core/routes.js';
import { SchemaChangeType } from '../src/types/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestAuthenticator,
  genID,
  genUniqueLabel,
  seedTest,
} from '../src/core/test-util.js';
import Keycloak from '../src/core/services/Keycloak.js';
import { MockPlatformWebhookService } from '../src/core/webhooks/PlatformWebhookService.js';
import Nodemailer from '../src/core/services/Nodemailer.js';
import { InMemoryBlobStorage, SetupTest } from './test-util.js';

let dbname = '';

describe('CheckSubgraphSchema', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph, publish the schema and then check with new schema', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraphName = genID('subgraph1');
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

    // test for no changes in schema
    let checkResp = await client.checkSubgraphSchema({
      subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).toBe(0);
    expect(checkResp.nonBreakingChanges.length).toBe(0);

    // test for breaking changes in schema
    checkResp = await client.checkSubgraphSchema({
      subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { name: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).not.toBe(0);
    expect(checkResp.breakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_REMOVED);
    expect(checkResp.nonBreakingChanges.length).not.toBe(0);
    expect(checkResp.nonBreakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_ADDED);

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph, publish the schema and then check the new schema for composition errors', async (testContext) => {
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
    const webBaseUrl = 'http://localhost:3000';
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

    const nodemailerClient = new Nodemailer('');
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
        keycloakApiUrl: apiUrl,
        blobStorage: new InMemoryBlobStorage(),
        nodemailerClient,
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
    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

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

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! } extend type Product { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).not.toBe(0);
    expect(checkResp.compositionErrors[0].message).toBe(
      `Extension error:\n Could not extend the type "Product" because no base definition exists.`,
    );

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph and then perform the check operation on the subgragh with valid schema ', async (testContext) => {
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
    const webBaseUrl = 'http://localhost:3000';
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
    const nodemailerClient = new Nodemailer('');

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
        keycloakApiUrl: apiUrl,
        blobStorage: new InMemoryBlobStorage(),
        nodemailerClient,
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
    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).toBe(0);
    expect(checkResp.breakingChanges.length).toBe(0);

    await server.close();
  });
});
