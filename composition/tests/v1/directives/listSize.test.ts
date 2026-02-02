import { describe, expect, test } from 'vitest';
import { parse, ROUTER_COMPATIBILITY_VERSION_ONE, Subgraph } from '../../../src';
import { LIST_SIZE_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import {
  federateSubgraphsSuccess,
  normalizeString,
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
      const { schema } = normalizeSubgraphSuccess(subgraphWithAllArguments, ROUTER_COMPATIBILITY_VERSION_ONE);
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
              usersConnection(first: Int, last: Int): Connection! @listSize(assumedSize: 50, slicingArguments: ["first", "last"], sizedFields: ["edges", "nodes"], requireOneSlicingArgument: true)
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
    test('that @listSize with assumedSize is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithAssumedSize],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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

    test('that @listSize with slicingArguments is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithSlicingArguments],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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

    test('that @listSize with all arguments is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithAllArguments],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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
              usersConnection(first: Int, last: Int): Connection! @listSize(assumedSize: 50, slicingArguments: ["first", "last"], sizedFields: ["edges", "nodes"], requireOneSlicingArgument: true)
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that multiple @listSize directives on different fields are preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithMultipleListSize],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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

const subgraphWithAllArguments: Subgraph = {
  name: 'subgraph-listsize-all',
  url: '',
  definitions: parse(`
    type Query {
      usersConnection(first: Int, last: Int): Connection! @listSize(assumedSize: 50, slicingArguments: ["first", "last"], sizedFields: ["edges", "nodes"], requireOneSlicingArgument: true)
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
