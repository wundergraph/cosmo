import * as fs from 'node:fs';
import {
  federateSubgraphs,
  FederationResult,
  LATEST_ROUTER_COMPATIBILITY_VERSION,
  Subgraph,
  SubscriptionCondition,
} from '@wundergraph/composition';
import { parse } from 'graphql';

export function federateTestSubgraphs(): FederationResult {
  const accounts: Subgraph = {
    definitions: parse(fs.readFileSync('test/testdata/accounts.graphql').toString()),
    name: 'accounts',
    url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
  };

  const inventory: Subgraph = {
    definitions: parse(fs.readFileSync('test/testdata/inventory.graphql').toString()),
    name: 'inventory',
    url: 'https://wg-federation-demo-inventory.fly.dev/graphql',
  };

  const products: Subgraph = {
    definitions: parse(fs.readFileSync('test/testdata/products.graphql').toString()),
    name: 'products',
    url: 'https://wg-federation-demo-products.fly.dev/graphql',
  };

  const reviews: Subgraph = {
    definitions: parse(fs.readFileSync('test/testdata/reviews.graphql').toString()),
    name: 'reviews',
    url: 'https://wg-federation-demo-reviews.fly.dev/graphql',
  };

  return federateSubgraphs({
    subgraphs: [accounts, inventory, products, reviews],
    version: LATEST_ROUTER_COMPATIBILITY_VERSION
  });
}

export const simpleAccounts: Subgraph = {
  definitions: parse(fs.readFileSync('test/testdata/simple-accounts.graphql').toString()),
  name: 'accounts',
  url: 'https://wg-federation-demo-accounts.fly.dev/graphql',
};

export const simpleProducts: Subgraph = {
  definitions: parse(fs.readFileSync('test/testdata/simple-products.graphql').toString()),
  name: 'products',
  url: 'https://wg-federation-demo-products.fly.dev/graphql',
};

export const simpleProductsWithTags: Subgraph = {
  definitions: parse(fs.readFileSync('test/testdata/simple-products-with-tags.graphql').toString()),
  name: 'products',
  url: 'https://wg-federation-demo-products.fly.dev/graphql',
};

export const simpleProductsWithInaccessible: Subgraph = {
  definitions: parse(fs.readFileSync('test/testdata/simple-products-with-inaccessible.graphql').toString()),
  name: 'products',
  url: 'https://wg-federation-demo-products.fly.dev/graphql',
};

export const subscriptionFilterCondition: SubscriptionCondition = {
  and: [
    {
      not: {
        or: [
          {
            in: {
              fieldPath: ['name'],
              values: ['Jens', 'Stefan'],
            },
          },
          {
            in: {
              fieldPath: ['age'],
              values: [11, 22],
            },
          },
        ],
      },
    },
    {
      and: [
        {
          not: {
            in: {
              fieldPath: ['products', 'sku'],
              values: ['aaa'],
            },
          },
        },
        {
          in: {
            fieldPath: ['products', 'continent'],
            values: ['N/A'],
          },
        },
      ],
    },
  ],
};