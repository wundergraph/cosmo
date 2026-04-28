import { describe, expect, test } from 'vitest';
import {
  FIRST_ORDINAL,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  LIST_SIZE,
  listSizeAssumedSizeSlicingArgDefaultErrorMessage,
  listSizeAssumedSizeWithRequiredSlicingArgumentErrorMessage,
  listSizeFieldMustReturnListOrUseSizedFieldsErrorMessage,
  listSizeInvalidSlicingArgumentErrorMessage,
  listSizeSizedFieldNotFoundErrorMessage,
  listSizeSizedFieldNotListErrorMessage,
  listSizeSizedFieldsInvalidReturnTypeErrorMessage,
  listSizeSizedFieldsOnListsErrorMessage,
  listSizeSlicingArgumentMalformedPathErrorMessage,
  listSizeSlicingArgumentNotIntErrorMessage,
  listSizeSlicingArgumentSegmentNotFoundErrorMessage,
  listSizeSlicingArgumentSegmentNotInputObjectErrorMessage,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
} from '../../../src';
import { LIST_SIZE_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import {
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

const NORMALIZATION_SCHEMA_QUERY = `
  schema {
    query: Query
  }
`;

describe('@listSize directive tests', () => {
  describe('normalization tests', () => {
    test('that @listSize with assumedSize is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithAssumedSize, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            LIST_SIZE_DIRECTIVE +
            `
            type Query {
              users: [User!]! @listSize(assumedSize: 100)
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize with slicingArguments is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithSlicingArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            LIST_SIZE_DIRECTIVE +
            `
            type Query {
              users(first: Int, last: Int): [User!]! @listSize(slicingArguments: ["first", "last"])
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize with sizedFields is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithSizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            LIST_SIZE_DIRECTIVE +
            `
            type Connection {
              edges: [Edge!]!
              nodes: [User!]!
            }

            type Edge {
              node: User!
            }

            type Query {
              usersConnection(first: Int): Connection! @listSize(slicingArguments: ["first"], sizedFields: ["edges", "nodes"])
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize with requireOneSlicingArgument is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraphWithRequireOneSlicingArgument,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            LIST_SIZE_DIRECTIVE +
            `
            type Query {
              users(after: String, first: Int): [User!]! @listSize(slicingArguments: ["first"], requireOneSlicingArgument: false)
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize with all arguments is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithAllArgumentsValid, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            LIST_SIZE_DIRECTIVE +
            `
            type Connection {
              edges: [Edge!]!
              nodes: [User!]!
            }

            type Edge {
              node: User!
            }

            type Query {
              usersConnection(first: Int, last: Int): Connection! @listSize(assumedSize: 50, slicingArguments: ["first", "last"], sizedFields: ["edges", "nodes"], requireOneSlicingArgument: false)
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that multiple @listSize directives on different fields are correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithMultipleListSize, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            LIST_SIZE_DIRECTIVE +
            `
            type Post {
              id: ID!
            }

            type Query {
              posts: [Post!]! @listSize(assumedSize: 20)
              users: [User!]! @listSize(assumedSize: 100)
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });
  });

  describe('federation tests', () => {
    test('that @listSize is stripped from federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithAssumedSize],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              users: [User!]!
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize with all arguments is stripped from federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithAllArgumentsValid],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Connection {
              edges: [Edge!]!
              nodes: [User!]!
            }

            type Edge {
              node: User!
            }

            type Query {
              usersConnection(first: Int, last: Int): Connection!
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithAssumedSize],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              users: [User!]!
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @listSize with all arguments is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithAllArgumentsValid],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Connection {
              edges: [Edge!]!
              nodes: [User!]!
            }

            type Edge {
              node: User!
            }

            type Query {
              usersConnection(first: Int, last: Int): Connection!
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });
  });

  describe('validation tests', () => {
    test('that @listSize with invalid slicingArguments produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithInvalidSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeInvalidSlicingArgumentErrorMessage('Query.users', 'nonexistent'),
        ]),
      );
    });

    test('that @listSize with non-Int slicingArgument type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithNonIntSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.users', 'name', 'String'),
        ]),
      );
    });

    test('that @listSize with list-typed slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithListTypedSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.users', 'first', '[Int]'),
        ]),
      );
    });

    test('that @listSize with non-null list-typed slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNonNullListTypedSlicingArg,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.users', 'first', '[Int]!'),
        ]),
      );
    });

    test('that @listSize with list of non-null Int slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithListOfNonNullIntSlicingArg,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.users', 'first', '[Int!]'),
        ]),
      );
    });

    test('that @listSize with non-null list of non-null Int slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNonNullListOfNonNullIntSlicingArg,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.users', 'first', '[Int!]!'),
        ]),
      );
    });

    test('that @listSize with invalid sizedFields produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithInvalidSizedField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.usersConnection', FIRST_ORDINAL, [
          listSizeSizedFieldNotFoundErrorMessage('Query.usersConnection', 'nonexistent', 'Connection'),
        ]),
      );
    });

    test('that @listSize with non-list sizedField produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithNonListSizedField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.usersConnection', FIRST_ORDINAL, [
          listSizeSizedFieldNotListErrorMessage('Query.usersConnection', 'totalCount', 'Connection', 'Int!'),
        ]),
      );
    });

    test('that @listSize on non-list field without sizedFields produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithListSizeOnNonListField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.user', FIRST_ORDINAL, [
          listSizeFieldMustReturnListOrUseSizedFieldsErrorMessage('Query.user', 'User!'),
        ]),
      );
    });

    test('that bare @listSize (no arguments) on non-list field produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithBareListSizeOnNonListField,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.user', FIRST_ORDINAL, [
          listSizeFieldMustReturnListOrUseSizedFieldsErrorMessage('Query.user', 'User!'),
        ]),
      );
    });
  });

  describe('costs.listSizes internal structure tests', () => {
    test('that @listSize with assumedSize populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithAssumedSize, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.users')).toEqual({
        typeName: 'Query',
        fieldName: 'users',
        assumedSize: 100,
        requireOneSlicingArgument: true,
        sizedFields: [],
        slicingArguments: [],
      });
    });

    test('that @listSize with slicingArguments populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithSlicingArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.users')).toEqual({
        typeName: 'Query',
        fieldName: 'users',
        requireOneSlicingArgument: true,
        sizedFields: [],
        slicingArguments: ['first', 'last'],
      });
    });

    test('that @listSize with sizedFields populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithSizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.usersConnection')).toEqual({
        typeName: 'Query',
        fieldName: 'usersConnection',
        requireOneSlicingArgument: true,
        slicingArguments: ['first'],
        sizedFields: ['edges', 'nodes'],
      });
    });

    test('that @listSize with requireOneSlicingArgument populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(
        subgraphWithRequireOneSlicingArgument,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const ls = costs.listSizes.get('Query.users');
      expect(ls).toBeDefined();
      expect(ls!.requireOneSlicingArgument).toBe(false);
      expect(ls!.slicingArguments).toEqual(['first']);
    });

    test('that @listSize with all arguments populates listSizes with all fields', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithAllArgumentsValid, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.usersConnection')).toEqual({
        typeName: 'Query',
        fieldName: 'usersConnection',
        assumedSize: 50,
        slicingArguments: ['first', 'last'],
        sizedFields: ['edges', 'nodes'],
        requireOneSlicingArgument: false,
      });
    });

    test('that multiple @listSize directives on different fields populate listSizes for each', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithMultipleListSize, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.size).toBe(2);
      expect(costs.listSizes.get('Query.users')?.assumedSize).toBe(100);
      expect(costs.listSizes.get('Query.posts')?.assumedSize).toBe(20);
    });
  });

  describe('directive definition compliance tests', () => {
    test('that @listSize with string assumedSize produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithInvalidAssumedSizeType, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('"not an int"', '@listSize', 'assumedSize', 'Int'),
        ]),
      );
    });

    test('that @listSize with single string slicingArguments succeeds due to list coercion', () => {
      // GraphQL allows list coercion: "first" is coerced to ["first"]
      const { costs } = normalizeSubgraphSuccess(subgraphWithNonListSlicingArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
      const ls = costs.listSizes.get('Query.users');
      expect(ls).toBeDefined();
      expect(ls!.requireOneSlicingArgument).toBe(true);
      expect(ls!.slicingArguments).toEqual(['first']);
    });

    test('that @listSize with single string sizedFields succeeds due to list coercion', () => {
      // GraphQL allows list coercion: "edges" is coerced to ["edges"]
      const { costs } = normalizeSubgraphSuccess(subgraphWithNonListSizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      const ls = costs.listSizes.get('Query.usersConnection');
      expect(ls).toBeDefined();
      expect(ls!.sizedFields).toEqual(['edges']);
    });

    test('that @listSize with null in slicingArguments array produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithNullInSlicingArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('[null]', '@listSize', 'slicingArguments', '[String!]'),
        ]),
      );
    });

    test('that @listSize with integer sizedFields produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithIntegerSizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.usersConnection', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('123', '@listSize', 'sizedFields', '[String!]'),
          listSizeFieldMustReturnListOrUseSizedFieldsErrorMessage('Query.usersConnection', 'Connection!'),
        ]),
      );
    });

    test('that @listSize with sizedFields on lists produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithListSizedFieldsOnLists, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.connections', FIRST_ORDINAL, [
          listSizeSizedFieldsOnListsErrorMessage('Query.connections', '[Connection]'),
        ]),
      );
    });

    test('that @listSize with sizedFields on deep lists produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithListSizedFieldsOnDeepLists,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.connections', FIRST_ORDINAL, [
          listSizeSizedFieldsOnListsErrorMessage('Query.connections', '[[[Connection!]!]!]!'),
        ]),
      );
    });

    test('that @listSize with non-boolean requireOneSlicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithInvalidRequireOneSlicingArgument,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('123', '@listSize', 'requireOneSlicingArgument', 'Boolean'),
        ]),
      );
    });
  });

  describe('spec 9.2.2 - Valid Sized Fields Target', () => {
    test('that @listSize with empty sizedFields on non-list field produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithEmptySizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.name', FIRST_ORDINAL, [
          listSizeFieldMustReturnListOrUseSizedFieldsErrorMessage('Query.name', 'String'),
        ]),
      );
    });

    test('that @listSize with sizedFields on a scalar return type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithSizedFieldsOnScalarReturn,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.name', FIRST_ORDINAL, [
          listSizeSizedFieldsInvalidReturnTypeErrorMessage('Query.name', 'String'),
        ]),
      );
    });

    test('that @listSize with sizedFields on an enum return type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithSizedFieldsOnEnumReturn,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.status', FIRST_ORDINAL, [
          listSizeSizedFieldsInvalidReturnTypeErrorMessage('Query.status', 'Status'),
        ]),
      );
    });

    test('that @listSize with sizedFields on a union return type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithSizedFieldsOnUnionReturn,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.animal', FIRST_ORDINAL, [
          listSizeSizedFieldsInvalidReturnTypeErrorMessage('Query.animal', 'Animal'),
        ]),
      );
    });
  });

  describe('spec 9.2.4 - Valid Assumed Size', () => {
    test('that @listSize with assumedSize and slicingArguments with requireOneSlicingArgument true produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithAssumedSizeAndSlicingRequireOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeAssumedSizeWithRequiredSlicingArgumentErrorMessage('Query.users'),
        ]),
      );
    });

    test('that @listSize with assumedSize and slicingArguments with implicit requireOneSlicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithAssumedSizeAndSlicingImplicitRequireOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeAssumedSizeWithRequiredSlicingArgumentErrorMessage('Query.users'),
        ]),
      );
    });

    test('that @listSize with assumedSize and slicingArguments with requireOneSlicingArgument false and no defaults succeeds', () => {
      const { costs } = normalizeSubgraphSuccess(
        subgraphWithAssumedSizeAndSlicingNoRequireOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const ls = costs.listSizes.get('Query.users');
      expect(ls).toBeDefined();
      expect(ls!.assumedSize).toBe(50);
      expect(ls!.slicingArguments).toEqual(['first']);
      expect(ls!.requireOneSlicingArgument).toBe(false);
    });

    test('that @listSize with assumedSize and slicingArguments with requireOneSlicingArgument false but slicing arg has default produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithAssumedSizeAndSlicingArgDefault,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.users', FIRST_ORDINAL, [
          listSizeAssumedSizeSlicingArgDefaultErrorMessage('Query.users', 'first'),
        ]),
      );
    });
  });

  describe('nested-path slicingArguments tests', () => {
    test('that @listSize with a single-level nested path is correctly normalized', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithNestedSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      const ls = costs.listSizes.get('Query.search');
      expect(ls).toBeDefined();
      expect(ls!.slicingArguments).toEqual(['input.first']);
    });

    test('that @listSize with a two-level nested path is correctly normalized', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithDeepNestedSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      const ls = costs.listSizes.get('Query.search');
      expect(ls).toBeDefined();
      expect(ls!.slicingArguments).toEqual(['input.pagination.first']);
    });

    test('that @listSize with a mix of flat and nested slicingArguments is correctly normalized', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithMixedSlicingArgs, ROUTER_COMPATIBILITY_VERSION_ONE);
      const ls = costs.listSizes.get('Query.search');
      expect(ls).toBeDefined();
      expect(ls!.requireOneSlicingArgument).toBe(false);
      expect(ls!.slicingArguments).toEqual(['limit', 'input.pagination.first']);
    });

    test('that @listSize with a non-null Int leaf in a nested path is accepted', () => {
      const { costs } = normalizeSubgraphSuccess(
        subgraphWithNestedSlicingArgNonNullLeaf,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const ls = costs.listSizes.get('Query.search');
      expect(ls).toBeDefined();
      expect(ls!.slicingArguments).toEqual(['input.first']);
    });

    test('that a non-null input-object intermediate is traversed correctly', () => {
      const { costs } = normalizeSubgraphSuccess(
        subgraphWithNestedSlicingArgNonNullIntermediate,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const ls = costs.listSizes.get('Query.search');
      expect(ls).toBeDefined();
      expect(ls!.slicingArguments).toEqual(['input.pagination.first']);
    });

    test('that an unknown intermediate segment produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgUnknownIntermediate,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentSegmentNotFoundErrorMessage(
            'Query.search',
            'input.bogus.first',
            'bogus',
            'SearchInput',
          ),
        ]),
      );
    });

    test('that an unknown leaf segment produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgUnknownLeaf,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentSegmentNotFoundErrorMessage(
            'Query.search',
            'input.pagination.bogus',
            'bogus',
            'PaginationInput',
          ),
        ]),
      );
    });

    test('that traversing through a non-input-object intermediate produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgScalarIntermediate,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentSegmentNotInputObjectErrorMessage(
            'Query.search',
            'input.query.first',
            'query',
            'String',
          ),
        ]),
      );
    });

    test('that traversing through a list-typed intermediate produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgListIntermediate,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentSegmentNotInputObjectErrorMessage(
            'Query.search',
            'input.paginations.first',
            'paginations',
            '[PaginationInput!]',
          ),
        ]),
      );
    });

    test('that a nested path whose leaf is not Int produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgNonIntLeaf,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.search', 'input.pagination.cursor', 'String'),
        ]),
      );
    });

    test('that a nested path whose leaf is a list produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgListLeaf,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.search', 'input.first', '[Int]'),
        ]),
      );
    });

    test('that a malformed path with starting empty segments produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgMalformedPathStart,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentMalformedPathErrorMessage('Query.search', '.input.first'),
        ]),
      );
    });

    test('that a malformed path with middle empty segments produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgMalformedPathMiddle,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentMalformedPathErrorMessage('Query.search', 'input..first'),
        ]),
      );
    });

    test('that a malformed path with ending empty segments produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgMalformedPathEnd,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentMalformedPathErrorMessage('Query.search', 'input.first.'),
        ]),
      );
    });

    test('that a path whose first segment is not a defined argument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgUnknownArgument,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeInvalidSlicingArgumentErrorMessage('Query.search', 'bogus.pagination.first'),
        ]),
      );
    });

    test('that a flat path pointing at an input-object argument produces a not-Int error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithFlatSlicingArgInputObject,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeSlicingArgumentNotIntErrorMessage('Query.search', 'input', 'PaginationInput!'),
        ]),
      );
    });

    test('that an intermediate-field default value is rejected when assumedSize is also set', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgIntermediateDefaultPlusAssumedSize,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeAssumedSizeSlicingArgDefaultErrorMessage('Query.search', 'input.pagination.first'),
        ]),
      );
    });

    test('that an argument default value covering a nested leaf is rejected when assumedSize is also set', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgArgumentDefaultPlusAssumedSize,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeAssumedSizeSlicingArgDefaultErrorMessage('Query.search', 'input.first'),
        ]),
      );
    });

    test('that a nested-leaf default value is rejected when assumedSize is also set', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNestedSlicingArgLeafDefaultPlusAssumedSize,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(LIST_SIZE, 'Query.search', FIRST_ORDINAL, [
          listSizeAssumedSizeSlicingArgDefaultErrorMessage('Query.search', 'input.first'),
        ]),
      );
    });
  });
});

