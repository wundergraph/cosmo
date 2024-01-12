import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildRouterConfig, ComposedSubgraph } from '../src';
import { normalizationFailureError } from '../src/router-config/errors';
import { federateTestSubgraphs } from './testdata/utils';

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
      schema: inventorySubgraphConfig!.schema,
      configurationDataMap: inventorySubgraphConfig!.configurationDataMap,
    };
    const routerConfig = buildRouterConfig({
      argumentConfigurations: [],
      subgraphs: [accounts, products, reviews, inventory],
      // Passed as it is to the router config
      federatedSDL: `type Query {}`,
      schemaVersionId: '',
    });
    const json = routerConfig.toJsonString({
      enumAsInteger: true,
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router.config.json');
  });

  test('that the builder config throws an error if normalization has failed', () => {
    const subgraph:ComposedSubgraph = {
      id: '',
      name: '',
      sdl: `extend input Human {
        name: String!
      }`,
      url: '',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
    };
    let error;
    try {
      buildRouterConfig({
        argumentConfigurations: [],
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
