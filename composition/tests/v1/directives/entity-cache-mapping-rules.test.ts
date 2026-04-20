import { describe, expect, test } from 'vitest';
import {
  type BatchNormalizationSuccess,
  FIRST_ORDINAL,
  invalidDirectiveError,
  IS,
  parse,
  QUERY,
  QUERY_CACHE,
  RootFieldCacheConfig,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  type TypeName,
} from '../../../src';
import { batchNormalize } from '../../../src/v1/normalization/normalization-factory';
import {
  duplicateKeyFieldMappingErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  isReferencesUnknownKeyFieldErrorMessage,
  queryCacheOnNonEntityReturnTypeErrorMessage,
  queryCacheOnNonQueryFieldErrorMessage,
} from '../../../src/errors/errors';
import { incompleteQueryCacheKeyMappingWarning } from '../../../src/v1/warnings/warnings';
import { normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

const version = ROUTER_COMPATIBILITY_VERSION_ONE;

function subgraph(sdl: string, name = 'subgraph-a'): Subgraph {
  return { name, url: '', definitions: parse(sdl) };
}

function getConfigForType(sg: Subgraph, typeName: string) {
  const result = batchNormalize({ subgraphs: [sg], version }) as BatchNormalizationSuccess;
  expect(result.success).toBe(true);
  const internal = result.internalSubgraphBySubgraphName.get(sg.name);
  expect(internal).toBeDefined();
  return internal!.configurationDataByTypeName.get(typeName as TypeName);
}

function getSingleQueryRootFieldConfig(sdl: string, fieldName: string) {
  const config = getConfigForType(subgraph(sdl), QUERY);
  expect(config).toBeDefined();
  expect(config!.rootFieldCacheConfigurations).toBeDefined();
  expect(config!.rootFieldCacheConfigurations).toHaveLength(1);
  expect(config!.rootFieldCacheConfigurations![0].fieldName).toBe(fieldName);
  return config!.rootFieldCacheConfigurations![0];
}

function autoMappingTypeMismatchWarningMessage(
  argumentName: string,
  fieldCoords: string,
  argumentType: string,
  keyField: string,
  entityType: string,
  keyFieldType: string,
) {
  return `Argument "${argumentName}" on field "${fieldCoords}" has type "${argumentType}" but @key field "${keyField}" on entity "${entityType}" has type "${keyFieldType}". Auto-mapping skipped due to type mismatch.`;
}

function explicitTypeMismatchErrorMessage(
  argumentName: string,
  fieldCoords: string,
  argumentType: string,
  isField: string,
  entityType: string,
  keyFieldType: string,
) {
  return `Argument "${argumentName}" on field "${fieldCoords}" has type "${argumentType}" but @openfed__is(fields: "${isField}") targets @key field "${isField}" of type "${keyFieldType}" on entity "${entityType}".`;
}

function unknownKeyFieldSpecErrorMessage(
  argumentName: string,
  fieldCoords: string,
  isField: string,
  entityType: string,
) {
  return `Argument "${argumentName}" on field "${fieldCoords}" uses @openfed__is(fields: "${isField}") but "${isField}" is not a field in any @key on entity "${entityType}".`;
}

function nonKeyFieldSpecErrorMessage(argumentName: string, fieldCoords: string, isField: string, entityType: string) {
  return `Argument "${argumentName}" on field "${fieldCoords}" uses @openfed__is(fields: "${isField}"), but "${isField}" is not a @key field on entity "${entityType}". @openfed__is can only target fields that are part of a @key.`;
}

function listArgumentToScalarKeySpecErrorMessage(
  argumentName: string,
  fieldCoords: string,
  argumentType: string,
  isField: string,
  entityType: string,
  keyFieldType: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" has type "${argumentType}" but @openfed__is(fields: "${isField}") targets @key field "${isField}" of type "${keyFieldType}" on entity "${entityType}".` +
    ' List arguments can only map to scalar key fields when the field returns a list of entities, or to list key fields when the key field itself is a list type.'
  );
}

function scalarArgumentToListKeySpecErrorMessage(
  argumentName: string,
  fieldCoords: string,
  argumentType: string,
  isField: string,
  entityType: string,
  keyFieldType: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" has type "${argumentType}" but @openfed__is(fields: "${isField}") targets @key field "${isField}" of type "${keyFieldType}" on entity "${entityType}".` +
    ' A scalar argument cannot map to a list key field.'
  );
}

function implicitIncompleteCompositeKeyWarningMessage(
  argumentName: string,
  fieldCoords: string,
  keyField: string,
  entityType: string,
  compositeKey: string,
  missingField: string,
) {
  return `Argument "${argumentName}" on field "${fieldCoords}" matches @key field "${keyField}" on entity "${entityType}", but composite @key "${compositeKey}" is incomplete because no argument maps to required key field "${missingField}". Auto-mapping skipped — all fields of a composite key must be mapped.`;
}

function explicitIncompleteCompositeKeyErrorMessage(
  fieldCoords: string,
  argumentName: string,
  mappedField: string,
  entityType: string,
  compositeKey: string,
  missingField: string,
) {
  return `Field "${fieldCoords}" has argument "${argumentName}" with @openfed__is mapping to @key field "${mappedField}" on entity "${entityType}", but composite @key "${compositeKey}" is incomplete because no argument maps to required key field "${missingField}".`;
}