const subgraphWithAssumedSize: Subgraph = {
  name: 'subgraph-listsize-assumed',
  url: '',
  definitions: parse(`
    type Query {
      users: [User!]! @listSize(assumedSize: 100)
    }

    type User {
      id: ID!
    }
  `),
};

const subgraphWithSlicingArguments: Subgraph = {
  name: 'subgraph-listsize-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int, last: Int): [User!]! @listSize(slicingArguments: ["first", "last"])
    }

    type User {
      id: ID!
    }
  `),
};

const subgraphWithSizedFields: Subgraph = {
  name: 'subgraph-listsize-sized',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int): Connection! @listSize(slicingArguments: ["first"], sizedFields: ["edges", "nodes"])
    }

    type Connection {
      edges: [Edge!]!
      nodes: [User!]!
    }

    type Edge {
      node: User!
    }

    type User {
      id: ID!
    }
  `),
};

const subgraphWithRequireOneSlicingArgument: Subgraph = {
  name: 'subgraph-listsize-require',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int, after: String): [User!]! @listSize(slicingArguments: ["first"], requireOneSlicingArgument: false)
    }

    type User {
      id: ID!
    }
  `),
};

const subgraphWithMultipleListSize: Subgraph = {
  name: 'subgraph-listsize-multiple',
  url: '',
  definitions: parse(`
    type Query {
      users: [User!]! @listSize(assumedSize: 100)
      posts: [Post!]! @listSize(assumedSize: 20)
    }

    type User {
      id: ID!
    }

    type Post {
      id: ID!
    }
  `),
};

const subgraphWithInvalidSlicingArg: Subgraph = {
  name: 'subgraph-listsize-invalid-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(slicingArguments: ["first", "nonexistent"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithNonIntSlicingArg: Subgraph = {
  name: 'subgraph-listsize-nonint-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(name: String): [User!]! @listSize(slicingArguments: ["name"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithListTypedSlicingArg: Subgraph = {
  name: 'subgraph-listsize-list-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(first: [Int]): [User!]! @listSize(slicingArguments: ["first"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithNonNullListTypedSlicingArg: Subgraph = {
  name: 'subgraph-listsize-nonnull-list-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(first: [Int]!): [User!]! @listSize(slicingArguments: ["first"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithListOfNonNullIntSlicingArg: Subgraph = {
  name: 'subgraph-listsize-list-nonnull-int-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(first: [Int!]): [User!]! @listSize(slicingArguments: ["first"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithNonNullListOfNonNullIntSlicingArg: Subgraph = {
  name: 'subgraph-listsize-nonnull-list-nonnull-int-slicing',
  url: '',
  definitions: parse(`
    type Query {
      users(first: [Int!]!): [User!]! @listSize(slicingArguments: ["first"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithInvalidSizedField: Subgraph = {
  name: 'subgraph-listsize-invalid-sized',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int): Connection! @listSize(slicingArguments: ["first"], sizedFields: ["nonexistent"])
    }
    type Connection { edges: [Edge!]! }
    type Edge { node: User! }
    type User { id: ID! }
  `),
};

const subgraphWithNonListSizedField: Subgraph = {
  name: 'subgraph-listsize-nonlist-sized',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int): Connection! @listSize(slicingArguments: ["first"], sizedFields: ["totalCount"])
    }
    type Connection { edges: [Edge!]! totalCount: Int! }
    type Edge { node: User! }
    type User { id: ID! }
  `),
};

