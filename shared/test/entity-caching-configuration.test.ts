import { describe, expect, test } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { LATEST_ROUTER_COMPATIBILITY_VERSION, Subgraph } from '@wundergraph/composition';
import {
  CacheTagConfigurationSchema,
  EntityCachingConfigurationSchema,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { print, printSchema } from 'graphql';

import { createSubgraph, federateSubgraphsSuccess } from '../../composition/tests/utils/utils';
import { buildRouterConfig, ComposedSubgraph, SubgraphKind } from '../src';

describe('Entity caching configuration tests', () => {
  test('that a CacheTagConfiguration is produced for each @cacheTag format', () => {
    const routerConfig = buildRouterConfigFromSubgraphs([
      createSubgraph(
        'products',
        `
        type Query {
          product(id: ID!): Product @cacheTag(format: "product-{ $args.id }") @cacheTag(format: "products")
          products: [Product!]! @cacheTag(format: "products")
        }
        type Product @key(fields: "id") { id: ID! }
      `,
      ),
    ]);
    // @cacheTag alone must produce the EntityCachingConfiguration.
    expect(routerConfig.engineConfig?.datasourceConfigurations[0].entityCachingConfiguration).toStrictEqual(
      create(EntityCachingConfigurationSchema, {
        cacheTagConfigurations: [
          create(CacheTagConfigurationSchema, {
            typeName: 'Query',
            fieldName: 'product',
            format: 'product-{$args.id}',
          }),
          create(CacheTagConfigurationSchema, { typeName: 'Query', fieldName: 'product', format: 'products' }),
          create(CacheTagConfigurationSchema, {
            typeName: 'Query',
            fieldName: 'products',
            format: 'products',
          }),
        ],
      }),
    );
  });

  test('that a CacheTagConfiguration is produced for each @cacheTag format upon an entity', () => {
    const routerConfig = buildRouterConfigFromSubgraphs([
      createSubgraph(
        'products',
        `
        type Query { product(id: ID!): Product }
        type Product
            @key(fields: "id")
            @cacheTag(format: "product-{ $key.id }")
            @cacheTag(format: "products") {
          id: ID!
        }
      `,
      ),
    ]);
    // @cacheTag upon an entity alone must produce the EntityCachingConfiguration.
    expect(routerConfig.engineConfig?.datasourceConfigurations[0].entityCachingConfiguration).toStrictEqual(
      create(EntityCachingConfigurationSchema, {
        cacheTagConfigurations: [
          create(CacheTagConfigurationSchema, { typeName: 'Product', format: 'product-{$key.id}' }),
          create(CacheTagConfigurationSchema, { typeName: 'Product', format: 'products' }),
        ],
      }),
    );
  });
});

function buildRouterConfigFromSubgraphs(subgraphs: Array<Subgraph>): RouterConfig {
  const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
    subgraphs,
    LATEST_ROUTER_COMPATIBILITY_VERSION,
  );
  return buildRouterConfig({
    federatedClientSDL: '',
    federatedSDL: printSchema(federatedGraphSchema),
    fieldConfigurations: [],
    routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
    schemaVersionId: '',
    subgraphs: subgraphs.map((subgraph, index): ComposedSubgraph => {
      const subgraphConfig = subgraphConfigBySubgraphName.get(subgraph.name)!;
      return {
        kind: SubgraphKind.Standard,
        id: `${index}`,
        name: subgraph.name,
        sdl: print(subgraph.definitions),
        url: subgraph.url,
        subscriptionUrl: '',
        subscriptionProtocol: 'ws',
        schema: subgraphConfig.schema,
        configurationDataByTypeName: subgraphConfig.configurationDataByTypeName,
      };
    }),
  });
}
