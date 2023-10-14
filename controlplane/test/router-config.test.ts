import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import Fastify from 'fastify';

import { createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { pino } from 'pino';

import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { noQueryRootTypeError } from '@wundergraph/composition';
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

let dbname = '';

describe('Router Config', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return routerConfig after federating a valid graph', async (testContext) => {
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

    const platformClient = createPromiseClient(PlatformService, transport);
    const nodeClient = createPromiseClient(NodeService, transport);

    const investorySubgraph = genID();
    const pandasSubgraph = genID();
    const usersSubgraph = genID();
    const productsSubgraph = genID();
    const fedGraphName = genID();
    const label = genUniqueLabel();

    const createPandasSubgraph = await platformClient.createFederatedSubgraph({
      name: pandasSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createPandasSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishPandaResp = await platformClient.publishFederatedSubgraph({
      name: pandasSubgraph,
      schema: Uint8Array.from(
        Buffer.from(`
        type Query {
          allPandas: [Panda]
          panda(name: ID!): Panda
        }
        
        type Panda {
            name:ID!
            favoriteFood: String
        }
      `),
      ),
    });

    expect(publishPandaResp.response?.code).toBe(EnumStatusCode.OK);

    const createUsersSubgraph = await platformClient.createFederatedSubgraph({
      name: usersSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8082',
    });

    expect(createUsersSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishUsersResp = await platformClient.publishFederatedSubgraph({
      name: usersSubgraph,
      schema: Uint8Array.from(
        Buffer.from(`
        type User @key(fields: "email") {
          email: ID!
          name: String
          totalProductsCreated: Int
        }
        
        type Query {
          user: User
        }
      `),
      ),
    });

    expect(publishUsersResp.response?.code).toBe(EnumStatusCode.OK);

    const createInvetorySubgraph = await platformClient.createFederatedSubgraph({
      name: investorySubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8083',
    });

    expect(createInvetorySubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishInventoryResp = await platformClient.publishFederatedSubgraph({
      name: investorySubgraph,
      schema: Uint8Array.from(
        Buffer.from(`
          directive @tag(name: String!) repeatable on FIELD_DEFINITION

          extend type Product @key(fields: "id") {
            id: ID! @external @tag(name: "hi-from-inventory")
            dimensions: ProductDimension @external
            delivery(zip: String): DeliveryEstimates @requires(fields: "dimensions { size weight }")
          }

          type ProductDimension {
            size: String
            weight: Float @tag(name: "hi-from-inventory-value-type-field")
          }

          type DeliveryEstimates {
            estimatedDelivery: String
            fastestDelivery: String
          }
      `),
      ),
    });

    expect(publishInventoryResp.response?.code).toBe(EnumStatusCode.OK);

    const createProductsSubgraph = await platformClient.createFederatedSubgraph({
      name: productsSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8084',
    });

    expect(createProductsSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishProductsResp = await platformClient.publishFederatedSubgraph({
      name: productsSubgraph,
      schema: Uint8Array.from(
        Buffer.from(`
        directive @tag(name: String!) repeatable on FIELD_DEFINITION

        type Product @key(fields: "id") @key(fields: "sku package") @key(fields: "sku variation { id }"){
          id: ID! @tag(name: "hi-from-products")
          sku: String @tag(name: "hi-from-products")
          package: String
          variation: ProductVariation
          dimensions: ProductDimension
        
          createdBy: User @provides(fields: "totalProductsCreated")
        }
        
        type ProductVariation {
          id: ID!
        }
        
        type ProductDimension {
          size: String
          weight: Float
        }
        
        extend type Query {
          allProducts: [Product]
          product(id: ID!): Product
        }
        
        extend type User @key(fields: "email") {
          email: ID! @external
          totalProductsCreated: Int @external
        }        
      `),
      ),
    });

    expect(publishProductsResp.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await platformClient.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await platformClient.getFederatedGraphByName({
      name: fedGraphName,
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);

    expect(graph.graph?.isComposable).toBe(true);
    expect(graph.graph?.compositionErrors).toBe('');

    const resp = await nodeClient.getLatestValidRouterConfig({
      graphName: fedGraphName,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.config?.engineConfig).toBeDefined();

    await server.close();
  });

  test('Should not return routerConfig if an invalid schema version is available', async (testContext) => {
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

    const platformClient = createPromiseClient(PlatformService, transport);
    const nodeClient = createPromiseClient(NodeService, transport);

    const pandasSubgraph = genID();
    const usersSubgraph = genID();
    const fedGraphName = genID();
    const label = genUniqueLabel();

    const createFedGraphRes = await platformClient.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createPandasSubgraph = await platformClient.createFederatedSubgraph({
      name: pandasSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createPandasSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishPandaResp = await platformClient.publishFederatedSubgraph({
      name: pandasSubgraph,
      schema: Uint8Array.from(
        Buffer.from(`
        type Panda {
            name:ID!
            favoriteFood: String
        }
      `),
      ),
    });

    expect(publishPandaResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(publishPandaResp.compositionErrors).toHaveLength(1);
    expect(publishPandaResp.compositionErrors[0].message).toStrictEqual(noQueryRootTypeError.message);

    const createUsersSubgraph = await platformClient.createFederatedSubgraph({
      name: usersSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8082',
    });

    expect(createUsersSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishUsersResp = await platformClient.publishFederatedSubgraph({
      name: pandasSubgraph,
      schema: Uint8Array.from(
        Buffer.from(`
        type Query {
            username: String
        }
        extend type User{
          name: String
        }
      `),
      ),
    });

    expect(publishUsersResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    const graph = await platformClient.getFederatedGraphByName({
      name: fedGraphName,
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.graph?.compositionErrors).toBe(
      'Error: Extension error:\n' + ' Could not extend the type "User" because no base definition exists.',
    );
    expect(graph.graph?.isComposable).toBe(false);

    const resp = await nodeClient.getLatestValidRouterConfig({
      graphName: fedGraphName,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(resp.config).toBeUndefined();

    await server.close();
  });
});
