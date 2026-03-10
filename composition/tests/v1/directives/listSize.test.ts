import { describe, expect, test } from 'vitest';
import { parse, ROUTER_COMPATIBILITY_VERSION_ONE, type Subgraph } from '../../../src';
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
      expect(errors[0].message).toContain('does not reference a defined argument');
    });

    test('that @listSize with non-Int slicingArgument type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithNonIntSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('must be of type "Int" or "Int!"');
    });

    test('that @listSize with list-typed slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithListTypedSlicingArg, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('must be of type "Int" or "Int!"');
    });

    test('that @listSize with non-null list-typed slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNonNullListTypedSlicingArg,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('must be of type "Int" or "Int!"');
    });

    test('that @listSize with list of non-null Int slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithListOfNonNullIntSlicingArg,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('must be of type "Int" or "Int!"');
    });

    test('that @listSize with non-null list of non-null Int slicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithNonNullListOfNonNullIntSlicingArg,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('must be of type "Int" or "Int!"');
    });

    test('that @listSize with invalid sizedFields produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithInvalidSizedField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('does not reference a defined field');
    });

    test('that @listSize with non-list sizedField produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithNonListSizedField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('must return a list type');
    });

    test('that @listSize on non-list field without sizedFields produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithListSizeOnNonListField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a list type');
    });

    test('that bare @listSize (no arguments) on non-list field produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithBareListSizeOnNonListField,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a list type');
    });
  });

  describe('costs.listSizes internal structure tests', () => {
    test('that @listSize with assumedSize populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithAssumedSize, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.users')).toEqual({
        typeName: 'Query',
        fieldName: 'users',
        assumedSize: 100,
      });
    });

    test('that @listSize with slicingArguments populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithSlicingArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.users')).toEqual({
        typeName: 'Query',
        fieldName: 'users',
        slicingArguments: ['first', 'last'],
      });
    });

    test('that @listSize with sizedFields populates listSizes correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithSizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.listSizes.get('Query.usersConnection')).toEqual({
        typeName: 'Query',
        fieldName: 'usersConnection',
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
      expect(errors[0].message).toContain('not a valid "Int" type');
    });

    test('that @listSize with single string slicingArguments succeeds due to list coercion', () => {
      // GraphQL allows list coercion: "first" is coerced to ["first"]
      const { costs } = normalizeSubgraphSuccess(subgraphWithNonListSlicingArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
      const ls = costs.listSizes.get('Query.users');
      expect(ls).toBeDefined();
      expect(ls!.requireOneSlicingArgument).toBeUndefined();
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
      expect(errors[0].message).toContain('not a valid "[String!]" type');
    });

    test('that @listSize with integer sizedFields produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithIntegerSizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a valid "[String!]" type');
    });

    test('that @listSize with non-boolean requireOneSlicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithInvalidRequireOneSlicingArgument,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a valid "Boolean" type');
    });
  });

  describe('spec 9.2.2 - Valid Sized Fields Target', () => {
    test('that @listSize with empty sizedFields on non-list field produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithEmptySizedFields, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('is not a list type, and no "sizedFields" argument is provided.');
    });

    test('that @listSize with sizedFields on a scalar return type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithSizedFieldsOnScalarReturn,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('return type "String" is not an object or interface type');
    });

    test('that @listSize with sizedFields on an enum return type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithSizedFieldsOnEnumReturn,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('return type "Status" is not an object or interface type');
    });

    test('that @listSize with sizedFields on a union return type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithSizedFieldsOnUnionReturn,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('return type "Animal" is not an object or interface type');
    });
  });

  describe('spec 9.2.4 - Valid Assumed Size', () => {
    test('that @listSize with assumedSize and slicingArguments with requireOneSlicingArgument true produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithAssumedSizeAndSlicingRequireOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('"requireOneSlicingArgument" must be set to false');
    });

    test('that @listSize with assumedSize and slicingArguments with implicit requireOneSlicingArgument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraphWithAssumedSizeAndSlicingImplicitRequireOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('"requireOneSlicingArgument" must be set to false');
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
      expect(errors[0].message).toContain('has a default value');
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
