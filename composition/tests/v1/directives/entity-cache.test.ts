import { describe, expect, test } from 'vitest';
import {
  OPENFED_ENTITY_CACHE,
  type EntityCacheConfig,
  entityCacheWithoutKeyErrorMessage,
  FIRST_ORDINAL,
  invalidDirectiveError,
  maxAgeNotPositiveIntegerErrorMessage,
  negativeCacheTTLNotNonNegativeIntegerErrorMessage,
  ROUTER_COMPATIBILITY_VERSION_ONE,
} from '../../../src';
import { createSubgraphWithDefault, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

// @openfed__entityCache marks an entity type as cacheable. It requires @key (so the router can
// construct cache keys) and a positive maxAge (TTL in seconds).
describe('@openfed__entityCache', () => {
  describe('validation', () => {
    test('errors without @key — the router needs @key fields to construct cache keys', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query { product(id: ID!): Product }
          # Product has @openfed__entityCache but no @key — there's no cache key to use
          type Product @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          entityCacheWithoutKeyErrorMessage('Product'),
        ]),
      );
    });

    test('rejects a maxAge of zero — TTL must be at least 1 second', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 0) {
            id: ID!
            name: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(OPENFED_ENTITY_CACHE, 0),
        ]),
      );
    });

    test('rejects a negative maxAge', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: -5) {
            id: ID!
            name: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(OPENFED_ENTITY_CACHE, -5),
        ]),
      );
    });

    test('rejects a negative negativeCacheTTL', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 300, negativeCacheTTL: -1) {
            id: ID!
            name: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          negativeCacheTTLNotNonNegativeIntegerErrorMessage(OPENFED_ENTITY_CACHE, -1),
        ]),
      );
    });
  });

  describe('configuration extraction', () => {
    test('with defaults produces the correct EntityCacheConfig', () => {
      // Only maxAge is required; includeHeaders, partialCacheLoad, shadowMode default to false
      const configs = getEntityCacheConfigs(
        `
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `,
        'Product',
      );
      expect(configs).toStrictEqual([
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

    test('every argument propagates to the EntityCacheConfig', () => {
      const configs = getEntityCacheConfigs(
        `
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 120, negativeCacheTTL: 10, includeHeaders: true, partialCacheLoad: true, shadowMode: true) {
            id: ID!
            name: String!
          }
        `,
        'Product',
      );
      expect(configs).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 120,
          notFoundCacheTtlSeconds: 10,
          includeHeaders: true,
          partialCacheLoad: true,
          shadowMode: true,
        },
      ] satisfies EntityCacheConfig[]);
    });
  });
});

// Helper: normalizes the subgraph and returns the entityCache config array attached to `typeName`.
// On this branch entity-caching config is nested under ConfigurationData.entityCaching.
function getEntityCacheConfigs(sdl: string, typeName: string): Array<EntityCacheConfig> | undefined {
  const result = normalizeSubgraphSuccess(createSubgraphWithDefault(sdl), ROUTER_COMPATIBILITY_VERSION_ONE);
  return result.configurationDataByTypeName.get(typeName)?.entityCaching?.entityCacheConfigurations;
}