const subgraphWithListSizeOnNonListField: Subgraph = {
  name: 'subgraph-listsize-nonlist',
  url: '',
  definitions: parse(`
    type Query {
      user: User! @listSize(assumedSize: 1)
    }
    type User { id: ID! }
  `),
};

const subgraphWithBareListSizeOnNonListField: Subgraph = {
  name: 'subgraph-bare-listsize-nonlist',
  url: '',
  definitions: parse(`
    type Query {
      user: User! @listSize
    }
    type User { id: ID! }
  `),
};

const subgraphWithInvalidAssumedSizeType: Subgraph = {
  name: 'subgraph-listsize-invalid-assumedsize',
  url: '',
  definitions: parse(`
    type Query {
      users: [User!]! @listSize(assumedSize: "not an int")
    }
    type User { id: ID! }
  `),
};

const subgraphWithNonListSlicingArguments: Subgraph = {
  name: 'subgraph-listsize-nonlist-slicingargs',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(slicingArguments: "first")
    }
    type User { id: ID! }
  `),
};

const subgraphWithNonListSizedFields: Subgraph = {
  name: 'subgraph-listsize-nonlist-sizedfields',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int): Connection! @listSize(slicingArguments: ["first"], sizedFields: "edges")
    }
    type Connection { edges: [Edge!]! }
    type Edge { node: User! }
    type User { id: ID! }
  `),
};