function autoMappingAdditionalNonKeyArgumentWarningMessage(
  argumentName: string,
  fieldCoords: string,
  keyField: string,
  entityType: string,
  extraArgument: string,
) {
  return `Argument "${argumentName}" on field "${fieldCoords}" matches @key field "${keyField}" on entity "${entityType}", but field has additional argument "${extraArgument}" which is not mapped to a key field. Auto-mapping skipped — all arguments must be key arguments because additional arguments may filter the response, making the cache key incomplete.`;
}

function explicitSingularAdditionalNonKeyArgumentErrorMessage(
  fieldCoords: string,
  argumentName: string,
  keyField: string,
  entityType: string,
  extraArgument: string,
) {
  return `Field "${fieldCoords}" has argument "${argumentName}" with @openfed__is mapping to @key field "${keyField}" on entity "${entityType}", but also has additional argument "${extraArgument}" which is not mapped to a key field. All arguments must be key arguments — additional arguments may filter the response, making the cache key incomplete.`;
}

function explicitCompositeAdditionalNonKeyArgumentErrorMessage(
  fieldCoords: string,
  firstArgument: string,
  secondArgument: string,
  compositeKey: string,
  entityType: string,
  extraArgument: string,
) {
  return `Field "${fieldCoords}" has arguments "${firstArgument}" and "${secondArgument}" with @openfed__is mappings covering composite @key "${compositeKey}" on entity "${entityType}", but also has additional argument "${extraArgument}" which is not mapped to a key field. All arguments must be key arguments — additional arguments may filter the response, making the cache key incomplete.`;
}

function batchListValuedKeyRequiresNestedListsErrorMessage(
  fieldCoords: string,
  isField: string,
  entityType: string,
  actualType: string,
) {
  return `Field "${fieldCoords}" returns a list of entities, so cache lookup is a batch lookup and requires one key value per entity. Because @openfed__is(fields: "${isField}") targets list-valued @key field "${isField}" on entity "${entityType}", the argument must provide a list of tag lists (e.g., "[[String!]!]!"), not ${actualType}.`;
}

function explicitBatchAdditionalNonKeyArgumentErrorMessage(
  fieldCoords: string,
  argumentName: string,
  keyField: string,
  entityType: string,
  extraArgument: string,
) {
  return `Field "${fieldCoords}" returns a list of entities, so cache lookup is a batch lookup and requires a single key input that determines the returned entities. Argument "${argumentName}" uses @openfed__is to map to @key field "${keyField}" on entity "${entityType}", but additional argument "${extraArgument}" is not mapped to a key field and may filter the response, so the batch key would be incomplete.`;
}

function autoBatchAdditionalNonKeyArgumentWarningMessage(
  fieldCoords: string,
  argumentName: string,
  keyField: string,
  entityType: string,
  extraArgument: string,
) {
  return `Field "${fieldCoords}" returns a list of entities, so cache lookup is a batch lookup and requires a single key input that determines the returned entities. Argument "${argumentName}" matches @key field "${keyField}" on entity "${entityType}", but additional argument "${extraArgument}" is not mapped to a key field and may filter the response, so auto-mapping is skipped because the batch key would be incomplete.`;
}

function explicitScalarArgumentsCannotEstablishBatchMappingErrorMessage(fieldCoords: string, entityType: string) {
  return `Field "${fieldCoords}" returns a list of entities, so cache lookup is a batch lookup and requires one key value per entity. Scalar arguments with @openfed__is mapping to @key fields on entity "${entityType}" cannot provide a batch of keys, so they cannot establish cache key mappings for this field. Use list arguments for batch cache lookups.`;
}

function multipleListArgumentsBatchFactoryMessage(fieldCoords: string, entityType: string) {
  return (
    `Field "${fieldCoords}" has multiple list arguments mapping to @key fields on entity "${entityType}".` +
    ' Batch cache lookups require a single list argument.' +
    ' For composite keys, use a single list of input objects instead.'
  );
}

function inputObjectCompositeTypeMismatchErrorMessage(
  argumentName: string,
  fieldCoords: string,
  keyFields: string,
  entityType: string,
  inputType: string,
  inputFieldName: string,
  inputFieldType: string,
  entityFieldPath: string,
  entityFieldType: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" uses @openfed__is(fields: "${keyFields}") mapping to composite @key on entity "${entityType}",` +
    ` but input type "${inputType}" field "${inputFieldName}" has type "${inputFieldType}"` +
    ` which does not match key field "${entityFieldPath}" of type "${entityFieldType}".`
  );
}

function inputObjectCompositeMissingFieldErrorMessage(
  argumentName: string,
  fieldCoords: string,
  keyFields: string,
  entityType: string,
  inputType: string,
  missingFieldName: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" uses @openfed__is(fields: "${keyFields}") mapping to composite @key on entity "${entityType}",` +
    ` but input type "${inputType}" is missing required key field "${missingFieldName}".`
  );
}

