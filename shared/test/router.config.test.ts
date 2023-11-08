import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildSchema, GraphQLSchema, parse } from 'graphql';
import { ConfigurationData } from '@wundergraph/composition';
import { buildRouterConfig, Subgraph } from '../src';
import { normalizationFailureError } from '../src/router-config/errors';
import { reviver } from './testdata/subgraphConfigGenerator';

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
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: buildSchema(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'normalized-accounts.graphql')).toString(),
      ),
      configurationDataMap: new Map<string, ConfigurationData>(JSON.parse(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'accounts-configuration-data-map.json'))
          .toString(),
        reviver,
      )),
    };
    const products: Subgraph = {
      id: '1',
      name: 'products',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'products.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-products.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: buildSchema(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'normalized-products.graphql')).toString()
      ),
      configurationDataMap: new Map<string, ConfigurationData>(JSON.parse(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'products-configuration-data-map.json'))
          .toString(),
        reviver,
      )),
    };
    const reviews: Subgraph = {
      id: '2',
      name: 'reviews',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'reviews.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-reviews.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: buildSchema(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'normalized-reviews.graphql')).toString()
      ),
      configurationDataMap: new Map<string, ConfigurationData>(JSON.parse(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'reviews-configuration-data-map.json'))
          .toString(),
        reviver,
      )),
    };
    const inventory: Subgraph = {
      id: '3',
      name: 'inventory',
      sdl: fs.readFileSync(path.join(__dirname, 'testdata', 'inventory.graphql'), {
        encoding: 'utf8',
      }),
      url: 'https://wg-federation-demo-inventory.fly.dev/graphql',
      subscriptionUrl: '',
      subscriptionProtocol: 'ws',
      schema: buildSchema(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'normalized-inventory.graphql')).toString()
      ),
      configurationDataMap: new Map<string, ConfigurationData>(JSON.parse(
        fs.readFileSync(path.join(__dirname, 'testdata', 'subgraphConfigs', 'inventory-configuration-data-map.json'))
          .toString(),
        reviver,
      )),
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

  test('that the builder config throws an error if normalization has failed', () => {
    const subgraph:Subgraph = {
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
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error).toStrictEqual(normalizationFailureError('ConfigurationDataMap'));
  });
});