const subgraphWithListSizedFieldsOnLists: Subgraph = {
  name: 'subgraph-listsize-sizedfields-on-lists',
  url: '',
  definitions: parse(`
    type Query {
      connections(first: Int): [Connection] @listSize(slicingArguments: ["first"], sizedFields: "edges")
    }
    type Connection { edges: [Edge!]! }
    type Edge { node: User! }
    type User { id: ID! }
  `),
};

const subgraphWithListSizedFieldsOnDeepLists: Subgraph = {
  name: 'subgraph-listsize-sizedfields-on-lists',
  url: '',
  definitions: parse(`
    type Query {
      connections(first: Int): [[[Connection!]!]!]! @listSize(slicingArguments: ["first"], sizedFields: "edges")
    }
    type Connection { edges: [Edge!]! }
    type Edge { node: User! }
    type User { id: ID! }
  `),
};

const subgraphWithNullInSlicingArguments: Subgraph = {
  name: 'subgraph-listsize-null-slicingargs',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(slicingArguments: [null])
    }
    type User { id: ID! }
  `),
};

const subgraphWithIntegerSizedFields: Subgraph = {
  name: 'subgraph-listsize-integer-sizedfields',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int): Connection! @listSize(slicingArguments: ["first"], sizedFields: 123)
    }
    type Connection { edges: [Edge!]! }
    type Edge { node: User! }
    type User { id: ID! }
  `),
};

