import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildRouterConfig, Subgraph } from '../src';

// @ts-ignore-next-line
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

describe('Router Config Builder', () => {
  test('Build Subgraph schema', () => {
    const accounts: Subgraph = {
      id: '0',
      name: 'accounts',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'accounts.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
    };
    const products: Subgraph = {
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'products.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
    };
    const reviews: Subgraph = {
      id: '2',
      name: 'reviews',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'reviews.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-reviews.fly.dev/graphql',
    };
    const inventory: Subgraph = {
      id: '3',
      name: 'inventory',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'inventory.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-inventory.fly.dev/graphql',
    };
    const routerConfig = buildRouterConfig({
      argumentConfigurations: [],
      subgraphs: [accounts, products, reviews, inventory],
      // Passed as it is to the router config
      federatedSDL: `type Query {}`,
    });
    const json = routerConfig.toJsonString({
      enumAsInteger: true,
      emitDefaultValues: false,
    });
    const out = JSON.stringify(JSON.parse(json), null, 2);
    expect(out).matchSnapshot('router.config.json');
  });

  test('that builder config throws an error if the graph fails normalization', () => {
    const subgraph = {
      id: '',
      name: '',
      sdl: `extend input Human {
        name: String!
      }`,
      url: '',
    };
    let error;
    try {
      buildRouterConfig({
        argumentConfigurations: [],
        subgraphs: [subgraph],
        federatedSDL: '',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe('Normalization failed');
    expect(error.cause.message).toBe(
      'Extension error:\n' + ' Could not extend the type "Human" because no base definition exists.',
    );
  });
});
