import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createPromiseClient } from '@bufbuild/connect';
import { fastifyConnectPlugin } from '@bufbuild/connect-fastify';
import { createConnectTransport } from '@bufbuild/connect-node';
import { pino } from 'pino';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';

import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
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

let dbname = '';

describe('Apollo Federated Graph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a Apollo Federated Graph', async (testContext) => {
    const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    const server = Fastify();

    await server.register(database, {
      databaseConnectionUrl,
      debugSQL: false,
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

    await server.register(fastifyConnectPlugin, {
      routes: routes({
        db: server.db,
        logger: pino(),
        authenticator,
        jwtSecret: 'secret',
        keycloakRealm: realm,
        keycloakClient,
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
    const investorySubgraph = genID();
    const pandasSubgraph = genID();
    const usersSubgraph = genID();
    const productsSubgraph = genID();
    const fedGraphName = genID();
    const label = genUniqueLabel();

    const createPandasSubgraph = await client.createFederatedSubgraph({
      name: pandasSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createPandasSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishPandaResp = await client.publishFederatedSubgraph({
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

    const createUsersSubgraph = await client.createFederatedSubgraph({
      name: usersSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8082',
    });

    expect(createUsersSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishUsersResp = await client.publishFederatedSubgraph({
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

    const createInvetorySubgraph = await client.createFederatedSubgraph({
      name: investorySubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8083',
    });

    expect(createInvetorySubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishInventoryResp = await client.publishFederatedSubgraph({
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

    const createProductsSubgraph = await client.createFederatedSubgraph({
      name: productsSubgraph,
      labels: [label],
      routingUrl: 'http://localhost:8084',
    });

    expect(createProductsSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishProductsResp = await client.publishFederatedSubgraph({
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

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);

    expect(graph.subgraphs.length).toBe(4);
    expect(graph.graph?.name).toEqual(fedGraphName);
    expect(graph.graph?.isComposable).toEqual(true);
    expect(graph.graph?.compositionErrors).toEqual('');
    expect(graph.graph?.labelMatchers).toEqual([joinLabel(label)]);
    expect(graph.graph?.lastUpdatedAt).toBeTruthy();
    expect(graph.graph?.routingURL).toEqual('http://localhost:8080');

    expect(graph.subgraphs[0]?.name).toEqual(pandasSubgraph);
    expect(graph.subgraphs[0]?.labels).toEqual([label]);
    expect(graph.subgraphs[0]?.lastUpdatedAt).toBeTruthy();
    expect(graph.subgraphs[0]?.routingURL).toEqual('http://localhost:8081');

    expect(graph.subgraphs[1]?.name).toEqual(usersSubgraph);
    expect(graph.subgraphs[1]?.labels).toEqual([label]);
    expect(graph.subgraphs[1]?.lastUpdatedAt).toBeTruthy();
    expect(graph.subgraphs[1]?.routingURL).toEqual('http://localhost:8082');

    expect(graph.subgraphs[2]?.name).toEqual(investorySubgraph);
    expect(graph.subgraphs[2]?.labels).toEqual([label]);
    expect(graph.subgraphs[2]?.lastUpdatedAt).toBeTruthy();
    expect(graph.subgraphs[2]?.routingURL).toEqual('http://localhost:8083');

    expect(graph.subgraphs[3]?.name).toEqual(productsSubgraph);
    expect(graph.subgraphs[3]?.labels).toEqual([label]);
    expect(graph.subgraphs[3]?.lastUpdatedAt).toBeTruthy();
    expect(graph.subgraphs[3]?.routingURL).toEqual('http://localhost:8084');

    await server.close();
  });
});