const subgraphWithInvalidRequireOneSlicingArgument: Subgraph = {
  name: 'subgraph-listsize-invalid-requireone',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(slicingArguments: ["first"], requireOneSlicingArgument: 123)
    }
    type User { id: ID! }
  `),
};

// --- 9.2.2 fixtures: sizedFields on non-composite return types ---

const subgraphWithEmptySizedFields: Subgraph = {
  name: 'subgraph-listsize-empty-sizedfields',
  url: '',
  definitions: parse(`
    type Query {
      name: String @listSize(sizedFields: [])
    }
  `),
};

const subgraphWithSizedFieldsOnScalarReturn: Subgraph = {
  name: 'subgraph-listsize-sizedfields-scalar',
  url: '',
  definitions: parse(`
    type Query {
      name: String @listSize(sizedFields: ["foo"])
    }
  `),
};

const subgraphWithSizedFieldsOnEnumReturn: Subgraph = {
  name: 'subgraph-listsize-sizedfields-enum',
  url: '',
  definitions: parse(`
    enum Status { ACTIVE INACTIVE }
    type Query {
      status: Status @listSize(sizedFields: ["foo"])
    }
  `),
};

const subgraphWithSizedFieldsOnUnionReturn: Subgraph = {
  name: 'subgraph-listsize-sizedfields-union',
  url: '',
  definitions: parse(`
    type Dog { name: String }
    type Cat { name: String }
    union Animal = Dog | Cat
    type Query {
      animal: Animal @listSize(sizedFields: ["edges"])
    }
  `),
};

// --- 9.2.4 fixtures: assumedSize + slicingArguments combinations ---

const subgraphWithAssumedSizeAndSlicingRequireOne: Subgraph = {
  name: 'subgraph-listsize-assumed-slicing-requireone',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(assumedSize: 50, slicingArguments: ["first"], requireOneSlicingArgument: true)
    }
    type User { id: ID! }
  `),
};