function nestedInputObjectTypeMismatchErrorMessage(
  argumentName: string,
  fieldCoords: string,
  keyFields: string,
  entityType: string,
  inputType: string,
  inputFieldName: string,
  inputFieldType: string,
  entityFieldPath: string,
  entityFieldType: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" maps to nested @key "${keyFields}" on entity "${entityType}",` +
    ` but input type "${inputType}" field "${inputFieldName}" has type "${inputFieldType}"` +
    ` which does not match key field "${entityFieldPath}" of type "${entityFieldType}".`
  );
}

function nestedInputObjectMissingFieldErrorMessage(
  argumentName: string,
  fieldCoords: string,
  keyFields: string,
  entityType: string,
  inputType: string,
  missingFieldName: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" maps to nested @key "${keyFields}" on entity "${entityType}",` +
    ` but input type "${inputType}" is missing required key field "${missingFieldName}".`
  );
}

function nonInputArgumentCannotTargetCompositeKeyErrorMessage(
  argumentName: string,
  fieldCoords: string,
  keyFields: string,
  entityType: string,
  argumentType: string,
) {
  return (
    `Argument "${argumentName}" on field "${fieldCoords}" uses @openfed__is(fields: "${keyFields}") targeting composite @key on entity "${entityType}",` +
    ` but argument type "${argumentType}" does not provide nested fields for each key field.` +
    ' Use separate arguments or an input object that matches the composite key shape.'
  );
}

