import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, test } from 'vitest';
import { printSchema } from 'graphql';
import {
  federateSubgraphs,
  FederationResultSuccess,
  LATEST_ROUTER_COMPATIBILITY_VERSION,
} from '@wundergraph/composition';
import {
  EntityMapping,
  EnumMapping,
  GRPCMapping,
  OperationMapping,
  TypeFieldMapping,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { buildRouterConfig, ComposedSubgraph, ComposedSubgraphPlugin, SubgraphKind } from '../src';
import { normalizationFailureError } from '../src/router-config/errors';
import {
  federateTestSubgraphs,
  simpleAccounts,
  simpleProducts,
  simpleProductsWithInaccessible,
  simpleProductsWithTags,
} from './testdata/utils';

// @ts-ignore-next-line
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

describe('Router Config Builder', () => {
  test('Build Subgraph schema', () => {
    const result = federateTestSubgraphs() as FederationResultSuccess;
    expect(result.success).toBe(true);
    const accountsSubgraphConfig = result.subgraphConfigBySubgraphName.get('accounts');
    const productsSubgraphConfig = result.subgraphConfigBySubgraphName.get('products');
    const reviewsSubgraphConfig = result.subgraphConfigBySubgraphName.get('reviews');
    const inventorySubgraphConfig = result.subgraphConfigBySubgraphName.get('inventory');

    const accounts: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: accountsSubgraphConfig!.schema,
      configurationDataByTypeName: accountsSubgraphConfig!.configurationDataByTypeName,
    };
    const products: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'products.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: productsSubgraphConfig!.schema,
      configurationDataByTypeName: productsSubgraphConfig!.configurationDataByTypeName,
    };
    const reviews: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '2',
      name: 'reviews',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'reviews.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-reviews.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: reviewsSubgraphConfig!.schema,
      configurationDataByTypeName: reviewsSubgraphConfig!.configurationDataByTypeName,
    };
    const inventory: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '3',
      name: 'inventory',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'inventory.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-inventory.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: inventorySubgraphConfig!.schema,
      configurationDataByTypeName: inventorySubgraphConfig!.configurationDataByTypeName,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: `type Query {}`,
      fieldConfigurations: [],
      routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
      subgraphs: [accounts, products, reviews, inventory],
      // Passed as it is to the router config
      federatedSDL: `type Query {}`,
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router.config.json');
  });

  test('Build config with plugin subgraph', () => {
    const result = federateTestSubgraphs() as FederationResultSuccess;
    expect(result.success).toBe(true);
    const accountsSubgraphConfig = result.subgraphConfigBySubgraphName.get('accounts');
    const productsSubgraphConfig = result.subgraphConfigBySubgraphName.get('products');
    const reviewsSubgraphConfig = result.subgraphConfigBySubgraphName.get('reviews');
    const inventorySubgraphConfig = result.subgraphConfigBySubgraphName.get('inventory');

    const accounts: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: accountsSubgraphConfig!.schema,
      configurationDataByTypeName: accountsSubgraphConfig!.configurationDataByTypeName,
    };
    const products: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'products.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: productsSubgraphConfig!.schema,
      configurationDataByTypeName: productsSubgraphConfig!.configurationDataByTypeName,
    };
    const reviews: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '2',
      name: 'reviews',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'reviews.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-reviews.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
      schema: reviewsSubgraphConfig!.schema,
      configurationDataByTypeName: reviewsSubgraphConfig!.configurationDataByTypeName,
    };
    const inventory: ComposedSubgraphPlugin = {
      kind: SubgraphKind.Plugin,
      id: '3',
      name: 'inventory',
      version: '0.0.1',
      mapping: new GRPCMapping({
        entityMappings: [new EntityMapping({})],
        enumMappings: [new EnumMapping({})],
        operationMappings: [new OperationMapping({})],
        service: 'inventory',
        typeFieldMappings: [new TypeFieldMapping({})],
        version: 1,
      }),
      protoSchema: '',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'inventory.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://dummy.dev/graphql',
      schema: inventorySubgraphConfig!.schema,
      configurationDataByTypeName: inventorySubgraphConfig!.configurationDataByTypeName,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: `type Query {}`,
      fieldConfigurations: [],
      routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
      subgraphs: [accounts, products, reviews, inventory],
      // Passed as it is to the router config
      federatedSDL: `type Query {}`,
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router.config.json');
  });

  test('that the federatedClientSDL property is not propagated if it is empty', () => {
    const result = federateSubgraphs(
      [simpleAccounts, simpleProducts],
      LATEST_ROUTER_COMPATIBILITY_VERSION,
    ) as FederationResultSuccess;

    expect(result.success).toBe(true);

    const accountsSubgraphConfig = result.subgraphConfigBySubgraphName.get('accounts');
    const productsSubgraphConfig = result.subgraphConfigBySubgraphName.get('products');

    const accounts: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: accountsSubgraphConfig!.schema,
      configurationDataByTypeName: accountsSubgraphConfig!.configurationDataByTypeName,
    };
    const products: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-products.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: productsSubgraphConfig!.schema,
      configurationDataByTypeName: productsSubgraphConfig!.configurationDataByTypeName,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: result!.shouldIncludeClientSchema ? printSchema(result!.federatedGraphClientSchema) : '',
      fieldConfigurations: [],
      routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
      subgraphs: [accounts, products],
      // Passed as it is to the router config
      federatedSDL: printSchema(result!.federatedGraphSchema),
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router-no-client.config.json');
  });

  test('that the federatedClientSDL property is propagated if a schema uses the @tag directive', () => {
    const result = federateSubgraphs(
      [simpleAccounts, simpleProductsWithTags],
      LATEST_ROUTER_COMPATIBILITY_VERSION,
    ) as FederationResultSuccess;

    expect(result.success).toBe(true);

    const accountsSubgraphConfig = result.subgraphConfigBySubgraphName.get('accounts');
    const productsSubgraphConfig = result.subgraphConfigBySubgraphName.get('products');

    const accounts: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: accountsSubgraphConfig!.schema,
      configurationDataByTypeName: accountsSubgraphConfig!.configurationDataByTypeName,
    };
    const products: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-products-with-tags.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: productsSubgraphConfig!.schema,
      configurationDataByTypeName: productsSubgraphConfig!.configurationDataByTypeName,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: result!.shouldIncludeClientSchema ? printSchema(result!.federatedGraphClientSchema) : '',
      fieldConfigurations: [],
      routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
      subgraphs: [accounts, products],
      // Passed as it is to the router config
      federatedSDL: printSchema(result!.federatedGraphSchema),
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router-with-tags.config.json');
  });

  test('that the federatedClientSDL property is propagated if a schema uses the @inaccessible directive', () => {
    const result = federateSubgraphs(
      [simpleAccounts, simpleProductsWithInaccessible],
      LATEST_ROUTER_COMPATIBILITY_VERSION,
    ) as FederationResultSuccess;

    expect(result.success).toBe(true);

    const accountsSubgraphConfig = result.subgraphConfigBySubgraphName.get('accounts');
    const productsSubgraphConfig = result.subgraphConfigBySubgraphName.get('products');

    const accounts: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: accountsSubgraphConfig!.schema,
      configurationDataByTypeName: accountsSubgraphConfig!.configurationDataByTypeName,
    };
    const products: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-products-with-inaccessible.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: productsSubgraphConfig!.schema,
      configurationDataByTypeName: productsSubgraphConfig!.configurationDataByTypeName,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: result!.shouldIncludeClientSchema ? printSchema(result!.federatedGraphClientSchema) : '',
      fieldConfigurations: [],
      routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
      subgraphs: [accounts, products],
      // Passed as it is to the router config
      federatedSDL: printSchema(result!.federatedGraphSchema),
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router-with-inaccessible.config.json');
  });

  test('that the builder config throws an error if normalization has failed', () => {
    const subgraph: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: '',
      name: '',
      sdl: `extend input Human {
        name: String!
      }`,
      url: '',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      websocketSubprotocol: 'auto',
    };
    let error;
    try {
      buildRouterConfig({
        federatedClientSDL: '',
        fieldConfigurations: [],
        routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
        subgraphs: [subgraph],
        federatedSDL: '',
        schemaVersionId: '',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error).toStrictEqual(normalizationFailureError('ConfigurationDataByTypeName'));
  });
});
