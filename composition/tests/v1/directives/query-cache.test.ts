import { describe, expect, test } from 'vitest';
import {
  batchListValuedKeyRequiresNestedListsErrorMessage,
  duplicateKeyFieldMappingErrorMessage,
  explicitBatchAdditionalNonKeyArgumentErrorMessage,
  explicitCompositeAdditionalNonKeyArgumentErrorMessage,
  explicitIncompleteCompositeKeyErrorMessage,
  explicitScalarArgumentsCannotEstablishBatchMappingErrorMessage,
  explicitSingularAdditionalNonKeyArgumentErrorMessage,
  explicitTypeMismatchErrorMessage,
  FIRST_ORDINAL,
  inputObjectCompositeMissingFieldErrorMessage,
  inputObjectCompositeTypeMismatchErrorMessage,
  invalidDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
  isReferencesUnknownKeyFieldErrorMessage,
  isWithoutQueryCacheErrorMessage,
  listArgumentToScalarKeySpecErrorMessage,
  maxAgeNotPositiveIntegerErrorMessage,
  multipleListArgumentsBatchFactoryMessage,
  nestedInputObjectMissingFieldErrorMessage,
  nestedInputObjectTypeMismatchErrorMessage,
  nestedKeyRequiresInputObjectErrorMessage,
  nonInputArgumentCannotTargetCompositeKeyErrorMessage,
  nonKeyFieldSpecErrorMessage,
  OPENFED_IS,
  OPENFED_QUERY_CACHE,
  queryCacheOnNonEntityReturnTypeErrorMessage,
  queryCacheOnNonQueryFieldErrorMessage,
  queryCacheReturnEntityMissingEntityCacheWarning,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  scalarArgumentToListKeySpecErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
} from '../../../src';
import { createSubgraphWithDefault, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

describe('@openfed__queryCache', () => {
  describe('configuration extraction', () => {
    test('a queryCache field returning a cached entity produces a rootFieldCacheConfiguration with defaults', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const config = result.configurationDataByTypeName.get('Query');
      const rootFieldConfigs = config!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs).toBeDefined();
      expect(rootFieldConfigs).toHaveLength(1);
      expect(rootFieldConfigs![0]).toMatchObject({
        fieldName: 'user',
        maxAgeSeconds: 60,
        includeHeaders: false,
        shadowMode: false,
        entityTypeName: 'User',
      });
      expect(result.warnings).toHaveLength(0);
    });

    test('explicit includeHeaders and shadowMode are reflected in the extracted config', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 120, includeHeaders: true, shadowMode: true)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0]).toMatchObject({
        fieldName: 'user',
        maxAgeSeconds: 120,
        includeHeaders: true,
        shadowMode: true,
      });
    });

    test('@openfed__is maps an argument to the returned entity @key field', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            user(id: ID! @openfed__is(fields: "id")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'User',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
      ]);
    });

    test('multiple queryCache fields each produce a rootFieldCacheConfiguration', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 60)
            product: Product @openfed__queryCache(maxAge: 30)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs).toHaveLength(2);
      expect(rootFieldConfigs!.map((c) => c.fieldName)).toEqual(['user', 'product']);
    });

    test('a composite @openfed__is via an input-object argument maps every nested key field', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            product(key: ProductKey! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 60)
          }
          input ProductKey {
            id: ID!
            sku: String!
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['key', 'id'] },
            { entityKeyField: 'sku', argumentPath: ['key', 'sku'] },
          ],
        },
      ]);
    });

    test('separate scalar arguments together cover a composite @key', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            product(id: ID! @openfed__is(fields: "id"), sku: String! @openfed__is(fields: "sku")): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['id'] },
            { entityKeyField: 'sku', argumentPath: ['sku'] },
          ],
        },
      ]);
    });

    test('a nested @openfed__is selection maps through an input object to a nested @key field', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            review(key: ReviewKey! @openfed__is(fields: "store{id}")): Review @openfed__queryCache(maxAge: 60)
          }
          input ReviewKey {
            store: StoreKey!
          }
          input StoreKey {
            id: ID!
          }
          type Review @key(fields: "store{id}") @openfed__entityCache(maxAge: 60) {
            store: Store!
          }
          type Store @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'Review',
          fieldMappings: [{ entityKeyField: 'store.id', argumentPath: ['key', 'store', 'id'] }],
        },
      ]);
    });

    test('a composite @key containing a list-valued field maps through an input object', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            product(key: ProductKey! @openfed__is(fields: "id tags")): Product @openfed__queryCache(maxAge: 60)
          }
          input ProductKey {
            id: ID!
            tags: [String!]!
          }
          type Product @key(fields: "id tags") @openfed__entityCache(maxAge: 60) {
            id: ID!
            tags: [String!]!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['key', 'id'] },
            { entityKeyField: 'tags', argumentPath: ['key', 'tags'] },
          ],
        },
      ]);
    });

    test('an entity with multiple @keys maps only the @key fully covered by arguments', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            user(id: ID! @openfed__is(fields: "id")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @key(fields: "email") @openfed__entityCache(maxAge: 60) {
            id: ID!
            email: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'User',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
      ]);
    });

    test('a list-returning field with a list of input objects produces a batch composite mapping', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            products(keys: [ProductKey!]! @openfed__is(fields: "id sku")): [Product] @openfed__queryCache(maxAge: 60)
          }
          input ProductKey {
            id: ID!
            sku: String!
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const batchConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(batchConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['keys', 'id'], isBatch: true },
            { entityKeyField: 'sku', argumentPath: ['keys', 'sku'], isBatch: true },
          ],
        },
      ]);
    });

    test('a list-returning field with a list argument produces a batch mapping', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            users(ids: [ID!]! @openfed__is(fields: "id")): [User] @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'User',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['ids'], isBatch: true }],
        },
      ]);
    });

    test('a batch lookup against a list-valued @key field accepts a list-of-lists argument', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            products(tags: [[String!]!]! @openfed__is(fields: "tags")): [Product] @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const rootFieldConfigs = result.configurationDataByTypeName.get('Query')!.entityCaching?.queryCacheConfigurations;
      expect(rootFieldConfigs![0].entityKeyMappings).toEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'tags', argumentPath: ['tags'], isBatch: true }],
        },
      ]);
    });

    test('a returned entity without @openfed__entityCache skips extraction and emits a warning', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const config = result.configurationDataByTypeName.get('Query');
      expect(config!.entityCaching?.queryCacheConfigurations).toBeUndefined();
      expect(result.warnings).toStrictEqual([
        queryCacheReturnEntityMissingEntityCacheWarning({
          subgraphName: 'subgraph-default-a',
          fieldCoords: 'Query.user',
          entityType: 'User',
        }),
      ]);
    });
  });

  describe('validation', () => {
    test('the required maxAge argument missing is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.user', FIRST_ORDINAL, [
          undefinedRequiredArgumentsErrorMessage(OPENFED_QUERY_CACHE, ['maxAge'], []),
        ]),
      );
    });

    test('a non-positive maxAge is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 0)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.user', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(OPENFED_QUERY_CACHE, 0),
        ]),
      );
    });

    test('@openfed__queryCache on a non-Query field is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user: User
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            friend: User @openfed__queryCache(maxAge: 60)
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_QUERY_CACHE, 'User.friend', FIRST_ORDINAL, [
          queryCacheOnNonQueryFieldErrorMessage('User.friend'),
        ]),
      );
    });

    test('@openfed__queryCache on a field returning a non-entity type is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 60)
          }
          type User {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.user', FIRST_ORDINAL, [
          queryCacheOnNonEntityReturnTypeErrorMessage('Query.user', 'User'),
        ]),
      );
    });

    test('the directive is not repeatable — two on the same field fails', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user: User @openfed__queryCache(maxAge: 60) @openfed__queryCache(maxAge: 120)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.user', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(OPENFED_QUERY_CACHE),
        ]),
      );
    });
  });
});