describe('Entity cache mapping rules tests', () => {
  describe('message factory coverage', () => {
    test('shared mapping-rule message factories produce the documented text', () => {
      expect(queryCacheOnNonEntityReturnTypeErrorMessage('Query.product', 'Result')).toBe(
        'Field "Query.product" has @openfed__queryCache but returns non-entity type "Result". @openfed__queryCache requires the return type to be an entity with @key.',
      );
      expect(queryCacheOnNonQueryFieldErrorMessage('Mutation.updateProduct')).toBe(
        '@openfed__queryCache must only be defined on fields of the root query type; found on "Mutation.updateProduct".' +
          ' Use @openfed__cachePopulate or @openfed__cacheInvalidate on mutation or subscription fields.',
      );
      expect(invalidRepeatedDirectiveErrorMessage(QUERY_CACHE)).toBe(
        'The definition for the directive "@openfed__queryCache" does not define it as repeatable, but it is declared more than once on these coordinates.',
      );
      expect(isReferencesUnknownKeyFieldErrorMessage('unknown', 'pid', 'Query.product', 'Product')).toBe(
        '@openfed__is(fields: "unknown") on argument "pid" of field "Query.product" references unknown @key field "unknown" on type "Product".',
      );
      expect(duplicateKeyFieldMappingErrorMessage('Query.product', 'id')).toBe(
        'Multiple arguments on field "Query.product" map to @key field "id".',
      );
      expect(multipleListArgumentsBatchFactoryMessage('Query.products', 'Product')).toBe(
        'Field "Query.products" has multiple list arguments mapping to @key fields on entity "Product". Batch cache lookups require a single list argument. For composite keys, use a single list of input objects instead.',
      );
      expect(autoMappingTypeMismatchWarningMessage('id', 'Query.product', 'String!', 'id', 'Product', 'ID!')).toBe(
        'Argument "id" on field "Query.product" has type "String!" but @key field "id" on entity "Product" has type "ID!". Auto-mapping skipped due to type mismatch.',
      );
      expect(explicitTypeMismatchErrorMessage('pid', 'Query.product', 'String!', 'id', 'Product', 'ID!')).toBe(
        'Argument "pid" on field "Query.product" has type "String!" but @openfed__is(fields: "id") targets @key field "id" of type "ID!" on entity "Product".',
      );
      expect(unknownKeyFieldSpecErrorMessage('pid', 'Query.product', 'unknown', 'Product')).toBe(
        'Argument "pid" on field "Query.product" uses @openfed__is(fields: "unknown") but "unknown" is not a field in any @key on entity "Product".',
      );
      expect(nonKeyFieldSpecErrorMessage('pname', 'Query.product', 'name', 'Product')).toBe(
        'Argument "pname" on field "Query.product" uses @openfed__is(fields: "name"), but "name" is not a @key field on entity "Product". @openfed__is can only target fields that are part of a @key.',
      );
      expect(
        implicitIncompleteCompositeKeyWarningMessage('id', 'Query.product', 'id', 'Product', 'id region', 'region'),
      ).toBe(
        'Argument "id" on field "Query.product" matches @key field "id" on entity "Product", but composite @key "id region" is incomplete because no argument maps to required key field "region". Auto-mapping skipped — all fields of a composite key must be mapped.',
      );
      expect(
        explicitBatchAdditionalNonKeyArgumentErrorMessage('Query.products', 'ids', 'id', 'Product', 'category'),
      ).toBe(
        'Field "Query.products" returns a list of entities, so cache lookup is a batch lookup and requires a single key input that determines the returned entities. Argument "ids" uses @openfed__is to map to @key field "id" on entity "Product", but additional argument "category" is not mapped to a key field and may filter the response, so the batch key would be incomplete.',
      );
      expect(
        incompleteQueryCacheKeyMappingWarning({
          subgraphName: 'subgraph-a',
          fieldCoords: 'Query.product',
          entityType: 'Product',
          unmappedKeyField: 'region',
        }).message,
      ).toBe(
        'Field "Query.product" has @openfed__queryCache returning "Product" but @key field "region" cannot be mapped to any argument. Cache reads are disabled for this field (cache writes/population still work). Add an argument named "region" or use @openfed__is(fields: "region") to enable cache reads.',
      );
    });
  });

  describe('prerequisite rules', () => {
    test('rule 0a: error when @openfed__queryCache is declared on a field that returns a non-entity type', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Result {
            success: Boolean!
          }

          type Query {
            product(id: ID!): Result @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          queryCacheOnNonEntityReturnTypeErrorMessage('Query.product', 'Result'),
        ]),
      );
    });

    test('rule 0b: @openfed__queryCache without @openfed__entityCache keeps only root-field caching and emits no entity mappings', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig).toStrictEqual({
        fieldName: 'product',
        maxAgeSeconds: 30,
        includeHeaders: false,
        shadowMode: false,
        entityTypeName: 'Product',
        entityKeyMappings: [],
      } satisfies RootFieldCacheConfig);
    });

    test('rule 0c: error when @openfed__queryCache is declared on a non-Query root field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Mutation {
            updateProduct(id: ID!): Product @openfed__queryCache(maxAge: 30)
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

    test('rule 0d: error when @openfed__queryCache is declared more than once on the same Query field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
          }

          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30) @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(QUERY_CACHE),
        ]),
      );
    });
  });

  describe('singular return: auto-mapping', () => {
    test('rule 1: exact scalar type match emits a single entity key mapping', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
      ]);
    });

    test('rule 2: String argument for an ID key field is skipped with an auto-mapping warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].subgraph.name).toBe('subgraph-a');
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('id', 'Query.product', 'String!', 'id', 'Product', 'ID!'),
      );
    });

    test('rule 3: Int argument for an ID key field is skipped with an auto-mapping warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: Int!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('id', 'Query.product', 'Int!', 'id', 'Product', 'ID!'),
      );
    });

    test('rule 4: Int argument for a String key field is skipped with an auto-mapping warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            sku: String!
            name: String!
          }

          type Query {
            product(sku: Int!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('sku', 'Query.product', 'Int!', 'sku', 'Product', 'String!'),
      );
    });

    test('rule 5: exact enum type match emits a composite key mapping', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          enum Region {
            US
            EU
            APAC
          }

          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: Region!
            name: String!
          }

          type Query {
            product(id: ID!, region: Region!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['id'] },
            { entityKeyField: 'region', argumentPath: ['region'] },
          ],
        },
      ]);
    });

    test('rule 6: enum auto-mapping is skipped when the argument enum differs from the key enum', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          enum Region {
            US
            EU
          }

          enum Zone {
            NORTH
            SOUTH
          }

          type Product @key(fields: "region") @openfed__entityCache(maxAge: 60) {
            region: Region!
            name: String!
          }

          type Query {
            product(region: Zone!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('region', 'Query.product', 'Zone!', 'region', 'Product', 'Region!'),
      );
    });

    test('rule 7: enum-vs-scalar auto-mapping mismatch is skipped with a warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          enum Status {
            ACTIVE
            INACTIVE
          }

          type Product @key(fields: "status") @openfed__entityCache(maxAge: 60) {
            status: Status!
            name: String!
          }

          type Query {
            product(status: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('status', 'Query.product', 'String!', 'status', 'Product', 'Status!'),
      );
    });

    test('rule 8: exact custom scalar match emits a single entity key mapping', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          scalar UUID

          type Product @key(fields: "uid") @openfed__entityCache(maxAge: 60) {
            uid: UUID!
            name: String!
          }

          type Query {
            product(uid: UUID!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'uid', argumentPath: ['uid'] }],
        },
      ]);
    });

    test('rule 9: custom scalar auto-mapping is skipped when the argument scalar differs from the key scalar', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          scalar UUID
          scalar GUID

          type Product @key(fields: "uid") @openfed__entityCache(maxAge: 60) {
            uid: UUID!
            name: String!
          }

          type Query {
            product(uid: GUID!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('uid', 'Query.product', 'GUID!', 'uid', 'Product', 'UUID!'),
      );
    });

    test('rule 10: custom-scalar-vs-built-in-scalar auto-mapping mismatch is skipped with a warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          scalar UUID

          type Product @key(fields: "uid") @openfed__entityCache(maxAge: 60) {
            uid: UUID!
            name: String!
          }

          type Query {
            product(uid: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('uid', 'Query.product', 'String!', 'uid', 'Product', 'UUID!'),
      );
    });

    test('rule 11: a nullable argument can map to a non-null key field when the named type matches', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
      ]);
    });

    test('rule 12: a non-null argument can map to a nullable key field when the named type matches', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            sku: String
            name: String!
          }

          type Query {
            product(sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'sku', argumentPath: ['sku'] }],
        },
      ]);
    });

    test('rule 13: a list argument cannot auto-map to a scalar key field on a singular return', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: [ID!]!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('id', 'Query.product', '[ID!]!', 'id', 'Product', 'ID!'),
      );
    });

    test('rule 13b: a list argument can auto-map to a list-valued key field on a singular return', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            product(tags: [String!]!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'tags', argumentPath: ['tags'] }],
        },
      ]);
    });

    test('rule 25: a Boolean key field can be auto-mapped when the argument type is also Boolean', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Feature @key(fields: "name enabled") @openfed__entityCache(maxAge: 60) {
            name: String!
            enabled: Boolean!
          }

          type Query {
            feature(name: String!, enabled: Boolean!): Feature @openfed__queryCache(maxAge: 30)
          }
        `,
        'feature',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Feature',
          fieldMappings: [
            { entityKeyField: 'enabled', argumentPath: ['enabled'] },
            { entityKeyField: 'name', argumentPath: ['name'] },
          ],
        },
      ]);
    });

    test('rule 26: Float-vs-Int auto-mapping mismatch is skipped with a warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "weight") @openfed__entityCache(maxAge: 60) {
            weight: Float!
            name: String!
          }

          type Query {
            product(weight: Int!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('weight', 'Query.product', 'Int!', 'weight', 'Product', 'Float!'),
      );
    });

    test('rule 27: if no key is satisfiable, composition emits no mappings and no warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(name: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(0);

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(name: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([]);
    });
  });

  describe('singular return: explicit @openfed__is(fields: ...)', () => {
    test('rule 14: explicit @openfed__is(fields: "id") maps a differently named argument to a scalar key field', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pid: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['pid'] }],
        },
      ]);
    });

    test('rule 15: explicit @openfed__is(fields: "id") rejects a type mismatch instead of silently skipping it', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pid: String! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('pid', 'Query.product', 'String!', 'id', 'Product', 'ID!'),
        ]),
      );
    });

    test('rule 15a: explicit @openfed__is(fields: "unknown") errors when the target is not present in any @key', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pid: ID! @openfed__is(fields: "unknown")): Product @openfed__queryCache(maxAge: 30)
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

    test('rule 15a-i: explicit @openfed__is(fields: "name") errors when the target exists on the entity but is not part of any @key', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pname: String! @openfed__is(fields: "name")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pname: ...)', FIRST_ORDINAL, [
          nonKeyFieldSpecErrorMessage('pname', 'Query.product', 'name', 'Product'),
        ]),
      );
    });

    test('rule 15a-ii: explicit @openfed__is cannot map two arguments to the same key field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pid: ID! @openfed__is(fields: "id"), altId: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(altId: ...)', FIRST_ORDINAL, [
          duplicateKeyFieldMappingErrorMessage('Query.product', 'id'),
        ]),
      );
    });

    test('rule 15b: explicit @openfed__is accepts a nullable argument for a non-null key field when the named type matches', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pid: ID @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['pid'] }],
        },
      ]);
    });

    test('rule 15c: explicit list argument cannot target a scalar key field on a singular return', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pids: [ID!]! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pids: ...)', FIRST_ORDINAL, [
          listArgumentToScalarKeySpecErrorMessage('pids', 'Query.product', '[ID!]!', 'id', 'Product', 'ID!'),
        ]),
      );
    });

    test('rule 15d: explicit list argument can target a list-valued key field on a singular return', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            product(tags: [String!]! @openfed__is(fields: "tags")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'tags', argumentPath: ['tags'] }],
        },
      ]);
    });

    test('rule 15e: explicit list argument rejects a list-valued key field when the element types differ', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            product(tags: [Int!]! @openfed__is(fields: "tags")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(tags: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('tags', 'Query.product', '[Int!]!', 'tags', 'Product', '[String!]!'),
        ]),
      );
    });

    test('rule 28: redundant @openfed__is(fields: "id") is accepted silently when the argument already matches the key field name', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(0);

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
      ]);
    });

    test('rule 15f: explicit scalar argument cannot target a list-valued key field on a singular return', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            product(tag: String! @openfed__is(fields: "tags")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(tag: ...)', FIRST_ORDINAL, [
          scalarArgumentToListKeySpecErrorMessage('tag', 'Query.product', 'String!', 'tags', 'Product', '[String!]!'),
        ]),
      );
    });
  });

  describe('nested, composite, alternative, and unresolvable keys', () => {
    test('rule 16: a nested key leaf can be targeted with explicit @openfed__is(fields: "store.id")', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Store {
            id: ID!
          }

          type Product @key(fields: "store { id }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }

          type Query {
            product(storeId: ID! @openfed__is(fields: "store.id")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'store.id', argumentPath: ['storeId'] }],
        },
      ]);
    });

    test('rule 17: explicit nested @openfed__is mapping rejects a type mismatch against the nested leaf field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Store {
            id: ID!
          }

          type Product @key(fields: "store { id }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }

          type Query {
            product(storeId: Int! @openfed__is(fields: "store.id")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(storeId: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('storeId', 'Query.product', 'Int!', 'store.id', 'Product', 'ID!'),
        ]),
      );
    });

    test('rule 18: a composite key emits a mapping when all fields are matched with correct types', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(id: ID!, region: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['id'] },
            { entityKeyField: 'region', argumentPath: ['region'] },
          ],
        },
      ]);
    });

    test('rule 19: if one composite-key argument has an auto-mapping type mismatch, the key becomes unsatisfiable', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(id: Int!, region: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('id', 'Query.product', 'Int!', 'id', 'Product', 'ID!'),
      );
    });

    test('rule 19b: implicit composite-key mapping is skipped when one required key field is missing', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        incompleteQueryCacheKeyMappingWarning({
          subgraphName: 'subgraph-a',
          fieldCoords: 'Query.product',
          entityType: 'Product',
          unmappedKeyField: 'region',
        }),
      );

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([]);
    });

    test('rule 19c: explicit partial composite-key mapping fails when one required key field is still missing', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(pid: ID! @openfed__is(fields: "id")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          explicitIncompleteCompositeKeyErrorMessage('Query.product', 'pid', 'id', 'Product', 'id region', 'region'),
        ]),
      );
    });

    test('rule 19d: explicit mappings can satisfy all fields of a composite key', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(pid: ID! @openfed__is(fields: "id"), area: String! @openfed__is(fields: "region")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['pid'] },
            { entityKeyField: 'region', argumentPath: ['area'] },
          ],
        },
      ]);
    });

    test('rule 19e: explicit composite-key mappings reject a type mismatch on any mapped field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(pid: Int! @openfed__is(fields: "id"), area: String! @openfed__is(fields: "region")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('pid', 'Query.product', 'Int!', 'id', 'Product', 'ID!'),
        ]),
      );
    });

    test('rule 19f: multiple keys are evaluated independently and all satisfiable keys are emitted', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id region") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            sku: String!
            name: String!
          }

          type Query {
            product(id: ID!, region: String!, sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['id'] },
            { entityKeyField: 'region', argumentPath: ['region'] },
          ],
        },
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'sku', argumentPath: ['sku'] }],
        },
      ]);
    });

    test('rule 19g: implicit composite-key mapping is skipped when the field also has an extra non-key argument', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(id: ID!, region: String!, category: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingAdditionalNonKeyArgumentWarningMessage('id', 'Query.product', 'id', 'Product', 'category'),
      );
    });

    test('rule 19g-i: explicit composite-key mappings cannot coexist with an extra non-key argument on a singular return', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            product(
              pid: ID! @openfed__is(fields: "id")
              area: String! @openfed__is(fields: "region")
              category: String!
            ): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          explicitCompositeAdditionalNonKeyArgumentErrorMessage(
            'Query.product',
            'pid',
            'area',
            'id region',
            'Product',
            'category',
          ),
        ]),
      );
    });

    test('rule 20: if one alternative key is satisfiable, it is emitted without warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(0);

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'sku', argumentPath: ['sku'] }],
        },
      ]);
    });

    test('rule 21: an auto-mapping type mismatch makes the argument non-key and blocks alternative-key mappings', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(id: String!, sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingTypeMismatchWarningMessage('id', 'Query.product', 'String!', 'id', 'Product', 'ID!'),
      );

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(id: String!, sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([]);
    });

    test('rule 22: flat and nested fields can be combined in one composite key mapping', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Store {
            id: ID!
            name: String!
          }

          type Product @key(fields: "id store { id }") @openfed__entityCache(maxAge: 60) {
            id: ID!
            store: Store!
            name: String!
          }

          type Query {
            product(id: ID!, storeId: ID! @openfed__is(fields: "store.id")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['id'] },
            { entityKeyField: 'store.id', argumentPath: ['storeId'] },
          ],
        },
      ]);
    });

    test('rule 24: resolvable: false does not prevent other matching keys from being used', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @key(fields: "sku", resolvable: false) @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
      ]);
    });

    test('rule 24b: resolvable: false keys still participate in auto-mapping', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @key(fields: "sku", resolvable: false) @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(id: ID!, sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      // Each @key is an independent alternative (OR semantics), so two separate mappings are emitted.
      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'sku', argumentPath: ['sku'] }],
        },
      ]);
    });

    test('rule 24c: resolvable: false keys remain eligible for explicit @openfed__is mapping', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @key(fields: "sku", resolvable: false) @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(id: ID!, productSku: String! @openfed__is(fields: "sku")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      // Each @key is an independent alternative (OR semantics), so two separate mappings are emitted.
      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'] }],
        },
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'sku', argumentPath: ['productSku'] }],
        },
      ]);
    });
  });

  describe('nested keys', () => {
    test('rule 23: a deeply nested @key leaf can be targeted with @openfed__is(fields: "a.b.c.value")', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type C {
            value: String!
          }

          type B {
            c: C!
          }

          type A {
            b: B!
          }

          type Product @key(fields: "a { b { c { value } } }") @openfed__entityCache(maxAge: 60) {
            a: A!
            name: String!
          }

          type Query {
            product(val: String! @openfed__is(fields: "a.b.c.value")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'a.b.c.value', argumentPath: ['val'] }],
        },
      ]);
    });

    test('rule 23b: deeply nested @openfed__is mapping validates the leaf field type, not just the path string', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type C {
            value: String!
          }

          type B {
            c: C!
          }

          type A {
            b: B!
          }

          type Product @key(fields: "a { b { c { value } } }") @openfed__entityCache(maxAge: 60) {
            a: A!
            name: String!
          }

          type Query {
            product(val: Int! @openfed__is(fields: "a.b.c.value")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(val: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('val', 'Query.product', 'Int!', 'a.b.c.value', 'Product', 'String!'),
        ]),
      );
    });
  });

  describe('list-return batch mappings', () => {
    test('rule 29: a non-key scalar argument on a list-return field emits no mapping and no warning', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(0);

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `,
        'products',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([]);
    });

    test('rule 29b: an explicit list argument establishes a batch cache mapping for a scalar key field', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(ids: [ID!]! @openfed__is(fields: "id")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `,
        'products',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['ids'], isBatch: true }],
        },
      ]);
    });

    test('rule 29c: an auto-mapped list argument establishes a batch cache mapping for a scalar key field', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(id: [ID!]!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `,
        'products',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'id', argumentPath: ['id'], isBatch: true }],
        },
      ]);
    });

    test('rule 29e: a composite batch key cannot use multiple separate list arguments', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            products(ids: [ID!]! @openfed__is(fields: "id"), skus: [String!]! @openfed__is(fields: "sku")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.products', FIRST_ORDINAL, [
          multipleListArgumentsBatchFactoryMessage('Query.products', 'Product'),
        ]),
      );
    });

    test('rule 15g: list return plus a single list argument is not enough for a list-valued key field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            products(tags: [String!]! @openfed__is(fields: "tags")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(tags: ...)', FIRST_ORDINAL, [
          batchListValuedKeyRequiresNestedListsErrorMessage(
            'Query.products',
            'tags',
            'Product',
            'a single tag list of type "[String!]!"',
          ),
        ]),
      );
    });

    test('rule 15h: list return plus a scalar argument is not enough for a list-valued key field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            products(tag: String! @openfed__is(fields: "tags")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(tag: ...)', FIRST_ORDINAL, [
          batchListValuedKeyRequiresNestedListsErrorMessage(
            'Query.products',
            'tags',
            'Product',
            'a scalar tag of type "String!"',
          ),
        ]),
      );
    });

    test('rule 15i: list return plus a list-of-list argument can batch-map a list-valued key field', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "tags") @openfed__entityCache(maxAge: 60) {
            tags: [String!]!
            name: String!
          }

          type Query {
            products(tags: [[String!]!]! @openfed__is(fields: "tags")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `,
        'products',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [{ entityKeyField: 'tags', argumentPath: ['tags'], isBatch: true }],
        },
      ]);
    });

    test('rule 29f: an explicit list-return batch mapping rejects type mismatches', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(ids: [String!]! @openfed__is(fields: "id")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(ids: ...)', FIRST_ORDINAL, [
          explicitTypeMismatchErrorMessage('ids', 'Query.products', '[String!]!', 'id', 'Product', 'ID!'),
        ]),
      );
    });

    test('rule 29g: explicit batch mapping cannot coexist with an extra non-key list filter argument', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(ids: [ID!]! @openfed__is(fields: "id"), category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(ids: ...)', FIRST_ORDINAL, [
          explicitBatchAdditionalNonKeyArgumentErrorMessage('Query.products', 'ids', 'id', 'Product', 'category'),
        ]),
      );
    });

    test('rule 29h: auto batch mapping is skipped when the field also has an extra non-key argument', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(id: [ID!]!, category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoBatchAdditionalNonKeyArgumentWarningMessage('Query.products', 'id', 'id', 'Product', 'category'),
      );
    });

    test('rule 29i: explicit scalar @openfed__is mappings cannot establish cache keys for a list-returning field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id region") @openfed__entityCache(maxAge: 60) {
            id: ID!
            region: String!
            name: String!
          }

          type Query {
            products(pid: ID! @openfed__is(fields: "id"), area: String! @openfed__is(fields: "region")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(pid: ...)', FIRST_ORDINAL, [
          explicitScalarArgumentsCannotEstablishBatchMappingErrorMessage('Query.products', 'Product'),
        ]),
      );
    });

    test('rule 29j: explicit @openfed__is plus an extra non-key argument is rejected on a list-return field', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(pid: ID! @openfed__is(fields: "id"), category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(pid: ...)', FIRST_ORDINAL, [
          explicitBatchAdditionalNonKeyArgumentErrorMessage('Query.products', 'pid', 'id', 'Product', 'category'),
        ]),
      );
    });

    test('rule 29k: auto-mapped key arguments are skipped on a list-return field when an extra non-key argument is present', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            products(id: ID!, category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoBatchAdditionalNonKeyArgumentWarningMessage('Query.products', 'id', 'id', 'Product', 'category'),
      );
    });
  });

  describe('mixed key and non-key arguments on singular returns', () => {
    test('rule 33: explicit @openfed__is plus an extra non-key argument is rejected on a singular return', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(pid: ID! @openfed__is(fields: "id"), category: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          explicitSingularAdditionalNonKeyArgumentErrorMessage('Query.product', 'pid', 'id', 'Product', 'category'),
        ]),
      );
    });

    test('rule 33b: auto-mapped singular key is skipped when the field also has an extra non-key argument', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID!, category: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe(
        autoMappingAdditionalNonKeyArgumentWarningMessage('id', 'Query.product', 'id', 'Product', 'category'),
      );

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }

          type Query {
            product(id: ID!, category: String!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([]);
    });
  });

  describe('input-object mappings', () => {
    test('rule 29d-a: a flat singular argument cannot map to multiple key fields via @openfed__is(fields: "id sku")', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(key: ID! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(key: ...)', FIRST_ORDINAL, [
          nonInputArgumentCannotTargetCompositeKeyErrorMessage('key', 'Query.product', 'id sku', 'Product', 'ID!'),
        ]),
      );
    });

    test('rule 29d: a list of input objects can map to a composite key via @openfed__is(fields: "id sku")', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          input ProductKeyInput {
            id: ID!
            sku: String!
          }

          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            products(keys: [ProductKeyInput!]! @openfed__is(fields: "id sku")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `,
        'products',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['keys', 'id'], isBatch: true },
            { entityKeyField: 'sku', argumentPath: ['keys', 'sku'], isBatch: true },
          ],
        },
      ]);
    });

    test('rule 29d-ii: an input-object list argument without @openfed__is(fields: "...") does not auto-map to a composite key', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          input ProductKeyInput {
            id: ID!
            sku: String!
          }

          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            products(keys: [ProductKeyInput!]!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(warnings).toHaveLength(0);

      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          input ProductKeyInput {
            id: ID!
            sku: String!
          }

          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            products(keys: [ProductKeyInput!]!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `,
        'products',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([]);
    });

    test('rule 29d-iii: @openfed__is(fields: "id sku") rejects input-object field type mismatches on list returns', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          input ProductKeyInput {
            id: String!
            sku: String!
          }

          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            products(keys: [ProductKeyInput!]! @openfed__is(fields: "id sku")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(keys: ...)', FIRST_ORDINAL, [
          inputObjectCompositeTypeMismatchErrorMessage(
            'keys',
            'Query.products',
            'id sku',
            'Product',
            'ProductKeyInput',
            'id',
            'String!',
            'Product.id',
            'ID!',
          ),
        ]),
      );
    });

    test('rule 29d-iv: @openfed__is(fields: "id sku") rejects input objects that omit required key fields on list returns', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          input ProductKeyInput {
            id: ID!
          }

          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            products(keys: [ProductKeyInput!]! @openfed__is(fields: "id sku")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.products(keys: ...)', FIRST_ORDINAL, [
          inputObjectCompositeMissingFieldErrorMessage(
            'keys',
            'Query.products',
            'id sku',
            'Product',
            'ProductKeyInput',
            'sku',
          ),
        ]),
      );
    });

    test('rule 29d-v: a singular input object can map to a composite key via @openfed__is(fields: "id sku")', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          input ProductKeyInput {
            id: ID!
            sku: String!
          }

          type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }

          type Query {
            product(key: ProductKeyInput! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'id', argumentPath: ['key', 'id'] },
            { entityKeyField: 'sku', argumentPath: ['key', 'sku'] },
          ],
        },
      ]);
    });

    test('rule 30: a nested input object can recursively auto-map to a nested key structure', () => {
      const rootFieldConfig = getSingleQueryRootFieldConfig(
        `
          type Location {
            id: ID!
            region: String!
          }

          type Store {
            id: ID!
            location: Location!
          }

          input LocationInput {
            id: ID!
            region: String!
          }

          input StoreInput {
            id: ID!
            location: LocationInput!
          }

          type Product @key(fields: "store { id location { id region } }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }

          type Query {
            product(store: StoreInput!): Product @openfed__queryCache(maxAge: 30)
          }
        `,
        'product',
      );

      expect(rootFieldConfig.entityKeyMappings).toStrictEqual([
        {
          entityTypeName: 'Product',
          fieldMappings: [
            { entityKeyField: 'store.id', argumentPath: ['store', 'id'] },
            { entityKeyField: 'store.location.id', argumentPath: ['store', 'location', 'id'] },
            { entityKeyField: 'store.location.region', argumentPath: ['store', 'location', 'region'] },
          ],
        },
      ]);
    });

    test('rule 31: nested input-object mapping reports nested leaf type mismatches precisely', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Location {
            id: ID!
            region: String!
          }

          type Store {
            id: ID!
            location: Location!
          }

          input LocationInput {
            id: Int!
            region: String!
          }

          input StoreInput {
            id: ID!
            location: LocationInput!
          }

          type Product @key(fields: "store { id location { id region } }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }

          type Query {
            product(store: StoreInput!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          nestedInputObjectTypeMismatchErrorMessage(
            'store',
            'Query.product',
            'store { id location { id region } }',
            'Product',
            'LocationInput',
            'id',
            'Int!',
            'Location.id',
            'ID!',
          ),
        ]),
      );
    });

    test('rule 32: nested input-object mapping reports missing nested key fields precisely', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Location {
            id: ID!
            region: String!
          }

          type Store {
            id: ID!
            location: Location!
          }

          input LocationInput {
            id: ID!
          }

          input StoreInput {
            id: ID!
            location: LocationInput!
          }

          type Product @key(fields: "store { id location { id region } }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }

          type Query {
            product(store: StoreInput!): Product @openfed__queryCache(maxAge: 30)
          }
        `),
        version,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(QUERY_CACHE, 'Query.product', FIRST_ORDINAL, [
          nestedInputObjectMissingFieldErrorMessage(
            'store',
            'Query.product',
            'store { id location { id region } }',
            'Product',
            'LocationInput',
            'region',
          ),
        ]),
      );
    });
  });
});
