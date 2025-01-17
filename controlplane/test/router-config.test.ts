import { noBaseDefinitionForExtensionError, noQueryRootTypeError, OBJECT } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel, routerConfigFromJsonString } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlobNotFoundError } from '../src/core/blobstorage/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { unsuccessfulBaseCompositionError } from '../src/core/errors/errors.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Router Config', (ctx) => {
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

  test('Should return routerConfig after federating a valid graph', async (testContext) => {
    const { client, server, blobStorage, users } = await SetupTest({ dbname, chClient });

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

    const createInventorySubgraph = await client.createFederatedSubgraph({
      name: inventorySubgraph,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8083',
    });

    expect(createInventorySubgraph.response?.code).toBe(EnumStatusCode.OK);

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

    const graphResponse = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(graphResponse.response?.code).toBe(EnumStatusCode.OK);

    expect(graphResponse.graph?.isComposable).toBe(true);
    expect(graphResponse.graph?.compositionErrors).toBe('');

    const tokenResp = await client.generateRouterToken({
      fedGraphName,
      namespace: 'default',
    });

    expect(tokenResp.response?.code).toBe(EnumStatusCode.OK);

    const configBlog = await blobStorage.getObject({
      key: `${users.adminAliceCompanyA.organizationId}/${graphResponse.graph?.id}/routerconfigs/latest.json`,
    });
    const configJsonString = await new Response(configBlog.stream).text();
    const config = routerConfigFromJsonString(configJsonString);

    expect(config).toBeDefined();

    await server.close();
  });

  test('Should not return routerConfig if an invalid schema version is available', async (testContext) => {
    const { client, server, users, blobStorage } = await SetupTest({ dbname, chClient });

    const pandasSubgraph = genID('pandas');
    const usersSubgraph = genID('users');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

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
        type Panda {
            name:ID!
            favoriteFood: String
        }
      `,
    });

    expect(publishPandaResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(publishPandaResp.compositionErrors).toHaveLength(2);
    expect(publishPandaResp.compositionErrors[0].message).toStrictEqual(noQueryRootTypeError.message);
    expect(publishPandaResp.compositionErrors[1]).toStrictEqual(
      unsuccessfulBaseCompositionError(fedGraphName, 'default'),
    );

    const createUsersSubgraph = await client.createFederatedSubgraph({
      name: usersSubgraph,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8082',
    });

    expect(createUsersSubgraph.response?.code).toBe(EnumStatusCode.OK);

    let publishUsersResp = await client.publishFederatedSubgraph({
      name: pandasSubgraph,
      namespace: 'default',
      schema: `
        type Query {
            username: String
        }
        extend type User{
          name: String
        }
      `,
    });

    expect(publishUsersResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.graph?.compositionErrors).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, 'User').toString());
    expect(graph.graph?.isComposable).toBe(false);

    const tokenResp = await client.generateRouterToken({
      fedGraphName,
      namespace: 'default',
    });

    expect(tokenResp.response?.code).toBe(EnumStatusCode.OK);

    await expect(() =>
      blobStorage.getObject({
        key: `${users.adminAliceCompanyA.organizationId}/${graph.graph?.id}/routerconfigs/latest.json`,
      }),
    ).rejects.toThrowError(BlobNotFoundError);

    // This will fix the schema

    publishUsersResp = await client.publishFederatedSubgraph({
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

    const configBlog = await blobStorage.getObject({
      key: `${users.adminAliceCompanyA.organizationId}/${graph.graph?.id}/routerconfigs/latest.json`,
    });
    const configJsonString = await new Response(configBlog.stream).text();
    const config = routerConfigFromJsonString(configJsonString);

    expect(config).toBeDefined();

    await server.close();
  });
});
