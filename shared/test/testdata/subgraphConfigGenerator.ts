import * as fs from 'node:fs';
import * as process from 'node:process';
import { federateSubgraphs, Subgraph } from '@wundergraph/composition';
import { parse } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

function replacer<K, V>(key: K, value: V) {
  if (value instanceof Map) {
    return {
      dataType: 'Map',
      value: [...value.entries()],
    };
  }
  if (value instanceof Set) {
    return {
      dataType: 'Set',
      value: [...value],
    };
  }
  return value;
}

export function reviver<K, V>(key: K, value: V) {
  if (typeof value === 'object' && value !== null && 'dataType' in value && 'value' in value) {
    switch (value.dataType) {
      case 'Map': {
        // @ts-ignore
        return new Map(value.value);
      }
      case 'Set': {
        // @ts-ignore
        return new Set(value.value);
      }
    }
  }
  return value;
}

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

const { errors, federationResult } = federateSubgraphs(
  [accounts, inventory, products, reviews],
);
if (!federationResult || (errors && errors.length > 0)) {
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

for (const [subgraphName, subgraphConfig] of federationResult.subgraphConfigBySubgraphName) {
  fs.writeFileSync(
    `test/testdata/subgraphConfigs/normalized-${subgraphName}.graphql`,
    printSchemaWithDirectives(subgraphConfig.schema),
  );
  fs.writeFileSync(
    `test/testdata/subgraphConfigs/${subgraphName}-configuration-data-map.json`,
    JSON.stringify(subgraphConfig.configurationDataMap, replacer),
  );
}