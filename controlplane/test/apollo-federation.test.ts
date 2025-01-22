import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Apollo Federated Graph', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
  
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a Apollo Federated Graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const inventorySubgraph = genID('inventory');
    const pandasSubgraph = genID('pandas');
    const usersSubgraph = genID('users');
    const productsSubgraph = genID('products');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createPandasSubgraph = await client.createFederatedSubgraph({
      name: pandasSubgraph,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    expect(createPandasSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishPandaResp = await client.publishFederatedSubgraph({
      name: pandasSubgraph,
      namespace: 'default',
      schema: `
        type Query {
          allPandas: [Panda]
          panda(name: ID!): Panda
        }
        
        type Panda {
            name:ID!
            favoriteFood: String
        }
      `,
    });

    expect(publishPandaResp.response?.code).toBe(EnumStatusCode.OK);

    const createUsersSubgraph = await client.createFederatedSubgraph({
      name: usersSubgraph,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8082',
    });

    expect(createUsersSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishUsersResp = await client.publishFederatedSubgraph({
      name: usersSubgraph,
      namespace: 'default',
      schema: `
        type User @key(fields: "email") {
          email: ID!
          name: String
          totalProductsCreated: Int
        }
        
        type Query {
          user: User
        }
      `,
    });

    expect(publishUsersResp.response?.code).toBe(EnumStatusCode.OK);

    const createInvetorySubgraph = await client.createFederatedSubgraph({
      name: inventorySubgraph,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8083',
    });

    expect(createInvetorySubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishInventoryResp = await client.publishFederatedSubgraph({
      name: inventorySubgraph,
      namespace: 'default',
      schema: `
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
      `,
    });

    expect(publishInventoryResp.response?.code).toBe(EnumStatusCode.OK);

    const createProductsSubgraph = await client.createFederatedSubgraph({
      name: productsSubgraph,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8084',
    });

    expect(createProductsSubgraph.response?.code).toBe(EnumStatusCode.OK);

    const publishProductsResp = await client.publishFederatedSubgraph({
      name: productsSubgraph,
      namespace: 'default',
      schema: `
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
      `,
    });

    expect(publishProductsResp.response?.code).toBe(EnumStatusCode.OK);

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
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

    expect(graph.subgraphs[2]?.name).toEqual(inventorySubgraph);
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
