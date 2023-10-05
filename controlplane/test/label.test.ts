import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createPromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import { pino } from 'pino';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';

import { joinLabel } from '@wundergraph/cosmo-shared';
import database from '../src/core/plugins/database';
import routes from '../src/core/routes';
import { Label } from '../src/types';
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

let dbname = '';

describe('Labels', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Changing labels of federated should reassign subgraphs', async (testContext) => {
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
    const subgraph1Name = genID();
    const subgraph2Name = genID();
    const fedGraphName = genID();
    const label1 = genUniqueLabel();
    const label2 = genUniqueLabel();

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8081');
    await createSubgraph(subgraph2Name, [label2], 'http://localhost:8082');

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label1)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);

    const updateRes = await client.updateFederatedGraph({
      name: fedGraphName,
      labelMatchers: [joinLabel(label2)],
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.OK);

    const updatedGraph = await client.getFederatedGraphByName({
      name: fedGraphName,
    });
    expect(updatedGraph.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedGraph.subgraphs.length).toBe(1);
    expect(updatedGraph.subgraphs[0].name).toBe(subgraph2Name);

    await server.close();
  });

  test('Changing labels of subgraph should affect federated graphs', async (testContext) => {
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
    const fedGraph1Name = genID();
    const fedGraph2Name = genID();
    const subgraph1Name = genID();
    const subgraph2Name = genID();
    const label1 = genUniqueLabel();
    const label2 = genUniqueLabel();

    const createFederatedGraph = async (name: string, labelMatchers: string[], routingUrl: string) => {
      const createFedGraphRes = await client.createFederatedGraph({
        name,
        routingUrl,
        labelMatchers,
      });
      expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);
    };

    await createFederatedGraph(fedGraph1Name, [joinLabel(label1)], 'http://localhost:8081');
    await createFederatedGraph(fedGraph2Name, [joinLabel(label2)], 'http://localhost:8082');

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        schema: Uint8Array.from(Buffer.from(`type Query { name: String! }`)),
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8083');
    await createSubgraph(subgraph2Name, [label2], 'http://localhost:8084');

    // fedGraph1 should have subgraph1 and fedGraph2 should have subgraph2
    const graph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
    });
    const graph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
    });
    expect(graph1.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1.subgraphs.length).toBe(1);
    expect(graph1.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph2.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2.subgraphs.length).toBe(1);
    expect(graph2.subgraphs[0].name).toBe(subgraph2Name);

    const updateRes1 = await client.updateSubgraph({
      name: subgraph1Name,
      labels: [label2],
    });
    expect(updateRes1.response?.code).toBe(EnumStatusCode.OK);
    const updateRes2 = await client.updateSubgraph({
      name: subgraph2Name,
      labels: [label1],
    });
    expect(updateRes2.response?.code).toBe(EnumStatusCode.OK);

    // fedGraph1 should have subgraph2 and fedGraph2 should have subgraph1
    const updatedGraph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
    });
    const updatedGraph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
    });
    expect(updatedGraph1.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedGraph1.subgraphs.length).toBe(1);
    expect(updatedGraph1.subgraphs[0].name).toBe(subgraph2Name);
    expect(updatedGraph2.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedGraph2.subgraphs.length).toBe(1);
    expect(updatedGraph2.subgraphs[0].name).toBe(subgraph1Name);

    await server.close();
  });

  test('Assign graphs with multiple label matchers correctly', async (testContext) => {
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
    const subgraph1Name = genID();
    const subgraph2Name = genID();
    const subgraph3Name = genID();
    const fedGraphName = genID();
    const labelTeamA = genUniqueLabel();
    const labelTeamB = genUniqueLabel();
    const labelTeamC = genUniqueLabel();
    const labelEnvProd = genUniqueLabel();
    const labelEnvDev = genUniqueLabel();
    const labelProviderAWS = genUniqueLabel();

    // Federated Graph
    // --label-matcher team=A,team=B,team=C --label-matcher env=prod
    // Subgraphs
    // 1. --labels team=A,provider=aws,env=prod
    // 2. --labels team=B,env=prod
    // 3. --labels team=C,env=dev
    // This will create a federated graph consists of subgraphs 1 and 2 with labels team=A,team=B and env=prod

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [labelTeamA, labelProviderAWS, labelEnvProd], 'http://localhost:8081');
    await createSubgraph(subgraph2Name, [labelTeamB, labelEnvProd], 'http://localhost:8082');
    await createSubgraph(subgraph3Name, [labelTeamC, labelEnvDev], 'http://localhost:8082');

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [
        [joinLabel(labelTeamA), joinLabel(labelTeamB), joinLabel(labelTeamC)].join(','),
        joinLabel(labelEnvProd),
      ],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(2);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph.subgraphs[1].name).toBe(subgraph2Name);

    await server.close();
  });
});
