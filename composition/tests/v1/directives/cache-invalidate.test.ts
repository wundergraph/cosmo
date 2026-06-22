import { describe, expect, test } from 'vitest';
import { OperationTypeNode } from 'graphql';
import {
  type BatchNormalizationSuccess,
  BatchNormalizer,
  OPENFED_CACHE_INVALIDATE,
  type CacheInvalidationConfiguration,
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
import { createSubgraphWithDefaultName, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

describe('@openfed__cacheInvalidate directive tests', () => {
  describe('Mutation field tests', () => {
    test('that a valid CacheInvalidationConfiguration is produced', () => {
      const config = getConfigForType(
        createSubgraphWithDefaultName(`
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
      expect(config!.entityCaching?.cacheInvalidationConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: OperationTypeNode.MUTATION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidationConfiguration[]);
    });

    test('that a renamed Mutation root type keys the config under the canonical name', () => {
      const subgraph = createSubgraphWithDefaultName(`
            schema {
              mutation: NewMutations
            }
            type Query { dummy: String! }
            type NewMutations {
              updateProduct(id: ID!): Product @openfed__cacheInvalidate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `);
      const config = getConfigForType(subgraph, MUTATION);
      // The config must be keyed under the renamed root name `Mutation`, not the original `Mutations`.
      expect(config).toBeDefined();
      expect(config!.typeName).toBe(MUTATION);
      expect(config!.entityCaching?.cacheInvalidationConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: OperationTypeNode.MUTATION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidationConfiguration[]);
      expect(getConfigForType(subgraph, 'NewMutations')).toBeUndefined();
    });

    test('that multiple cacheInvalidate fields on the same type accumulate into one config array', () => {
      const config = getConfigForType(
        createSubgraphWithDefaultName(`
            type Query { dummy: String! }
            type Mutation {
              updateProduct(id: ID!): Product @openfed__cacheInvalidate
              deleteProduct(id: ID!): Product @openfed__cacheInvalidate
              updateReview(id: ID!): Review @openfed__cacheInvalidate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
            type Review @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              body: String!
            }
          `),
        MUTATION,
      );
      expect(config).toBeDefined();
      // Each field on Mutation shares the same configurationData, so configs accumulate via
      // `[...existingCacheInvalidates, config]` — the 2nd and 3rd fields see existing length > 0.
      expect(config!.entityCaching?.cacheInvalidationConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: OperationTypeNode.MUTATION,
          entityTypeName: 'Product',
        },
        {
          fieldName: 'deleteProduct',
          operationType: OperationTypeNode.MUTATION,
          entityTypeName: 'Product',
        },
        {
          fieldName: 'updateReview',
          operationType: OperationTypeNode.MUTATION,
          entityTypeName: 'Review',
        },
      ] satisfies CacheInvalidationConfiguration[]);
    });
  });

  describe('Subscription field tests', () => {
    test('that a valid CacheInvalidationConfiguration is produced', () => {
      const config = getConfigForType(
        createSubgraphWithDefaultName(`
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
      expect(config!.entityCaching?.cacheInvalidationConfigurations).toStrictEqual([
        {
          fieldName: 'itemUpdated',
          operationType: OperationTypeNode.SUBSCRIPTION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidationConfiguration[]);
    });
  });

  describe('validation error tests', () => {
    test('that a placement on a Query field is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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

    test('that a return type that is not a cached entity is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          cacheInvalidateOnNonEntityReturnTypeErrorMessage({
            fieldCoords: 'Mutation.updateProduct',
            returnType: 'Result',
          }),
        ]),
      );
    });

    test('that a @key entity without @openfed__entityCache is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          cacheInvalidateOnNonEntityReturnTypeErrorMessage({
            fieldCoords: 'Mutation.updateProduct',
            returnType: 'Product',
          }),
        ]),
      );
    });

    test('that a placement on a non-root object-type field is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
function getConfigForType(sg: Subgraph, typeName: TypeName): ConfigurationData | undefined {
  const result = new BatchNormalizer({ subgraphs: [sg] }).batchNormalize() as BatchNormalizationSuccess;
  expect(result.success).toBe(true);
  const internal = result.internalSubgraphByName.get(sg.name);
  expect(internal).toBeDefined();
  return internal!.configurationDataByTypeName.get(typeName);
}
