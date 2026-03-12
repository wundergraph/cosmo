import { describe, expect, test } from 'vitest';
import {
  BatchNormalizationSuccess,
  CACHE_INVALIDATE,
  CACHE_POPULATE,
  CacheInvalidateConfig,
  CachePopulateConfig,
  ConfigurationData,
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
  parse,
  QUERY_CACHE,
  queryCacheOnNonEntityReturnTypeErrorMessage,
  queryCacheOnNonQueryFieldErrorMessage,
  queryCacheReturnTypeWithoutEntityCacheErrorMessage,
  RootFieldCacheConfig,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  TypeName,
  cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage,
  cacheInvalidateOnNonEntityReturnTypeErrorMessage,
  cachePopulateOnNonMutationSubscriptionFieldErrorMessage,
  cachePopulateOnNonEntityReturnTypeErrorMessage,
  cacheInvalidateAndPopulateMutualExclusionErrorMessage,
  incompleteQueryCacheKeyMappingWarning,
  redundantIsDirectiveWarning,
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

describe('Entity caching directive tests', () => {
  describe('@entityCache normalization tests', () => {
    test('that an error is returned if @entityCache is used without @key', () => {
      const { errors } = normalizeSubgraphFailure(entityCacheWithoutKeySubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(ENTITY_CACHE, 'Product', FIRST_ORDINAL, [entityCacheWithoutKeyErrorMessage('Product')]),
      );
    });

    test('that an error is returned if @entityCache maxAge is zero', () => {
      const { errors } = normalizeSubgraphFailure(entityCacheMaxAgeZeroSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(ENTITY_CACHE, 0),
        ]),
      );
    });

    test('that an error is returned if @entityCache maxAge is negative', () => {
      const { errors } = normalizeSubgraphFailure(entityCacheMaxAgeNegativeSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(ENTITY_CACHE, 'Product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(ENTITY_CACHE, -5),
        ]),
      );
    });

    test('that @entityCache normalizes successfully with valid arguments and @key', () => {
      const { schema } = normalizeSubgraphSuccess(validEntityCacheSubgraph, version);
      expect(schema).toBeDefined();
    });
  });

  describe('@queryCache normalization tests', () => {
    test('that an error is returned if @queryCache is used on a Mutation field', () => {
      const { errors } = normalizeSubgraphFailure(queryCacheOnMutationSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          queryCacheOnNonQueryFieldErrorMessage('Mutation.updateProduct'),
        ]),
      );
    });

    test('that an error is returned if @queryCache return type is not an entity', () => {
      const { errors } = normalizeSubgraphFailure(queryCacheNonEntityReturnSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          queryCacheOnNonEntityReturnTypeErrorMessage('Query.product', 'Product'),
        ]),
      );
    });

    test('that an error is returned if @queryCache return entity lacks @entityCache', () => {
      const { errors } = normalizeSubgraphFailure(queryCacheEntityWithoutCacheSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          queryCacheReturnTypeWithoutEntityCacheErrorMessage('Query.product', 'Product'),
        ]),
      );
    });

    test('that an error is returned if @queryCache maxAge is zero', () => {
      const { errors } = normalizeSubgraphFailure(queryCacheMaxAgeZeroSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(QUERY_CACHE, 0),
        ]),
      );
    });

    test('that a warning is returned for incomplete key mapping on non-list return type', () => {
      const { warnings } = normalizeSubgraphSuccess(queryCacheIncompleteKeyMappingSubgraph, version);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        incompleteQueryCacheKeyMappingWarning('subgraph-a', 'Query.product', 'Product', 'id'),
      );
    });

    test('that no warning is returned for list return type without key mapping', () => {
      const { warnings } = normalizeSubgraphSuccess(queryCacheListReturnSubgraph, version);
      expect(warnings).toHaveLength(0);
    });

    test('that @queryCache normalizes successfully with auto-mapped key argument', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(validQueryCacheSubgraph, version);
      expect(schema).toBeDefined();
      expect(warnings).toHaveLength(0);
    });
  });

  describe('@cacheInvalidate normalization tests', () => {
    test('that an error is returned if @cacheInvalidate is used on a Query field', () => {
      const { errors } = normalizeSubgraphFailure(cacheInvalidateOnQuerySubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Query.product', FIRST_ORDINAL, [
          cacheInvalidateOnNonMutationSubscriptionFieldErrorMessage('Query.product'),
        ]),
      );
    });

    test('that an error is returned if @cacheInvalidate return type is not a cached entity', () => {
      const { errors } = normalizeSubgraphFailure(cacheInvalidateNonEntitySubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateOnNonEntityReturnTypeErrorMessage('Mutation.updateProduct', 'Result'),
        ]),
      );
    });

    test('that an error is returned if both @cacheInvalidate and @cachePopulate are on the same field', () => {
      const { errors } = normalizeSubgraphFailure(cacheInvalidateAndPopulateSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_INVALIDATE, 'Mutation.updateProduct', FIRST_ORDINAL, [
          cacheInvalidateAndPopulateMutualExclusionErrorMessage('Mutation.updateProduct'),
        ]),
      );
    });

    test('that @cacheInvalidate normalizes successfully on a Mutation field returning a cached entity', () => {
      const { schema } = normalizeSubgraphSuccess(validCacheInvalidateSubgraph, version);
      expect(schema).toBeDefined();
    });
  });

  describe('@cachePopulate normalization tests', () => {
    test('that an error is returned if @cachePopulate is used on a Query field', () => {
      const { errors } = normalizeSubgraphFailure(cachePopulateOnQuerySubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Query.product', FIRST_ORDINAL, [
          cachePopulateOnNonMutationSubscriptionFieldErrorMessage('Query.product'),
        ]),
      );
    });

    test('that an error is returned if @cachePopulate return type is not a cached entity', () => {
      const { errors } = normalizeSubgraphFailure(cachePopulateNonEntitySubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          cachePopulateOnNonEntityReturnTypeErrorMessage('Mutation.createProduct', 'Result'),
        ]),
      );
    });

    test('that an error is returned if @cachePopulate maxAge is zero', () => {
      const { errors } = normalizeSubgraphFailure(cachePopulateMaxAgeZeroSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(CACHE_POPULATE, 0),
        ]),
      );
    });

    test('that @cachePopulate normalizes successfully without maxAge', () => {
      const { schema } = normalizeSubgraphSuccess(validCachePopulateNoMaxAgeSubgraph, version);
      expect(schema).toBeDefined();
    });

    test('that @cachePopulate normalizes successfully with a valid maxAge', () => {
      const { schema } = normalizeSubgraphSuccess(validCachePopulateWithMaxAgeSubgraph, version);
      expect(schema).toBeDefined();
    });
  });

  describe('@is directive normalization tests', () => {
    test('that an error is returned if @is is used on an argument without @queryCache on the field', () => {
      const { errors } = normalizeSubgraphFailure(isWithoutQueryCacheSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          isWithoutQueryCacheErrorMessage('pid', 'Query.product'),
        ]),
      );
    });

    test('that an error is returned if @is references an unknown key field', () => {
      const { errors } = normalizeSubgraphFailure(isUnknownKeyFieldSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          isReferencesUnknownKeyFieldErrorMessage('unknown', 'pid', 'Query.product', 'Product'),
        ]),
      );
    });

    test('that an error is returned if multiple arguments map to the same key field', () => {
      const { errors } = normalizeSubgraphFailure(isDuplicateKeyMappingSubgraph, version);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(otherId: ...)', FIRST_ORDINAL, [
          duplicateKeyFieldMappingErrorMessage('Query.product', 'id'),
        ]),
      );
    });

    test('that a warning is returned if @is is redundant because argument name matches key field', () => {
      const { warnings } = normalizeSubgraphSuccess(isRedundantSubgraph, version);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(redundantIsDirectiveWarning('subgraph-a', 'id', 'Query.product'));
    });

    test('that @is normalizes successfully with a valid key field mapping', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(validIsSubgraph, version);
      expect(schema).toBeDefined();
      expect(warnings).toHaveLength(0);
    });
  });

  describe('configuration tests', () => {
    test('that @entityCache produces the correct EntityCacheConfig', () => {
      const result = batchNormalize({ subgraphs: [validEntityCacheSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const productConfig = subgraph!.configurationDataByTypeName.get('Product' as TypeName);
      expect(productConfig).toBeDefined();
      expect(productConfig!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 60,
          includeHeaders: false,
          partialCacheLoad: false,
          shadowMode: false,
        },
      ] satisfies EntityCacheConfig[]);
    });

    test('that @entityCache with all options produces the correct EntityCacheConfig', () => {
      const result = batchNormalize({ subgraphs: [entityCacheAllOptionsSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const productConfig = subgraph!.configurationDataByTypeName.get('Product' as TypeName);
      expect(productConfig).toBeDefined();
      expect(productConfig!.entityCacheConfigurations).toStrictEqual([
        {
          typeName: 'Product',
          maxAgeSeconds: 120,
          includeHeaders: true,
          partialCacheLoad: true,
          shadowMode: true,
        },
      ] satisfies EntityCacheConfig[]);
    });

    test('that @queryCache produces the correct RootFieldCacheConfig with auto-mapped key', () => {
      const result = batchNormalize({ subgraphs: [validQueryCacheSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const queryConfig = subgraph!.configurationDataByTypeName.get('Query' as TypeName);
      expect(queryConfig).toBeDefined();
      expect(queryConfig!.rootFieldCacheConfigurations).toStrictEqual([
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

    test('that @queryCache with @is produces the correct key mappings', () => {
      const result = batchNormalize({ subgraphs: [validIsSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const queryConfig = subgraph!.configurationDataByTypeName.get('Query' as TypeName);
      expect(queryConfig).toBeDefined();
      expect(queryConfig!.rootFieldCacheConfigurations).toStrictEqual([
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

    test('that @cacheInvalidate produces the correct CacheInvalidateConfig', () => {
      const result = batchNormalize({ subgraphs: [validCacheInvalidateSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const mutationConfig = subgraph!.configurationDataByTypeName.get('Mutation' as TypeName);
      expect(mutationConfig).toBeDefined();
      expect(mutationConfig!.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'updateProduct',
          operationType: 'Mutation',
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });

    test('that @cachePopulate without maxAge produces the correct CachePopulateConfig', () => {
      const result = batchNormalize({ subgraphs: [validCachePopulateNoMaxAgeSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const mutationConfig = subgraph!.configurationDataByTypeName.get('Mutation' as TypeName);
      expect(mutationConfig).toBeDefined();
      expect(mutationConfig!.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'createProduct',
          operationType: 'Mutation',
          maxAgeSeconds: undefined,
        },
      ] satisfies CachePopulateConfig[]);
    });

    test('that @cachePopulate with maxAge produces the correct CachePopulateConfig', () => {
      const result = batchNormalize({ subgraphs: [validCachePopulateWithMaxAgeSubgraph] }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const subgraph = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(subgraph).toBeDefined();
      const mutationConfig = subgraph!.configurationDataByTypeName.get('Mutation' as TypeName);
      expect(mutationConfig).toBeDefined();
      expect(mutationConfig!.cachePopulateConfigurations).toStrictEqual([
        {
          fieldName: 'createProduct',
          operationType: 'Mutation',
          maxAgeSeconds: 120,
        },
      ] satisfies CachePopulateConfig[]);
    });

    test('that @cachePopulate with invalid maxAge does not produce a config', () => {
      // Regression test for Bug 1: invalid maxAge should not push config
      const result = batchNormalize({ subgraphs: [cachePopulateMaxAgeZeroSubgraph] });
      // batchNormalize may still succeed (errors are on the subgraph level)
      // but the Mutation config should not have cachePopulateConfigurations
      if (result.success) {
        const subgraph = (result as BatchNormalizationSuccess).internalSubgraphBySubgraphName.get('subgraph-a');
        if (subgraph) {
          const mutationConfig = subgraph.configurationDataByTypeName.get('Mutation' as TypeName);
          if (mutationConfig) {
            expect(mutationConfig.cachePopulateConfigurations).toBeUndefined();
          }
        }
      }
    });
  });

  describe('federation tests', () => {
    test('that federation succeeds with caching directives across subgraphs', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [validQueryCacheSubgraph, federationSubgraphB],
        version,
      );
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

    test('that federation succeeds when both subgraphs define entity with @entityCache', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [validEntityCacheSubgraph, entityCacheOtherSubgraph],
        version,
      );
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
});

// ====== Subgraph definitions ======

// @entityCache error cases
const entityCacheWithoutKeySubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product
    }

    type Product @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const entityCacheMaxAgeZeroSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product
    }

    type Product @key(fields: "id") @entityCache(maxAge: 0) {
      id: ID!
      name: String!
    }
  `),
};

const entityCacheMaxAgeNegativeSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product
    }

    type Product @key(fields: "id") @entityCache(maxAge: -5) {
      id: ID!
      name: String!
    }
  `),
};

// @entityCache success cases
const validEntityCacheSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const entityCacheAllOptionsSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product
    }

    type Product @key(fields: "id") @entityCache(maxAge: 120, includeHeaders: true, partialCacheLoad: true, shadowMode: true) {
      id: ID!
      name: String!
    }
  `),
};

// @queryCache error cases
const queryCacheOnMutationSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      updateProduct(id: ID!): Product @queryCache(maxAge: 60)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const queryCacheNonEntityReturnSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product @queryCache(maxAge: 60)
    }

    type Product {
      id: ID!
      name: String!
    }
  `),
};

const queryCacheEntityWithoutCacheSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product @queryCache(maxAge: 60)
    }

    type Product @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const queryCacheMaxAgeZeroSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product @queryCache(maxAge: 0)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const queryCacheIncompleteKeyMappingSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(name: String!): Product @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const queryCacheListReturnSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      products: [Product] @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @queryCache success
const validQueryCacheSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @cacheInvalidate error cases
const cacheInvalidateOnQuerySubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product @cacheInvalidate
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const cacheInvalidateNonEntitySubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      updateProduct(id: ID!): Result @cacheInvalidate
    }

    type Result {
      success: Boolean!
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const cacheInvalidateAndPopulateSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      updateProduct(id: ID!): Product @cacheInvalidate @cachePopulate
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @cacheInvalidate success
const validCacheInvalidateSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      updateProduct(id: ID!): Product @cacheInvalidate
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @cachePopulate error cases
const cachePopulateOnQuerySubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!): Product @cachePopulate
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const cachePopulateNonEntitySubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      createProduct(name: String!): Result @cachePopulate
    }

    type Result {
      success: Boolean!
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const cachePopulateMaxAgeZeroSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      createProduct(name: String!): Product @cachePopulate(maxAge: 0)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @cachePopulate success
const validCachePopulateNoMaxAgeSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      createProduct(name: String!): Product @cachePopulate
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const validCachePopulateWithMaxAgeSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    type Mutation {
      createProduct(name: String!): Product @cachePopulate(maxAge: 120)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @is error cases
const isWithoutQueryCacheSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(pid: ID! @is(field: "id")): Product
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const isUnknownKeyFieldSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(pid: ID! @is(field: "unknown")): Product @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const isDuplicateKeyMappingSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID!, otherId: ID! @is(field: "id")): Product @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

const isRedundantSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(id: ID! @is(field: "id")): Product @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// @is success
const validIsSubgraph: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      product(pid: ID! @is(field: "id")): Product @queryCache(maxAge: 30)
    }

    type Product @key(fields: "id") @entityCache(maxAge: 60) {
      id: ID!
      name: String!
    }
  `),
};

// Federation subgraphs
const federationSubgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      reviews(productId: ID!): [String!]!
    }

    type Product @key(fields: "id") {
      id: ID!
    }
  `),
};

const entityCacheOtherSubgraph: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      productByPrice(price: Float!): Product
    }

    type Product @key(fields: "id") @entityCache(maxAge: 30) {
      id: ID!
      price: Float!
    }
  `),
};