describe('@openfed__is', () => {
  describe('validation', () => {
    test('@openfed__is without @openfed__queryCache on the same field is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(id: ID! @openfed__is(fields: "id")): User
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(id: ...)', FIRST_ORDINAL, [
          isWithoutQueryCacheErrorMessage('id', 'Query.user'),
        ]),
      );
    });

    test('@openfed__is without @openfed__queryCache still fails when other plain arguments are present', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(name: String, id: ID! @openfed__is(fields: "id")): User
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(id: ...)', FIRST_ORDINAL, [
          isWithoutQueryCacheErrorMessage('id', 'Query.user'),
        ]),
      );
    });

    test('@openfed__is targeting a non-@key field is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(name: String! @openfed__is(fields: "name")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(name: ...)', FIRST_ORDINAL, [
          nonKeyFieldSpecErrorMessage('name', 'Query.user', 'name', 'User'),
        ]),
      );
    });

    test('@openfed__is with an argument type that mismatches the @key field type is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(id: String! @openfed__is(fields: "id")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(id: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('id', 'Query.user', 'String!', 'id', 'User', 'ID!'),
        ]),
      );
    });

    test('@openfed__is referencing a field absent from the entity is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(key: ID! @openfed__is(fields: "missing")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(key: ...)', FIRST_ORDINAL, [
          isReferencesUnknownKeyFieldErrorMessage('missing', 'key', 'Query.user', 'User'),
        ]),
      );
    });

    test('two arguments mapping to the same @key field is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(a: ID! @openfed__is(fields: "id"), b: ID! @openfed__is(fields: "id")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(b: ...)', FIRST_ORDINAL, [
          duplicateKeyFieldMappingErrorMessage('Query.user', 'id'),
        ]),
      );
    });

    test('an incompletely-mapped composite @key is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            product(id: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.product(id: ...)', FIRST_ORDINAL, [
          explicitIncompleteCompositeKeyErrorMessage('Query.product', 'id', 'id', 'Product', 'id sku', 'sku'),
        ]),
      );
    });

    test('an additional non-key argument alongside @openfed__is is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(id: ID! @openfed__is(fields: "id"), locale: String): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(id: ...)', FIRST_ORDINAL, [
          explicitSingularAdditionalNonKeyArgumentErrorMessage('Query.user', 'id', 'id', 'User', 'locale'),
        ]),
      );
    });

    test('a single argument covering only part of a composite @key plus an extra argument is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            product(id: ID! @openfed__is(fields: "id"), x: String): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.product(id: ...)', FIRST_ORDINAL, [
          explicitCompositeAdditionalNonKeyArgumentErrorMessage('Query.product', 'id', 'id', 'id sku', 'Product', 'x'),
        ]),
      );
    });

    test('@openfed__is arguments mapping across two alternative @keys with an extra argument is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(
              id: ID! @openfed__is(fields: "id")
              email: String! @openfed__is(fields: "email")
              x: String
            ): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @key(fields: "email") @openfed__entityCache(maxAge: 60) {
            id: ID!
            email: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(id: ...)', FIRST_ORDINAL, [
          explicitCompositeAdditionalNonKeyArgumentErrorMessage('Query.user', 'id', 'email', 'id email', 'User', 'x'),
        ]),
      );
    });

    test('a list argument mapping to a scalar @key field on a singular return is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(ids: [ID!]! @openfed__is(fields: "id")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(ids: ...)', FIRST_ORDINAL, [
          listArgumentToScalarKeySpecErrorMessage('ids', 'Query.user', '[ID!]!', 'id', 'User', 'ID!'),
        ]),
      );
    });

    test('a scalar argument mapping to a list-valued @key field on a singular return is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            product(tag: String! @openfed__is(fields: "tags")): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.product(tag: ...)', FIRST_ORDINAL, [
          scalarArgumentToListKeySpecErrorMessage('tag', 'Query.product', 'String!', 'tags', 'Product', '[String!]!'),
        ]),
      );
    });

    test('a non-input-object argument cannot target a composite @key', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            product(key: ID! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.product(key: ...)', FIRST_ORDINAL, [
          nonInputArgumentCannotTargetCompositeKeyErrorMessage('key', 'Query.product', 'id sku', 'Product', 'ID!'),
        ]),
      );
    });

    test('a composite @openfed__is selection that matches no @key is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            product(key: ProductKey! @openfed__is(fields: "id name")): Product @openfed__queryCache(maxAge: 60)
          }
          input ProductKey {
            id: ID!
            name: String!
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.product(key: ...)', FIRST_ORDINAL, [
          isReferencesUnknownKeyFieldErrorMessage('id name', 'key', 'Query.product', 'Product'),
        ]),
      );
    });

    test('a composite @key with an additional non-key argument is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            product(
              id: ID! @openfed__is(fields: "id")
              sku: String! @openfed__is(fields: "sku")
              filter: String
            ): Product @openfed__queryCache(maxAge: 60)
          }
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.product(id: ...)', FIRST_ORDINAL, [
          explicitCompositeAdditionalNonKeyArgumentErrorMessage(
            'Query.product',
            'id',
            'sku',
            'id sku',
            'Product',
            'filter',
          ),
        ]),
      );
    });

    describe('batch (list-returning) mappings', () => {
      test('only scalar @openfed__is arguments cannot establish a batch mapping', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              users(id: ID! @openfed__is(fields: "id")): [User] @openfed__queryCache(maxAge: 60)
            }
            type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.users(id: ...)', FIRST_ORDINAL, [
            explicitScalarArgumentsCannotEstablishBatchMappingErrorMessage('Query.users', 'User'),
          ]),
        );
      });

      test('a scalar argument to a list-valued @key field requires nested lists', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              products(tag: String! @openfed__is(fields: "tags")): [Product] @openfed__queryCache(maxAge: 60)
            }
            type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
              tags: [String!]!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.products(tag: ...)', FIRST_ORDINAL, [
            batchListValuedKeyRequiresNestedListsErrorMessage(
              'Query.products',
              'tags',
              'Product',
              'a scalar tag of type "String!"',
            ),
          ]),
        );
      });

      test('a single list argument to a list-valued @key field requires nested lists', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              products(tags: [String!]! @openfed__is(fields: "tags")): [Product] @openfed__queryCache(maxAge: 60)
            }
            type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
              tags: [String!]!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.products(tags: ...)', FIRST_ORDINAL, [
            batchListValuedKeyRequiresNestedListsErrorMessage(
              'Query.products',
              'tags',
              'Product',
              'a single tag list of type "[String!]!"',
            ),
          ]),
        );
      });

      test('a list-of-lists argument whose inner type mismatches the list @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              products(tags: [[Int!]!]! @openfed__is(fields: "tags")): [Product] @openfed__queryCache(maxAge: 60)
            }
            type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
              tags: [String!]!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.products(tags: ...)', FIRST_ORDINAL, [
            explicitTypeMismatchErrorMessage('tags', 'Query.products', '[[Int!]!]!', 'tags', 'Product', '[String!]!'),
          ]),
        );
      });

      test('a list argument whose element type mismatches the scalar @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              users(ids: [String!]! @openfed__is(fields: "id")): [User] @openfed__queryCache(maxAge: 60)
            }
            type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.users(ids: ...)', FIRST_ORDINAL, [
            explicitTypeMismatchErrorMessage('ids', 'Query.users', '[String!]!', 'id', 'User', 'ID!'),
          ]),
        );
      });

      test('an additional non-key argument alongside a batch mapping is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              users(ids: [ID!]! @openfed__is(fields: "id"), filter: String): [User] @openfed__queryCache(maxAge: 60)
            }
            type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
              id: ID!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.users(ids: ...)', FIRST_ORDINAL, [
            explicitBatchAdditionalNonKeyArgumentErrorMessage('Query.users', 'ids', 'id', 'User', 'filter'),
          ]),
        );
      });

      test('multiple list arguments for a batch lookup is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              products(
                ids: [ID!]! @openfed__is(fields: "id")
                skus: [String!]! @openfed__is(fields: "sku")
              ): [Product] @openfed__queryCache(maxAge: 60)
            }
            type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
              id: ID!
              sku: String!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.products', FIRST_ORDINAL, [
            multipleListArgumentsBatchFactoryMessage('Query.products', 'Product'),
          ]),
        );
      });
    });

    describe('input-object composite mappings', () => {
      test('an input-object field whose type mismatches a flat composite @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              product(key: ProductKey! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 60)
            }
            input ProductKey {
              id: ID!
              sku: Int!
            }
            type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
              id: ID!
              sku: String!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.product(key: ...)', FIRST_ORDINAL, [
            inputObjectCompositeTypeMismatchErrorMessage(
              'key',
              'Query.product',
              'id sku',
              'Product',
              'ProductKey',
              'sku',
              'Int!',
              'Product.sku',
              'String!',
            ),
          ]),
        );
      });

      test('an input-object field whose nullability differs from the composite @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              product(key: ProductKey! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 60)
            }
            input ProductKey {
              id: ID
              sku: String!
            }
            type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
              id: ID!
              sku: String!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.product(key: ...)', FIRST_ORDINAL, [
            inputObjectCompositeTypeMismatchErrorMessage(
              'key',
              'Query.product',
              'id sku',
              'Product',
              'ProductKey',
              'id',
              'ID',
              'Product.id',
              'ID!',
            ),
          ]),
        );
      });

      test('an input object missing a flat composite @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              product(key: ProductKey! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 60)
            }
            input ProductKey {
              id: ID!
            }
            type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
              id: ID!
              sku: String!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_IS, 'Query.product(key: ...)', FIRST_ORDINAL, [
            inputObjectCompositeMissingFieldErrorMessage(
              'key',
              'Query.product',
              'id sku',
              'Product',
              'ProductKey',
              'sku',
            ),
          ]),
        );
      });

      test('a nested @key selection backed by a scalar input field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              review(key: ReviewKey! @openfed__is(fields: "store{id}")): Review @openfed__queryCache(maxAge: 60)
            }
            input ReviewKey {
              store: ID!
            }
            type Review @key(fields: "store{id}") @openfed__entityCache(maxAge: 60) {
              store: Store!
            }
            type Store @key(fields: "id") {
              id: ID!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.review', FIRST_ORDINAL, [
            nestedKeyRequiresInputObjectErrorMessage('key', 'Query.review', 'store { id }', 'Review', 'ID', 'store'),
          ]),
        );
      });

      test('a nested input object missing the nested @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              review(key: ReviewKey! @openfed__is(fields: "store{id}")): Review @openfed__queryCache(maxAge: 60)
            }
            input ReviewKey {
              store: StoreKey!
            }
            input StoreKey {
              other: String!
            }
            type Review @key(fields: "store{id}") @openfed__entityCache(maxAge: 60) {
              store: Store!
            }
            type Store @key(fields: "id") {
              id: ID!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.review', FIRST_ORDINAL, [
            nestedInputObjectMissingFieldErrorMessage(
              'key',
              'Query.review',
              'store { id }',
              'Review',
              'StoreKey',
              'id',
            ),
          ]),
        );
      });

      test('a nested input object field whose type mismatches the nested @key field is a failure', () => {
        const { errors } = normalizeSubgraphFailure(
          createSubgraphWithDefault(`
            type Query {
              review(key: ReviewKey! @openfed__is(fields: "store{id}")): Review @openfed__queryCache(maxAge: 60)
            }
            input ReviewKey {
              store: StoreKey!
            }
            input StoreKey {
              id: Int!
            }
            type Review @key(fields: "store{id}") @openfed__entityCache(maxAge: 60) {
              store: Store!
            }
            type Store @key(fields: "id") {
              id: ID!
            }
          `),
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(errors[0]).toStrictEqual(
          invalidDirectiveError(OPENFED_QUERY_CACHE, 'Query.review', FIRST_ORDINAL, [
            nestedInputObjectTypeMismatchErrorMessage(
              'key',
              'Query.review',
              'store { id }',
              'Review',
              'StoreKey',
              'id',
              'Int!',
              'Store.id',
              'ID!',
            ),
          ]),
        );
      });
    });

    test('the directive is not repeatable — two on the same argument fails', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefault(`
          type Query {
            user(id: ID! @openfed__is(fields: "id") @openfed__is(fields: "id")): User @openfed__queryCache(maxAge: 60)
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_IS, 'Query.user(id: ...)', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(OPENFED_IS),
        ]),
      );
    });
  });
});
