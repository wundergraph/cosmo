import { describe, expect, test } from 'vitest';
import {
  OPENFED_ENTITY_CACHE,
  type EntityCacheConfiguration,
  entityCacheWithoutKeyErrorMessage,
  FIRST_ORDINAL,
  invalidDirectiveError,
  maxAgeNotPositiveIntegerErrorMessage,
  negativeCacheTTLNotNonNegativeIntegerErrorMessage,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  invalidRepeatedDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
} from '../../../src';
import {
  createSubgraph,
  createSubgraphWithDefaultName,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
} from '../../utils/utils';

// @openfed__entityCache marks an entity type as cacheable. It requires @key (so the router can
// construct cache keys) and a positive maxAge (TTL in seconds).
describe('@openfed__entityCache tests', () => {
  describe('validation tests', () => {
    test('that an error is raised without @key — the router needs @key fields to construct cache keys', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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

    test('that a maxAge of zero is rejected — TTL must be at least 1 second', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          maxAgeNotPositiveIntegerErrorMessage({ directiveName: OPENFED_ENTITY_CACHE, value: 0 }),
        ]),
      );
    });

    test('that a negative maxAge is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          maxAgeNotPositiveIntegerErrorMessage({ directiveName: OPENFED_ENTITY_CACHE, value: -5 }),
        ]),
      );
    });

    test('that a negative negativeCacheTTL is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          negativeCacheTTLNotNonNegativeIntegerErrorMessage(-1),
        ]),
      );
    });
  });

  describe('configuration extraction tests', () => {
    test('that defaults produce the correct EntityCacheConfig', () => {
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
      ] satisfies Array<EntityCacheConfiguration>);
    });

    test('that every argument propagates to the EntityCacheConfig', () => {
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
      ] satisfies Array<EntityCacheConfiguration>);
    });

    test('that @openfed__entityCache is non-repeatable', () => {
      const { errors, warnings } = normalizeSubgraphFailure(
        createSubgraph(
          'a',
          `
          type Entity @key(fields: "id") @openfed__entityCache(maxAge: 1) {
            id: ID!
          }
          
          extend type Entity @openfed__entityCache(maxAge: 1) {
            name: String!
          }
        `,
        ),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidDirectiveError(OPENFED_ENTITY_CACHE, 'Entity', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(OPENFED_ENTITY_CACHE),
        ]),
      ]);
      expect(warnings).toHaveLength(0);
    });
  });
});

// Helper: normalizes the subgraph and returns the entityCache config array attached to `typeName`.
// On this branch entity-caching config is nested under ConfigurationData.entityCaching.
function getEntityCacheConfigs(sdl: string, typeName: string): Array<EntityCacheConfiguration> | undefined {
  const result = normalizeSubgraphSuccess(createSubgraphWithDefaultName(sdl), ROUTER_COMPATIBILITY_VERSION_ONE);
  return result.configurationDataByTypeName.get(typeName)?.entityCaching?.entityCacheConfigurations;
}
