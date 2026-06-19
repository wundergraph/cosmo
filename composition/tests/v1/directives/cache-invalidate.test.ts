import { describe, expect, test } from 'vitest';
import {
  type BatchNormalizationSuccess,
  BatchNormalizer,
  OPENFED_CACHE_INVALIDATE,
  type CacheInvalidateConfig,
  type ConfigurationData,
  FIRST_ORDINAL,
  invalidDirectiveError,
  MUTATION,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  SUBSCRIPTION,
  type TypeName,
} from '../../../src';
import {
  cacheInvalidateOnNonEntityReturnTypeErrorMessage,
  cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage,
} from '../../../src/errors/errors';
import { createSubgraphWithDefault, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

describe('@openfed__cacheInvalidate', () => {
  describe('on Mutation fields', () => {
    test('normalizes a Mutation field returning a cached entity', () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Mutation {
              updateProduct(id: ID!): Product @openfed__cacheInvalidate
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

    test('produces a CacheInvalidateConfig', () => {
      const config = getConfigForType(
        createSubgraphWithDefault(`
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
      expect(config!.entityCaching?.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: MUTATION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });
  });

  describe('on Subscription fields', () => {
    test('normalizes a Subscription field returning a cached entity', () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Subscription {
              itemUpdated: Product @openfed__cacheInvalidate
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

    test('produces a CacheInvalidateConfig', () => {
      const config = getConfigForType(
        createSubgraphWithDefault(`
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
      expect(config!.entityCaching?.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'itemUpdated',
          operationType: SUBSCRIPTION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });
  });

  describe('validation errors', () => {
    test('rejects placement on a Query field', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
            type Query {
              product(id: ID!): Product @openfed__cacheInvalidate
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
        invalidDirectiveError(OPENFED_CACHE_INVALIDATE, 'Query.product', FIRST_ORDINAL, [
          cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage('Query.product'),
        ]),
      );
    });

    test('rejects a return type that is not a cached entity', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
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
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateOnNonEntityReturnTypeErrorMessage('Mutation.updateProduct', 'Result'),
        ]),
      );
    });

    test('rejects a @key entity without @openfed__entityCache', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
            type Query { dummy: String! }
            type Mutation {
              updateProduct(id: ID!): Product @openfed__cacheInvalidate
            }
            type Product @key(fields: "id") {
              id: ID!
              name: String!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateOnNonEntityReturnTypeErrorMessage('Mutation.updateProduct', 'Product'),
        ]),
      );
    });

    test('rejects placement on a non-root object-type field', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
            type Query {
              product: Product
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              related: Related @openfed__cacheInvalidate
            }
            type Related @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
            }
          `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_INVALIDATE, 'Product.related', FIRST_ORDINAL, [
          cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage('Product.related'),
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
