import { describe, expect, test } from 'vitest';
import {
  type CachePopulateConfiguration,
  type ConfigurationData,
  FIRST_ORDINAL,
  invalidDirectiveError,
  invalidEntityReturnTypeErrorMessage,
  invalidMutationOrSubscriptionFieldCoordsErrorMessage,
  invalidMutuallyExclusiveCacheDirectivesError,
  maxAgeNotPositiveIntegerErrorMessage,
  MUTATION,
  OPENFED_CACHE_POPULATE,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  SUBSCRIPTION,
  type TypeName,
} from '../../../src';
import { createSubgraphWithDefaultName, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';
import { OperationTypeNode } from 'graphql';

describe('@openfed__cachePopulate tests', () => {
  describe('Mutation fields tests', () => {
    test("that it normalizes without maxAge (uses the entity's default TTL)", () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
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

    test('that it normalizes with an explicit maxAge override', () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
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

    test('that a config with an explicit maxAge override is produced', () => {
      const config = getConfigForType(
        createSubgraphWithDefaultName(`
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
          entityTypeName: 'Product',
          fieldName: 'createProduct',
          maxAgeSeconds: 120,
          operationType: OperationTypeNode.MUTATION,
        },
      ] satisfies Array<CachePopulateConfiguration>);
    });

    test('that a renamed Mutation root type keys the config under the canonical name', () => {
      const subgraph = createSubgraphWithDefaultName(`
            schema {
              mutation: NewMutations
            }
            type Query { dummy: String! }
            type NewMutations {
              createProduct(name: String!): Product @openfed__cachePopulate
            }
            type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
              name: String!
            }
          `);
      const config = getConfigForType(subgraph, MUTATION);
      // The config must be keyed under the renamed root name `Mutation`, not the original `NewMutations`.
      expect(config).toBeDefined();
      expect(config!.typeName).toBe(MUTATION);
      expect(config!.entityCaching?.cachePopulateConfigurations).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldName: 'createProduct',
          maxAgeSeconds: 60,
          operationType: OperationTypeNode.MUTATION,
        },
      ] satisfies Array<CachePopulateConfiguration>);
      expect(getConfigForType(subgraph, 'NewMutations')).toBeUndefined();
    });
  });

  describe('Subscription fields tests', () => {
    test('that it normalizes a Subscription field', () => {
      const { schema } = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
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

    test('that if maxAge is not provided, the value falls back to the entityCache maxAge', () => {
      const config = getConfigForType(
        createSubgraphWithDefaultName(`
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
          entityTypeName: 'Product',
          fieldName: 'itemCreated',
          maxAgeSeconds: 60,
          operationType: OperationTypeNode.SUBSCRIPTION,
        },
      ] satisfies Array<CachePopulateConfiguration>);
    });
  });

  describe('Validation errors tests', () => {
    test('that it rejects placement on a Query field', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          invalidMutationOrSubscriptionFieldCoordsErrorMessage('Query.product'),
        ]),
      );
    });

    test('that it rejects a return type that is not a cached entity', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
      const fieldCoords = 'Mutation.createProduct';
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_CACHE_POPULATE, fieldCoords, FIRST_ORDINAL, [
          invalidEntityReturnTypeErrorMessage({ fieldCoords, returnTypeName: 'Result' }),
        ]),
      );
    });

    test('that it rejects a maxAge of zero', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
          maxAgeNotPositiveIntegerErrorMessage(0),
        ]),
      );
    });

    test('that an invalid maxAge does not produce a config (regression)', () => {
      // Regression: a maxAge of 0 once emitted a cachePopulate config despite failing validation.
      // Composition now fails outright, so assert exactly the one @openfed__cachePopulate error.
      const { errors, warnings } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
      expect(errors).toStrictEqual([
        invalidDirectiveError(OPENFED_CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(0),
        ]),
      ]);
      expect(warnings).toHaveLength(0);
    });

    test('that it rejects coexisting @openfed__cacheInvalidate and @openfed__cachePopulate on the same field', () => {
      // A mutation can't both evict and write to the cache for the same entity
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
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
      expect(errors[0]).toStrictEqual(invalidMutuallyExclusiveCacheDirectivesError('Mutation.updateProduct'));
    });

    test('that if maxAge is not provided, the value falls back to the entityCache maxAge', () => {
      const subgraph = createSubgraphWithDefaultName(`
        type Query {
          dummy: String!
        }
        
        type Mutation {
          createProduct(name: String!): Product @openfed__cachePopulate
        }
        
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const config = getConfigForType(subgraph, MUTATION);
      expect(config).toBeDefined();
      expect(config!.entityCaching?.cachePopulateConfigurations).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldName: 'createProduct',
          maxAgeSeconds: 60,
          operationType: OperationTypeNode.MUTATION,
        },
      ] satisfies Array<CachePopulateConfiguration>);
    });

    test('that an error is returned if maxAge is provided as null', () => {
      // A mutation can't both evict and write to the cache for the same entity
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
            type Query { dummy: String! }
            type Mutation {
              updateProduct(id: ID!): Product @openfed__cachePopulate(maxAge: null)
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
        invalidDirectiveError(OPENFED_CACHE_POPULATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(null),
        ]),
      );
    });
  });
});

// Returns the ConfigurationData for a type. Entity-caching config is nested under `.entityCaching`.
function getConfigForType(sg: Subgraph, typeName: TypeName): ConfigurationData | undefined {
  const { configurationDataByTypeName } = normalizeSubgraphSuccess(sg, ROUTER_COMPATIBILITY_VERSION_ONE);
  return configurationDataByTypeName.get(typeName);
}
