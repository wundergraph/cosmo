import { describe, expect, test } from 'vitest';
import {
  type BatchNormalizationSuccess,
  BatchNormalizer,
  OPENFED_CACHE_INVALIDATE,
  OPENFED_CACHE_POPULATE,
  type CachePopulateConfig,
  type ConfigurationData,
  FIRST_ORDINAL,
  invalidDirectiveError,
  MUTATION,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  subgraphValidationError,
  SUBSCRIPTION,
  type TypeName,
} from '../../../src';
import {
  cacheInvalidateAndPopulateMutualExclusionErrorMessage,
  cachePopulateOnNonEntityReturnTypeErrorMessage,
  cachePopulateOnNonMutationSubscriptionFieldErrorMessage,
  maxAgeNotPositiveIntegerErrorMessage,
} from '../../../src/errors/errors';
import { createSubgraphWithDefault, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

describe('@openfed__cachePopulate', () => {
  describe('on Mutation fields', () => {
    test("normalizes without maxAge (uses the entity's default TTL)", () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Mutation {
              createProduct(name: String!): Product @openfed__cachePopulate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schema).toBeDefined();
    });

    test('normalizes with an explicit maxAge override', () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Mutation {
              createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 120)
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schema).toBeDefined();
    });

    test('config without maxAge leaves maxAgeSeconds undefined', () => {
      const config = getConfigForType(
        createSubgraphWithDefault(`
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
      expect(config!.entityCaching?.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'createProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
          maxAgeSeconds: undefined,
        },
      ] satisfies CachePopulateConfig[]);
    });

    test('config with an explicit maxAge override', () => {
      const config = getConfigForType(
        createSubgraphWithDefault(`
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
      expect(config!.entityCaching?.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'createProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
          maxAgeSeconds: 120,
        },
      ] satisfies CachePopulateConfig[]);
    });
  });

  describe('on Subscription fields', () => {
    test('normalizes a Subscription field', () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Subscription {
              itemCreated: Product @openfed__cachePopulate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schema).toBeDefined();
    });

    test('produces the correct config', () => {
      const config = getConfigForType(
        createSubgraphWithDefault(`
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
      expect(config!.entityCaching?.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'itemCreated',
          operationType: SUBSCRIPTION,
          entityTypeName: 'Product',
          maxAgeSeconds: undefined,
        },
      ] satisfies CachePopulateConfig[]);
    });
  });

  describe('validation errors', () => {
    test('rejects placement on a Query field', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
            type Query {
              product(id: ID!): Product @openfed__cachePopulate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_POPULATE, 'Query.product', FIRST_ORDINAL, [
          cachePopulateOnNonMutationSubscriptionFieldErrorMessage('Query.product'),
        ]),
      );
    });

    test('rejects a return type that is not a cached entity', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
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
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          cachePopulateOnNonEntityReturnTypeErrorMessage('Mutation.createProduct', 'Result'),
        ]),
      );
    });

    test('rejects a maxAge of zero', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Mutation {
              createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 0)
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage({ directiveName: OPENFED_CACHE_POPULATE, value: 0 }),
        ]),
      );
    });

    test('an invalid maxAge does not produce a config (regression)', () => {
      // Regression: a maxAge of 0 once emitted a cachePopulate config despite failing validation.
      // Composition now fails outright, so assert exactly the one @openfed__cachePopulate error.
      const result = new BatchNormalizer({
        subgraphs: [
          createSubgraphWithDefault(`
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
      }).batchNormalize();
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-default-a', [
          invalidDirectiveError(OPENFED_CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
            maxAgeNotPositiveIntegerErrorMessage({ directiveName: OPENFED_CACHE_POPULATE, value: 0 }),
          ]),
        ]),
      );
    });

    test('rejects coexisting @openfed__cacheInvalidate and @openfed__cachePopulate on the same field', () => {
      // A mutation can't both evict and write to the cache for the same entity
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Mutation {
              updateProduct(id: ID!): Product @openfed__cacheInvalidate @openfed__cachePopulate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateAndPopulateMutualExclusionErrorMessage('Mutation.updateProduct'),
        ]),
      );
    });
  });
});

// Returns the ConfigurationData for a type. Entity-caching config is nested under `.entityCaching`.
function getConfigForType(sg: Subgraph, typeName: string): ConfigurationData | undefined {
  const result = new BatchNormalizer({ subgraphs: [sg] }).batchNormalize() as BatchNormalizationSuccess;
  expect(result.success).toBe(true);
  const internal = result.internalSubgraphByName.get(sg.name);
  expect(internal).toBeDefined();
  return internal!.configurationDataByTypeName.get(typeName as TypeName);
}
