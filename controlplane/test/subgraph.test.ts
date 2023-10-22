import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import Fastify from 'fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { EnumStatusCode, GraphQLSubscriptionProtocol } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { pino } from 'pino';
import { joinLabel } from '@wundergraph/cosmo-shared';
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
import { SetupTest } from './test-util';

let dbname = '';

describe('Subgraph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph and publish the schema', async (testContext) => {
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

    await server.close();
  });

  test('Should create a subgraph when subgraph did not exist before on publish', async (testContext) => {
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

    const pandasSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));

    const client = createPromiseClient(PlatformService, transport);
    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      schema: pandasSchema,
      labels: [label],
      routingUrl: 'http://localhost:3000',
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);

    expect(graph.graph?.isComposable).toBe(true);
    expect(graph.graph?.compositionErrors).toBe('');
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe('pandas');

    await server.close();
  });

  test('Should update subgraph when subgraph already exists on publish', async (testContext) => {
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

    const pandasSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));

    const client = createPromiseClient(PlatformService, transport);
    const federatedGraphName = genID('fedGraph');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label1)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const createSubgraphResp = await client.createFederatedSubgraph({
      name: 'pandas',
      labels: [label1],
      routingUrl: 'http://localhost:8002',
    });
    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResp = await client.getSubgraphByName({
      name: 'pandas',
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishSubgraphResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      schema: pandasSchema,
      labels: [label1, label2],
      routingUrl: 'http://localhost:3001',
      subscriptionUrl: 'http://localhost:3001',
      subscriptionProtocol: GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE,
      headers: [],
    });
    expect(publishSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getGraphResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });

    expect(getGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getGraphResp.graph?.isComposable).toBe(true);
    expect(getGraphResp.graph?.compositionErrors).toBe('');
    expect(getGraphResp.subgraphs.length).toBe(1);
    expect(getGraphResp.subgraphs[0].name).toBe('pandas');

    // Check if subgraph was updated
    expect(getGraphResp.subgraphs[0].lastUpdatedAt !== getSubgraphResp.graph?.lastUpdatedAt).toBe(true);
    expect(getGraphResp.subgraphs[0].routingURL).toBe('http://localhost:3001');
    expect(getGraphResp.subgraphs[0].labels.length).toBe(2);
    expect(getGraphResp.subgraphs[0].labels[0].key).toBe(label1.key);
    expect(getGraphResp.subgraphs[0].labels[0].value).toBe(label1.value);
    expect(getGraphResp.subgraphs[0].labels[1].key).toBe(label2.key);
    expect(getGraphResp.subgraphs[0].labels[1].value).toBe(label2.value);

    await server.close();
  });
});