const subgraphWithAssumedSizeAndSlicingImplicitRequireOne: Subgraph = {
  name: 'subgraph-listsize-assumed-slicing-implicit-requireone',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(assumedSize: 50, slicingArguments: ["first"])
    }
    type User { id: ID! }
  `),
};

const subgraphWithAssumedSizeAndSlicingNoRequireOne: Subgraph = {
  name: 'subgraph-listsize-assumed-slicing-no-requireone',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int): [User!]! @listSize(assumedSize: 50, slicingArguments: ["first"], requireOneSlicingArgument: false)
    }
    type User { id: ID! }
  `),
};

const subgraphWithAssumedSizeAndSlicingArgDefault: Subgraph = {
  name: 'subgraph-listsize-assumed-slicing-arg-default',
  url: '',
  definitions: parse(`
    type Query {
      users(first: Int = 10): [User!]! @listSize(assumedSize: 50, slicingArguments: ["first"], requireOneSlicingArgument: false)
    }
    type User { id: ID! }
  `),
};

// 9.2.4: valid version of "all arguments" -- requireOneSlicingArgument: false, no defaults on slicing args
const subgraphWithAllArgumentsValid: Subgraph = {
  name: 'subgraph-listsize-all-valid',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int, last: Int): Connection! @listSize(assumedSize: 50, slicingArguments: ["first", "last"], sizedFields: ["edges", "nodes"], requireOneSlicingArgument: false)
    }

    type Connection {
      edges: [Edge!]!
      nodes: [User!]!
    }

    type Edge {
      node: User!
    }

    type User {
      id: ID!
    }
  `),
};

// --- nested-path slicingArguments fixtures ---

const subgraphWithNestedSlicingArg: Subgraph = {
  name: 'subgraph-listsize-nested-slicing',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: ["input.first"], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithDeepNestedSlicingArg: Subgraph = {
  name: 'subgraph-listsize-deep-nested-slicing',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.pagination.first"], requireOneSlicingArgument: true)
    }
    input SearchInput { pagination: PaginationInput, query: String }
    input PaginationInput { first: Int, after: String }
    type Book { id: ID! }
  `),
};

