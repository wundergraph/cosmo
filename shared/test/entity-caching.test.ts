import { describe, expect, test } from 'vitest';
import {
  federateSubgraphs,
  FederationSuccess,
  LATEST_ROUTER_COMPATIBILITY_VERSION,
  parse,
} from '@wundergraph/composition';
import { EntityCachingConfiguration } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { buildRouterConfig, ComposedSubgraph, SubgraphKind } from '../src';

// Drives a single subgraph through federation + buildRouterConfig and returns the EntityCachingConfiguration
// proto message attached to its datasource configuration (or undefined when no caching directives
// are present). Exercises builder.ts#extractEntityCachingConfiguration end-to-end.
function buildEntityCaching(sdl: string): EntityCachingConfiguration | undefined {
  const result = federateSubgraphs({
    subgraphs: [{ name: 'test', url: '', definitions: parse(sdl) }],
    version: LATEST_ROUTER_COMPATIBILITY_VERSION,
  }) as FederationSuccess;
  expect(result.success).toBe(true);
  const cfg = result.subgraphConfigBySubgraphName.get('test')!;
  const subgraph: ComposedSubgraph = {
    kind: SubgraphKind.Standard,
    id: '0',
    name: 'test',
    sdl,
    url: '',
    subscriptionUrl: '',
    subscriptionProtocol: 'ws',
    websocketSubprotocol: 'auto',
    schema: cfg.schema,
    configurationDataByTypeName: cfg.configurationDataByTypeName,
  } as ComposedSubgraph;
  const routerConfig = buildRouterConfig({
    federatedClientSDL: '',
    fieldConfigurations: [],
    routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
    subgraphs: [subgraph],
    federatedSDL: sdl,
    schemaVersionId: '',
  });
  return routerConfig.engineConfig!.datasourceConfigurations[0].entityCachingConfiguration;
}

describe('Entity caching router-config builder (extractEntityCachingConfiguration)', () => {
  test('maps every entity-caching directive type into the EntityCachingConfiguration message', () => {
    const ec = buildEntityCaching(`
      type Query {
        product(id: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
      }
      type Mutation {
        updateProduct(id: ID!): Product @openfed__cacheInvalidate
        createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 45)
      }
      type Product @key(fields: "id") @openfed__entityCache(maxAge: 60, includeHeaders: true, negativeCacheTTL: 5) {
        id: ID!
        name: String!
      }
    `);

    expect(ec).toBeDefined();

    // @openfed__entityCache (Int args become BigInt; flag defaults preserved)
    expect(ec!.entityCache).toHaveLength(1);
    expect(ec!.entityCache[0].typeName).toBe('Product');
    expect(ec!.entityCache[0].maxAgeSeconds).toBe(60n);
    expect(ec!.entityCache[0].notFoundCacheTtlSeconds).toBe(5n);
    expect(ec!.entityCache[0].includeHeaders).toBe(true);
    expect(ec!.entityCache[0].partialCacheLoad).toBe(false);
    expect(ec!.entityCache[0].shadowMode).toBe(false);

    // @openfed__queryCache with @openfed__is mapping (non-batch)
    expect(ec!.queryCacheConfigurations).toHaveLength(1);
    const rfc = ec!.queryCacheConfigurations[0];
    expect(rfc.fieldName).toBe('product');
    expect(rfc.maxAgeSeconds).toBe(30n);
    expect(rfc.entityTypeName).toBe('Product');
    expect(rfc.entityKeyMappings).toHaveLength(1);
    expect(rfc.entityKeyMappings[0].entityTypeName).toBe('Product');
    expect(rfc.entityKeyMappings[0].fieldMappings).toHaveLength(1);
    const fm = rfc.entityKeyMappings[0].fieldMappings[0];
    expect(fm.entityKeyField).toBe('id');
    expect(fm.argumentPath).toStrictEqual(['id']);
    expect(fm.isBatch).toBe(false);

    // @openfed__cacheInvalidate
    expect(ec!.cacheInvalidateConfigurations).toHaveLength(1);
    expect(ec!.cacheInvalidateConfigurations[0].fieldName).toBe('updateProduct');
    expect(ec!.cacheInvalidateConfigurations[0].operationType).toBe('mutation');
    expect(ec!.cacheInvalidateConfigurations[0].entityTypeName).toBe('Product');

    // @openfed__cachePopulate with explicit maxAge
    expect(ec!.cachePopulateConfigurations).toHaveLength(1);
    expect(ec!.cachePopulateConfigurations[0].fieldName).toBe('createProduct');
    expect(ec!.cachePopulateConfigurations[0].operationType).toBe('mutation');
    expect(ec!.cachePopulateConfigurations[0].entityTypeName).toBe('Product');
    expect(ec!.cachePopulateConfigurations[0].maxAgeSeconds).toBe(45n);
  });

  test('maps a batched @openfed__is mapping with isBatch=true on a list-returning queryCache field', () => {
    const ec = buildEntityCaching(`
      type Query {
        products(ids: [ID!]! @openfed__is(fields: "id")): [Product!]! @openfed__queryCache(maxAge: 20)
      }
      type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
        id: ID!
        name: String!
      }
    `);

    expect(ec).toBeDefined();
    expect(ec!.queryCacheConfigurations).toHaveLength(1);
    const fm = ec!.queryCacheConfigurations[0].entityKeyMappings[0].fieldMappings[0];
    expect(fm.entityKeyField).toBe('id');
    expect(fm.argumentPath).toStrictEqual(['ids']);
    expect(fm.isBatch).toBe(true);
  });

  test('a Subscription @openfed__cachePopulate without maxAge falls back to the entityCache TTL', () => {
    const ec = buildEntityCaching(`
      type Query {
        dummy: String!
      }
      type Subscription {
        productStream: Product @openfed__cachePopulate
      }
      type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
        id: ID!
        name: String!
      }
    `);

    expect(ec).toBeDefined();
    expect(ec!.cachePopulateConfigurations).toHaveLength(1);
    const cp = ec!.cachePopulateConfigurations[0];
    expect(cp.fieldName).toBe('productStream');
    expect(cp.operationType).toBe('subscription');
    expect(cp.entityTypeName).toBe('Product');
    // maxAge omitted on the directive → composition falls back to the entity's @openfed__entityCache TTL (60s).
    expect(cp.maxAgeSeconds).toBe(60n);
  });

  test('a subgraph with no entity-caching directives omits the EntityCaching message', () => {
    const ec = buildEntityCaching(`
      type Query {
        product(id: ID!): Product
      }
      type Product @key(fields: "id") {
        id: ID!
        name: String!
      }
    `);

    expect(ec).toBeUndefined();
  });
});
