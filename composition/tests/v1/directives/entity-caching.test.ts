import { describe, expect, test } from 'vitest';
import {
  BatchNormalizationSuccess,
  CACHE_INVALIDATE,
  CACHE_POPULATE,
  CacheInvalidateConfig,
  CachePopulateConfig,
  DIRECTIVE_DEFINITION_BY_NAME,
  ENTITY_CACHE,
  EntityCacheConfig,
  entityCacheWithoutKeyErrorMessage,
  FIRST_ORDINAL,
  invalidDirectiveError,
  IS,
  isReferencesUnknownKeyFieldErrorMessage,
  isWithoutQueryCacheErrorMessage,
  duplicateKeyFieldMappingErrorMessage,
  maxAgeNotPositiveIntegerErrorMessage,
  MUTATION,
  parse,
  QUERY,
  QUERY_CACHE,
  queryCacheOnNonEntityReturnTypeErrorMessage,
  queryCacheOnNonQueryFieldErrorMessage,
  REQUEST_SCOPED,
  REQUEST_SCOPED_DEFINITION,
  RootFieldCacheConfig,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  subgraphValidationError,
  SUBSCRIPTION,
  TypeName,
  cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage,
  cacheInvalidateOnNonEntityReturnTypeErrorMessage,
  cachePopulateOnNonMutationSubscriptionFieldErrorMessage,
  cachePopulateOnNonEntityReturnTypeErrorMessage,
  cacheInvalidateAndPopulateMutualExclusionErrorMessage,
} from '../../../src';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import { batchNormalize } from '../../../src/v1/normalization/normalization-factory';
import {
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

const version = ROUTER_COMPATIBILITY_VERSION_ONE;

// Helper: creates a Subgraph object from an inline SDL string.
// Keeps each test self-contained while avoiding repetitive boilerplate.
function subgraph(sdl: string, name = 'subgraph-a'): Subgraph {
  return { name, url: '', definitions: parse(sdl) };
}

// Helper: runs batchNormalize and returns the ConfigurationData for a given type.
// Used by config-extraction tests that need to inspect the generated router configuration.
// Pins ROUTER_COMPATIBILITY_VERSION_ONE explicitly — relying on the default masks breakage
// when the default changes in the future.
function getConfigForType(sg: Subgraph, typeName: string) {
  const result = batchNormalize({
    subgraphs: [sg],
    version: ROUTER_COMPATIBILITY_VERSION_ONE,
  }) as BatchNormalizationSuccess;
  expect(result.success).toBe(true);
  const internal = result.internalSubgraphBySubgraphName.get(sg.name);
  expect(internal).toBeDefined();
  return internal!.configurationDataByTypeName.get(typeName as TypeName);
}

describe('Entity caching directive tests', () => {
  // ─── @openfed__entityCache ─────────────────────────────────────────────────────────────
  // @openfed__entityCache marks an entity type as cacheable. It requires @key (so the router
  // can construct cache keys) and a positive maxAge (TTL in seconds).

  describe('@openfed__entityCache', () => {
    test('error: @openfed__entityCache without @key — the router needs @key fields to construct cache keys', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { product(id: ID!): Product }
          # Product has @openfed__entityCache but no @key — there's no cache key to use
          type Product @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(ENTITY_CACHE, 'Product', FIRST_ORDINAL, [entityCacheWithoutKeyErrorMessage('Product')]),
      );
    });

    test('error: maxAge of zero — TTL must be at least 1 second', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 0) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(ENTITY_CACHE, 0),
        ]),
      );
    });

    test('error: negative maxAge', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: -5) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(ENTITY_CACHE, -5),
        ]),
      );
    });

    test('success: valid @openfed__entityCache with @key normalizes without errors', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('config: @openfed__entityCache with defaults produces correct EntityCacheConfig', () => {
      // Only maxAge is required; includeHeaders, partialCacheLoad, shadowMode default to false
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      expect(config!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 60,
          notFoundCacheTtlSeconds: 0,
          includeHeaders: false,
          partialCacheLoad: false,
          shadowMode: false,
        },
      ] satisfies EntityCacheConfig[]);
    });

    test('config: @openfed__entityCache with all options enabled', () => {
      // includeHeaders: cache key includes request headers (user-specific caching)
      // partialCacheLoad: fetch only missing entities from subgraph on partial cache hit
      // shadowMode: cache reads/writes happen but responses always come from subgraph
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 120, includeHeaders: true, partialCacheLoad: true, shadowMode: true) {
            id: ID!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      expect(config!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 120,
          notFoundCacheTtlSeconds: 0,
          includeHeaders: true,
          partialCacheLoad: true,
          shadowMode: true,
        },
      ] satisfies EntityCacheConfig[]);
    });

    test('config: @openfed__entityCache negativeCacheTTL propagates to notFoundCacheTtlSeconds', () => {
      // negativeCacheTTL caches "not found" entity responses (null from _entities without errors)
      // for the specified TTL in seconds. 0 (default) disables negative caching.
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 300, negativeCacheTTL: 10) {
            id: ID!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      expect(config!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 300,
          notFoundCacheTtlSeconds: 10,
          includeHeaders: false,
          partialCacheLoad: false,
          shadowMode: false,
        },
      ] satisfies EntityCacheConfig[]);
    });

    test('error: @openfed__entityCache negativeCacheTTL must be non-negative', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 300, negativeCacheTTL: -1) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toBeDefined();
      expect(errors!.some((e) => e.message.includes('negativeCacheTTL must be a non-negative integer'))).toBe(true);
    });
  });

  // ─── @openfed__queryCache ──────────────────────────────────────────────────────────────
  // @openfed__queryCache on a Query field tells the router to serve the returned entity from cache.
  // The return type must be an entity with @openfed__entityCache. Query arguments are mapped to
  // @key fields (automatically by name, or explicitly via @openfed__is) to construct cache keys.

  describe('@openfed__queryCache', () => {
    test('error: @openfed__queryCache on a Mutation field — only Query fields support cache reads', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(id: ID!): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          queryCacheOnNonQueryFieldErrorMessage('Mutation.updateProduct'),
        ]),
      );
    });

    test('error: return type is not a federation entity (no @key)', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 60)
          }
          # Product has no @key — it's not an entity, so there's no cache key
          type Product {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          queryCacheOnNonEntityReturnTypeErrorMessage('Query.product', 'Product'),
        ]),
      );
    });

    // Expectation updated (bug a fix): @openfed__queryCache on a @key entity without
    // @openfed__entityCache warns and does NOT extract a queryCache config — the cache
    // would have no entity-cache backing store.
    test('warning: return entity omits @openfed__entityCache — queryCache config is NOT extracted', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toBeUndefined();
    });

    test('error: maxAge of zero', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 0)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(QUERY_CACHE, 0),
        ]),
      );
    });

    test("success: argument name doesn't match any @key field — no mappings and no warning", () => {
      // No argument can satisfy the @key, so composition emits no cache-key mappings and stays silent.
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(name: String!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(warnings).toHaveLength(0);
    });

    test('no warning for list return type — lists skip key mapping entirely', () => {
      // List-returning fields can populate the cache with each entity in the response,
      // but can't do key-based lookups, so missing key mappings are expected and not warned.
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            products: [Product] @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(warnings).toHaveLength(0);
    });

    test('success: argument name matches @key field — auto-mapped without @openfed__is', () => {
      // The "id" argument automatically maps to the @key(fields: "id") field
      const { schema, warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
      expect(warnings).toHaveLength(0);
    });

    test('config: auto-mapped argument produces correct RootFieldCacheConfig', () => {
      // product(id: ID!) with @key(fields: "id") → auto-maps "id" argument to "id" key field
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: @openfed__queryCache with includeHeaders and shadowMode', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30, includeHeaders: true, shadowMode: true)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: true,
          shadowMode: true,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: auto-mapped composite @key produces multiple fieldMappings', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!, region: String!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [
                { entityKeyField: 'id', argumentPath: ['id'] },
                { entityKeyField: 'region', argumentPath: ['region'] },
              ],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: nested auto-mapping is discarded when the field has an extra argument', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(store: StoreKey!, filter: String): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "store { id }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }
          type Store {
            id: ID!
          }
          input StoreKey {
            id: ID!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: composite @key with mixed auto and @openfed__is mapping', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!, loc: String! @openfed__is(fields: "region")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const mappings = config!.rootFieldCacheConfigurations![0].entityKeyMappings[0].fieldMappings;
      // Sort by entityKeyField so the assertion is order-independent without losing exhaustiveness.
      const sorted = [...mappings].sort((a, b) => a.entityKeyField.localeCompare(b.entityKeyField));
      expect(sorted).toStrictEqual([
        { entityKeyField: 'id', argumentPath: ['id'] },
        { entityKeyField: 'region', argumentPath: ['loc'] },
      ]);
    });
  });

  // ─── @openfed__is ──────────────────────────────────────────────────────────────────────
  // @openfed__is(fields: "keyField") on a query argument explicitly maps it to a @key field.
  // Useful when the argument name differs from the key field name,
  // e.g., product(pid: ID! @openfed__is(fields: "id")) maps "pid" to the @key field "id".

  describe('@openfed__is', () => {
    test('error: @openfed__is without @openfed__queryCache on the field — @openfed__is only makes sense for cache key construction', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(pid: ID! @openfed__is(fields: "id")): Product
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          isWithoutQueryCacheErrorMessage('pid', 'Query.product'),
        ]),
      );
    });

    test('error: @openfed__is references a field not in @key', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(pid: ID! @openfed__is(fields: "unknown")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          isReferencesUnknownKeyFieldErrorMessage('unknown', 'pid', 'Query.product', 'Product'),
        ]),
      );
    });

    test('error: two arguments map to the same @key field — ambiguous cache key', () => {
      // "id" auto-maps to @key field "id", then "otherId" also maps to "id" via @openfed__is
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(id: ID!, otherId: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(otherId: ...)', FIRST_ORDINAL, [
          duplicateKeyFieldMappingErrorMessage('Query.product', 'id'),
        ]),
      );
    });

    // Expectation updated (bug b fix): redundant @openfed__is(fields: "id") on argument
    // named "id" now emits a warning (the directive duplicates the auto-map).
    test('warning: redundant @openfed__is(fields: "id") on argument named "id" emits a redundancy warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(id: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        `Argument "id" on field "Query.product" has @openfed__is(fields: "id"), but "id" already auto-maps to` +
          ` @key field "id" on entity "Product". The @openfed__is directive is redundant and can be removed.`,
      );
    });

    test('success: @openfed__is maps differently-named argument to @key field', () => {
      // "pid" doesn't match @key field "id", so @openfed__is(fields: "id") is required
      const { schema, warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(pid: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
      expect(warnings).toHaveLength(0);
    });

    test('config: @openfed__is mapping produces argumentPath with the original argument name', () => {
      // product(pid: ID! @openfed__is(fields: "id")) → entityKeyField: "id", argumentPath: ["pid"]
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(pid: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['pid'] }],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: @openfed__is can map scalar and composite keys on the same field', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(
              pid: ID! @openfed__is(fields: "id")
              storeKey: ProductStoreKey! @openfed__is(fields: "store { id }")
            ): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @key(fields: "store { id }") @openfed__entityCache(maxAge: 60) {
            id: ID!
            store: Store!
            name: String!
          }
          type Store {
            id: ID!
          }
          input ProductStoreKey {
            store: StoreKey!
          }
          input StoreKey {
            id: ID!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'store.id', argumentPath: ['storeKey', 'store', 'id'] }],
            },
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['pid'] }],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: composite @openfed__is matches reordered flat @key fields', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(key: ProductKey! @openfed__is(fields: "sku id")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }
          input ProductKey {
            sku: String!
            id: ID!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [
                { entityKeyField: 'id', argumentPath: ['key', 'id'] },
                { entityKeyField: 'sku', argumentPath: ['key', 'sku'] },
              ],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: compound flat @key with @openfed__is on both args', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(pid: ID! @openfed__is(fields: "id"), loc: String! @openfed__is(fields: "region")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const mappings = config!.rootFieldCacheConfigurations![0].entityKeyMappings[0].fieldMappings;
      const sorted = [...mappings].sort((a, b) => a.entityKeyField.localeCompare(b.entityKeyField));
      expect(sorted).toStrictEqual([
        { entityKeyField: 'id', argumentPath: ['pid'] },
        { entityKeyField: 'region', argumentPath: ['loc'] },
      ]);
    });

    test('success: nested @key fields do not auto-map from unrelated flat arguments and emit no warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(storeId: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "store { id }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }
          type Store {
            id: ID!
          }
        `),
        version,
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ─── @openfed__cacheInvalidate ─────────────────────────────────────────────────────────
  // @openfed__cacheInvalidate on a Mutation/Subscription field tells the router to evict the
  // returned entity from the cache after the operation completes.

  describe('@openfed__cacheInvalidate', () => {
    test('error: @openfed__cacheInvalidate on a Query field — eviction only applies to side-effect operations', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Query.product', FIRST_ORDINAL, [
          cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage('Query.product'),
        ]),
      );
    });

    test('error: return type is not a cached entity — nothing to evict', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(id: ID!): Result @openfed__cacheInvalidate
          }
          type Result { success: Boolean! }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateOnNonEntityReturnTypeErrorMessage('Mutation.updateProduct', 'Result'),
        ]),
      );
    });

    test('error: both @openfed__cacheInvalidate and @openfed__cachePopulate on same field — mutually exclusive', () => {
      // A mutation can't both evict and write to the cache for the same entity
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(id: ID!): Product @openfed__cacheInvalidate @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateAndPopulateMutualExclusionErrorMessage('Mutation.updateProduct'),
        ]),
      );
    });

    test('success: @openfed__cacheInvalidate on Mutation returning a cached entity', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(id: ID!): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('config: produces CacheInvalidateConfig on the Mutation type', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(id: ID!): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        MUTATION,
      );
      expect(config).toBeDefined();
      expect(config!.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });

    test('success: @openfed__cacheInvalidate on Subscription returning a cached entity', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            itemUpdated: Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('config: produces CacheInvalidateConfig on the Subscription type', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            itemUpdated: Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        SUBSCRIPTION,
      );
      expect(config).toBeDefined();
      expect(config!.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'itemUpdated',
          operationType: SUBSCRIPTION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });

    test('error: return entity has @key but no @openfed__entityCache — must opt into caching', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(id: ID!): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateOnNonEntityReturnTypeErrorMessage('Mutation.updateProduct', 'Product'),
        ]),
      );
    });
  });

  // ─── @openfed__cachePopulate ───────────────────────────────────────────────────────────
  // @openfed__cachePopulate on a Mutation/Subscription field tells the router to write the
  // returned entity into the cache. Optional maxAge overrides the entity's default TTL.

  describe('@openfed__cachePopulate', () => {
    test('error: @openfed__cachePopulate on a Query field — population only applies to side-effect operations', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Query.product', FIRST_ORDINAL, [
          cachePopulateOnNonMutationSubscriptionFieldErrorMessage('Query.product'),
        ]),
      );
    });

    test('error: return type is not a cached entity — nothing to populate', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Result @openfed__cachePopulate
          }
          type Result { success: Boolean! }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          cachePopulateOnNonEntityReturnTypeErrorMessage('Mutation.createProduct', 'Result'),
        ]),
      );
    });

    test('error: maxAge of zero — if provided, must be positive', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 0)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(CACHE_POPULATE, 0),
        ]),
      );
    });

    test('config: invalid maxAge does not produce a config (regression)', () => {
      // Regression: invalid maxAge previously still pushed a config entry.
      // Since composition now fails outright on maxAge: 0, assert the failure surface:
      // exactly one error, and it is the invalidDirectiveError for @openfed__cachePopulate.
      // The pre-fix bug was that validation failed but the config entry was still emitted
      // — which is unobservable on the BatchNormalizationFailure public surface. Asserting
      // the failure shape pins the precondition that guards the previously-leaky path.
      const result = batchNormalize({
        subgraphs: [
          subgraph(`
            type Query { dummy: String! }
            type Mutation {
              createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 0)
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ],
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-a', [
          invalidDirectiveError(CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
            maxAgeNotPositiveIntegerErrorMessage(CACHE_POPULATE, 0),
          ]),
        ]),
      );
    });

    test("success: @openfed__cachePopulate without maxAge — uses the entity's default TTL", () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('success: @openfed__cachePopulate with explicit maxAge override', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 120)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('config: without maxAge — maxAgeSeconds is undefined (falls back to entity default)', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        MUTATION,
      );
      expect(config).toBeDefined();
      expect(config!.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'createProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
          maxAgeSeconds: undefined,
        },
      ] satisfies CachePopulateConfig[]);
    });

    test('config: with explicit maxAge override', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 120)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        MUTATION,
      );
      expect(config).toBeDefined();
      expect(config!.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'createProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
          maxAgeSeconds: 120,
        },
      ] satisfies CachePopulateConfig[]);
    });

    test('success: @openfed__cachePopulate on Subscription field', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            itemCreated: Product @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('config: @openfed__cachePopulate on Subscription produces correct config', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            itemCreated: Product @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        SUBSCRIPTION,
      );
      expect(config).toBeDefined();
      expect(config!.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'itemCreated',
          operationType: SUBSCRIPTION,
          entityTypeName: 'Product',
          maxAgeSeconds: undefined,
        },
      ] satisfies CachePopulateConfig[]);
    });
  });

  // ─── Federation ───────────────────────────────────────────────────────────────
  // Entity caching directives are subgraph-local — they don't affect federation composition.
  // The federated schema should contain the merged types without caching directive artifacts.

  describe('federation', () => {
    test('caching directives on one subgraph compose cleanly with a non-caching subgraph', () => {
      const cachingSubgraph = subgraph(`
        type Query {
          product(id: ID!): Product @openfed__queryCache(maxAge: 30)
        }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const reviewsSubgraph = subgraph(
        `
        type Query {
          reviews(productId: ID!): [String!]!
        }
        type Product @key(fields: "id") {
          id: ID!
        }
      `,
        'subgraph-b',
      );

      const { federatedGraphSchema, success } = federateSubgraphsSuccess([cachingSubgraph, reviewsSubgraph], version);
      expect(success).toBe(true);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          type Product {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID!): Product
            reviews(productId: ID!): [String!]!
          }
        `,
        ),
      );
    });

    test('both subgraphs define @openfed__entityCache on the same entity with different TTLs', () => {
      const subgraphA = subgraph(`
        type Query { product(id: ID!): Product }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const subgraphB = subgraph(
        `
        type Query { productByPrice(price: Float!): Product }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 30) {
          id: ID!
          price: Float!
        }
      `,
        'subgraph-b',
      );

      const { federatedGraphSchema, success } = federateSubgraphsSuccess([subgraphA, subgraphB], version);
      expect(success).toBe(true);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          type Product {
            id: ID!
            name: String!
            price: Float!
          }

          type Query {
            product(id: ID!): Product
            productByPrice(price: Float!): Product
          }
        `,
        ),
      );
    });
  });

  // ─── edge cases ───────────────────────────────────────────────────────────────
  // Pin behavior for schema shapes that don't fit the happy-path assumptions in the
  // validation method: renamed root types, @inaccessible entities, @key(resolvable: false),
  // and @interfaceObject. These regressions are easy to introduce because they look like
  // valid OBJECT_TYPE_DEFINITIONs at the AST level.

  describe('edge cases', () => {
    // Composition supports `schema { query: MyQuery, mutation: MyMutation, subscription: MySubscription }`.
    // Phase 2 captures parentTypeName from the iteration (which is the renamed name) and Phase 1/2
    // attach configs via parentTypeName — never via literal "Query"/"Mutation"/"Subscription".
    // A regression here would silently drop every cache config when the schema renames a root type.

    test('config: @openfed__queryCache on a renamed Query root type attaches to the renamed type', () => {
      const config = getConfigForType(
        subgraph(`
          schema { query: MyQuery }
          type MyQuery {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'MyQuery',
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
            },
          ],
        },
      ]);
    });

    test('config: @openfed__cachePopulate on a renamed Mutation root type attaches to the renamed type', () => {
      const config = getConfigForType(
        subgraph(`
          schema { query: MyQuery, mutation: MyMutation }
          type MyQuery { product(id: ID!): Product }
          type MyMutation {
            updateProduct(id: ID!, name: String!): Product @openfed__cachePopulate(maxAge: 120)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'MyMutation',
      );
      expect(config).toBeDefined();
      expect(config!.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
          maxAgeSeconds: 120,
        },
      ]);
    });

    test('config: @openfed__cacheInvalidate on a renamed Subscription root type attaches to the renamed type', () => {
      const config = getConfigForType(
        subgraph(`
          schema { query: MyQuery, subscription: MySubscription }
          type MyQuery { product(id: ID!): Product }
          type MySubscription {
            productDeleted: Product! @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'MySubscription',
      );
      expect(config).toBeDefined();
      expect(config!.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'productDeleted',
          operationType: SUBSCRIPTION,
          entityTypeName: 'Product',
        },
      ]);
    });

    // @key(resolvable: false) means "this subgraph references the entity but cannot resolve it
    // by key from the entities federation field." @openfed__entityCache currently still applies because
    // the @key is present — the router can still construct a cache key from the SDL. If we ever
    // want to forbid this combination, change Phase 1's `keyFieldSetDatasByTypeName.has(typeName)`
    // check to also require at least one resolvable key.

    test('config: @openfed__entityCache on a type with only @key(resolvable: false) is currently accepted', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id", resolvable: false) @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      expect(config!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 60,
          notFoundCacheTtlSeconds: 0,
          includeHeaders: false,
          partialCacheLoad: false,
          shadowMode: false,
        },
      ]);
    });

    // @interfaceObject types are OBJECT_TYPE_DEFINITIONs at the AST level (so Phase 1's filter
    // accepts them) but the router treats them as interface representations. Their cache semantics
    // aren't defined by the spec yet — pin the current behavior so a future change is intentional.

    test('config: @openfed__entityCache on an @interfaceObject type is currently accepted', () => {
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @interfaceObject @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      expect(config!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 60,
          notFoundCacheTtlSeconds: 0,
          includeHeaders: false,
          partialCacheLoad: false,
          shadowMode: false,
        },
      ]);
    });
  });

  // ─── @openfed__requestScoped registry membership ─────────────────────────────────────────
  // The DIRECTIVE_DEFINITION_BY_NAME registry is the lookup used by normalization to resolve
  // directive AST definitions by name. A missing entry silently breaks discovery.
  describe('@openfed__requestScoped registry', () => {
    test('DIRECTIVE_DEFINITION_BY_NAME[REQUEST_SCOPED] is the REQUEST_SCOPED_DEFINITION AST node', () => {
      expect(DIRECTIVE_DEFINITION_BY_NAME.get(REQUEST_SCOPED)).toBe(REQUEST_SCOPED_DEFINITION);
    });

    test('success: @openfed__requestScoped directive is materialized in the normalized subgraph output', () => {
      // The registry map DIRECTIVE_DEFINITION_BY_NAME is consumed by
      // NormalizationFactory#addDirectiveDefinitionsToDocument when producing the normalized
      // output: every directive name seen in the SDL (tracked in referencedDirectiveNames)
      // is looked up in the registry, and the resolved AST node is set into
      // directiveDefinitionByName. If REQUEST_SCOPED is missing from the registry, the
      // resulting NormalizationSuccess.directiveDefinitionByName will NOT contain it —
      // this assertion fails under that regression.
      const { directiveDefinitionByName } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(id: ID!): Product
            other(id: ID!): Product
          }
          type Product @key(fields: "id") {
            id: ID! @openfed__requestScoped(key: "productId")
            name: String! @openfed__requestScoped(key: "productName")
          }
        `),
        version,
      );
      expect(directiveDefinitionByName.has(REQUEST_SCOPED)).toBe(true);
      expect(directiveDefinitionByName.get(REQUEST_SCOPED)).toBe(REQUEST_SCOPED_DEFINITION);
    });
  });

  // ─── Renamed root types ──────────────────────────────────────────────────────
  // Regression coverage: when a subgraph explicitly renames its root operation types
  // via `schema { query: MyQueryRoot mutation: MyMutationRoot }` (or via
  // `extend schema { ... }`), cache directives on those root fields must be extracted.
  // The first walker pass (`upsertDirectiveSchemaAndEntityDefinitions`) populates
  // `operationTypeNodeByTypeName` from every `OperationTypeDefinition` node (inside
  // SchemaDefinition and SchemaExtension), which runs before
  // `validateAndExtractEntityCachingConfigs()`. If that walker population is ever
  // removed or re-ordered, every cache config attached to renamed root types would
  // silently drop. These tests pin that wiring.
  describe('renamed root operation types', () => {
    test('config: @openfed__queryCache on a renamed Query root is extracted', () => {
      const config = getConfigForType(
        subgraph(`
          schema { query: MyQueryRoot }
          type MyQueryRoot {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'MyQueryRoot',
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: @openfed__queryCache on a renamed Query root via schema extension', () => {
      const config = getConfigForType(
        subgraph(`
          extend schema { query: MyQueryRoot }
          type MyQueryRoot {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'MyQueryRoot',
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'product',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [
            {
              entityTypeName: 'Product',
              fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
            },
          ],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('config: @openfed__cacheInvalidate on a renamed Mutation root is extracted', () => {
      const config = getConfigForType(
        subgraph(`
          schema { query: MyQueryRoot mutation: MyMutationRoot }
          type MyQueryRoot {
            product(id: ID!): Product
          }
          type MyMutationRoot {
            deleteProduct(id: ID!): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        'MyMutationRoot',
      );
      expect(config).toBeDefined();
      expect(config!.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'deleteProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });
  });
});
