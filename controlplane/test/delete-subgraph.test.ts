import { createPromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import Fastify from 'fastify';
import pino from 'pino';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import database from '../src/core/plugins/database';
import routes from '../src/core/routes';
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
import { MockPrometheusClient } from '../src/core/prometheus/client';

let dbname = '';

describe('DeleteSubgraph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph, publish the schema, create a federated graph and then delete a subgraph', async (testContext) => {
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

    const prometheus = new MockPrometheusClient({
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
    const federatedGraphName = genID();
    const subgraphName = genID();
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:4000',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // delete the subgraph
    const deleteFederatedSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName,
    });
    expect(deleteFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // after deletion of subgraph verify if the subgraph was deleted
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
    });
    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // after deletion of subgraph verify if the federated graph exists
    const getFederatedGraphResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });
    expect(getFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });
});