const subgraphWithMixedSlicingArgs: Subgraph = {
  name: 'subgraph-listsize-mixed-slicing',
  url: '',
  definitions: parse(`
    type Query {
      search(limit: Int, input: SearchInput!): [Book]
        @listSize(slicingArguments: ["limit", "input.pagination.first"], requireOneSlicingArgument: false)
    }
    input SearchInput { pagination: PaginationInput }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgNonNullLeaf: Subgraph = {
  name: 'subgraph-listsize-nested-nonnull-leaf',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: ["input.first"], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: Int! }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgNonNullIntermediate: Subgraph = {
  name: 'subgraph-listsize-nested-nonnull-intermediate',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.pagination.first"], requireOneSlicingArgument: true)
    }
    input SearchInput { pagination: PaginationInput! }
    input PaginationInput { first: Int! }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgUnknownIntermediate: Subgraph = {
  name: 'subgraph-listsize-nested-unknown-intermediate',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.bogus.first"], requireOneSlicingArgument: true)
    }
    input SearchInput { pagination: PaginationInput }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgUnknownLeaf: Subgraph = {
  name: 'subgraph-listsize-nested-unknown-leaf',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.pagination.bogus"], requireOneSlicingArgument: true)
    }
    input SearchInput { pagination: PaginationInput }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgScalarIntermediate: Subgraph = {
  name: 'subgraph-listsize-nested-scalar-intermediate',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.query.first"], requireOneSlicingArgument: true)
    }
    input SearchInput { query: String }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgListIntermediate: Subgraph = {
  name: 'subgraph-listsize-nested-list-intermediate',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.paginations.first"], requireOneSlicingArgument: true)
    }
    input SearchInput { paginations: [PaginationInput!] }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgNonIntLeaf: Subgraph = {
  name: 'subgraph-listsize-nested-nonint-leaf',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["input.pagination.cursor"], requireOneSlicingArgument: true)
    }
    input SearchInput { pagination: PaginationInput }
    input PaginationInput { cursor: String }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgListLeaf: Subgraph = {
  name: 'subgraph-listsize-nested-list-leaf',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: ["input.first"], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: [Int] }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgMalformedPathStart: Subgraph = {
  name: 'subgraph-listsize-nested-malformed-path',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: [".input.first"], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgMalformedPathMiddle: Subgraph = {
  name: 'subgraph-listsize-nested-malformed-path',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: ["input..first"], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgMalformedPathEnd: Subgraph = {
  name: 'subgraph-listsize-nested-malformed-path',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: ["input.first."], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgUnknownArgument: Subgraph = {
  name: 'subgraph-listsize-nested-unknown-arg',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(slicingArguments: ["bogus.pagination.first"], requireOneSlicingArgument: true)
    }
    input SearchInput { pagination: PaginationInput }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithFlatSlicingArgInputObject: Subgraph = {
  name: 'subgraph-listsize-flat-slicing-input-object',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(slicingArguments: ["input"], requireOneSlicingArgument: true)
    }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgIntermediateDefaultPlusAssumedSize: Subgraph = {
  name: 'subgraph-listsize-nested-intermediate-default-assumed',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Book]
        @listSize(assumedSize: 50, slicingArguments: ["input.pagination.first"], requireOneSlicingArgument: false)
    }
    input SearchInput { pagination: PaginationInput = { first: 10 } }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgArgumentDefaultPlusAssumedSize: Subgraph = {
  name: 'subgraph-listsize-nested-argument-default-assumed',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput = { first: 10 }): [Book]
        @listSize(assumedSize: 50, slicingArguments: ["input.first"], requireOneSlicingArgument: false)
    }
    input PaginationInput { first: Int }
    type Book { id: ID! }
  `),
};

const subgraphWithNestedSlicingArgLeafDefaultPlusAssumedSize: Subgraph = {
  name: 'subgraph-listsize-nested-leaf-default-assumed',
  url: '',
  definitions: parse(`
    type Query {
      search(input: PaginationInput!): [Book]
        @listSize(assumedSize: 50, slicingArguments: ["input.first"], requireOneSlicingArgument: false)
    }
    input PaginationInput { first: Int = 10 }
    type Book { id: ID! }
  `),
};
