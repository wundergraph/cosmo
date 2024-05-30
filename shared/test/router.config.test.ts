import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, test } from 'vitest';
import { printSchema } from 'graphql';
import { federateSubgraphs } from '@wundergraph/composition';
import { buildRouterConfig, ComposedSubgraph } from '../src';
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
    const { errors, federationResult } = federateTestSubgraphs();
    expect(errors).toBeUndefined();
    expect(federationResult).toBeDefined();
    const accountsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('accounts');
    expect(accountsSubgraphConfig).toBeDefined();
    const productsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('products');
    expect(productsSubgraphConfig).toBeDefined();
    const reviewsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('reviews');
    expect(reviewsSubgraphConfig).toBeDefined();
    const inventorySubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('inventory');
    expect(inventorySubgraphConfig).toBeDefined();

    const accounts: ComposedSubgraph = {
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
      configurationDataMap: accountsSubgraphConfig!.configurationDataMap,
    };
    const products: ComposedSubgraph = {
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
      configurationDataMap: productsSubgraphConfig!.configurationDataMap,
    };
    const reviews: ComposedSubgraph = {
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
      configurationDataMap: reviewsSubgraphConfig!.configurationDataMap,
    };
    const inventory: ComposedSubgraph = {
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
      configurationDataMap: inventorySubgraphConfig!.configurationDataMap,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: `type Query {}`,
      fieldConfigurations: [],
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
    const { errors, federationResult } = federateSubgraphs([simpleAccounts, simpleProducts]);
    expect(errors).toBeUndefined();
    expect(federationResult).toBeDefined();
    const accountsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('accounts');
    expect(accountsSubgraphConfig).toBeDefined();
    const productsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('products');
    expect(productsSubgraphConfig).toBeDefined();

    const accounts: ComposedSubgraph = {
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: accountsSubgraphConfig!.schema,
      configurationDataMap: accountsSubgraphConfig!.configurationDataMap,
    };
    const products: ComposedSubgraph = {
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-products.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: productsSubgraphConfig!.schema,
      configurationDataMap: productsSubgraphConfig!.configurationDataMap,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: federationResult!.shouldIncludeClientSchema
        ? printSchema(federationResult!.federatedGraphClientSchema)
        : '',
      fieldConfigurations: [],
      subgraphs: [accounts, products],
      // Passed as it is to the router config
      federatedSDL: printSchema(federationResult!.federatedGraphSchema),
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router-no-client.config.json');
  });

  test('that the federatedClientSDL property is propagated if a schema uses the @tag directive', () => {
    const { errors, federationResult } = federateSubgraphs([simpleAccounts, simpleProductsWithTags]);
    expect(errors).toBeUndefined();
    expect(federationResult).toBeDefined();
    const accountsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('accounts');
    expect(accountsSubgraphConfig).toBeDefined();
    const productsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('products');
    expect(productsSubgraphConfig).toBeDefined();

    const accounts: ComposedSubgraph = {
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: accountsSubgraphConfig!.schema,
      configurationDataMap: accountsSubgraphConfig!.configurationDataMap,
    };
    const products: ComposedSubgraph = {
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-products-with-tags.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: productsSubgraphConfig!.schema,
      configurationDataMap: productsSubgraphConfig!.configurationDataMap,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: federationResult!.shouldIncludeClientSchema
        ? printSchema(federationResult!.federatedGraphClientSchema)
        : '',
      fieldConfigurations: [],
      subgraphs: [accounts, products],
      // Passed as it is to the router config
      federatedSDL: printSchema(federationResult!.federatedGraphSchema),
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router-with-tags.config.json');
  });

  test('that the federatedClientSDL property is propagated if a schema uses the @inaccessible directive', () => {
    const { errors, federationResult } = federateSubgraphs([simpleAccounts, simpleProductsWithInaccessible]);
    expect(errors).toBeUndefined();
    expect(federationResult).toBeDefined();
    const accountsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('accounts');
    expect(accountsSubgraphConfig).toBeDefined();
    const productsSubgraphConfig = federationResult?.subgraphConfigBySubgraphName.get('products');
    expect(productsSubgraphConfig).toBeDefined();

    const accounts: ComposedSubgraph = {
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: accountsSubgraphConfig!.schema,
      configurationDataMap: accountsSubgraphConfig!.configurationDataMap,
    };
    const products: ComposedSubgraph = {
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'simple-products-with-inaccessible.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: productsSubgraphConfig!.schema,
      configurationDataMap: productsSubgraphConfig!.configurationDataMap,
    };
    const routerConfig = buildRouterConfig({
      // if the federatedClientSDL is empty, it is not added to the config
      federatedClientSDL: federationResult!.shouldIncludeClientSchema
        ? printSchema(federationResult!.federatedGraphClientSchema)
        : '',
      fieldConfigurations: [],
      subgraphs: [accounts, products],
      // Passed as it is to the router config
      federatedSDL: printSchema(federationResult!.federatedGraphSchema),
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
        subgraphs: [subgraph],
        federatedSDL: '',
        schemaVersionId: '',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error).toStrictEqual(normalizationFailureError('ConfigurationDataMap'));
  });
});
