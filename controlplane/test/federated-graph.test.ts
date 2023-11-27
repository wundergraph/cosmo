import { createPromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import Fastify from 'fastify';
import { pino } from 'pino';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import database from '../src/core/plugins/database.js';
import routes from '../src/core/routes.js';
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
import { InMemoryBlobStorage, SetupTest } from './test-util.js';

let dbname = '';

describe('Federated Graph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a federated graph from subgraphs with matching labels', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const subgraph1Name = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph.subgraphs[0].routingURL).toBe('http://localhost:8080');

    await server.close();
  });

  test('Should be able to add subgraphs to an existing Federated Graph based on matching labels', async (testContext) => {
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
    const subgraph1Name = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph.subgraphs[0].routingURL).toBe('http://localhost:8080');

    await server.close();
  });

  test('Subgraphs should not be composed into a federated graph until it is published', async (testContext) => {
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
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph2Res = await client.createFederatedSubgraph({
      name: subgraph2Name,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubraph2Res.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });

    expect(graph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(graph.sdl).not.toBeDefined();

    await server.close();
  });

  test('Should be able to fetch federated schema after publishing one of the two subgraphs, and after publishing both the subgraphs', async (testContext) => {
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
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph2Res = await client.createFederatedSubgraph({
      name: subgraph2Name,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubraph2Res.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // fetching schema before publishing the subgraphs
    let graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    let publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after publishing one of the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    publishResp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      schema: Uint8Array.from(Buffer.from('type Query { a: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after publishing both the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    await server.close();
  });

  test('Should not be able to fetch federated schema before publishing the subgraphs and after publishing, deleting the subgraphs', async (testContext) => {
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
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubraph1Res = await client.createFederatedSubgraph({
      name: subgraph1Name,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubraph1Res.response?.code).toBe(EnumStatusCode.OK);

    const createSubraph2Res = await client.createFederatedSubgraph({
      name: subgraph2Name,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubraph2Res.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // fetching schema before publishing the subgraphs
    let graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    let publishResp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      schema: Uint8Array.from(Buffer.from('type Query { a: String! }')),
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after publishing both the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    // deleting the subgraph
    let deleteSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName: subgraph1Name,
    });
    expect(deleteSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching the federated schema after deleting one of the subgraphs
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();
    expect(graph.sdl).not.toBe('');

    // delete the subgraph because it was the only one it produced a composition error
    deleteSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
    });
    expect(deleteSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    // fetching the federated schema after deleting both the subgraphs
    // because a federated graph with no subgraphs is not allowed the last valid schema should be returned
    graph = await client.getFederatedGraphSDLByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.sdl).toBeDefined();

    await server.close();
  });
});
