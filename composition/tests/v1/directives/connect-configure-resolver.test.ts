import { describe, expect, test } from 'vitest';
import {
  CONNECT_FIELD_RESOLVER,
  CONTEXT,
  invalidDirectiveError,
  NormalizationFailure,
  NormalizationSuccess,
  normalizeSubgraph,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  undefinedRequiredArgumentsErrorMessage,
} from '../../../src';
import { parse, printSchema } from 'graphql';
import {
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { CONNECT_FIELD_RESOLVER_DIRECTIVE, OPENFED_FIELD_SET, SCHEMA_QUERY_DEFINITION } from '../utils/utils';

describe('@connect__fieldResolver tests', () => {
  test('that @connect__fieldResolver is automatically included in the subgraph schema if it is referenced', () => {
    const { schema, warnings } = normalizeSubgraphSuccess(
      subgraphWithConnectConfigureResolver,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(warnings).toHaveLength(0);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          CONNECT_FIELD_RESOLVER_DIRECTIVE +
          `
        type Foo {
          bar(baz: String!): String @connect__fieldResolver(context: "id")
          id: ID!
        }
  
        type Query {
          foo: Foo!
        }
      ` +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that @connect__fieldResolver needs to have a context', () => {
    const { errors } = normalizeSubgraphFailure(
      subgraphWithConnectConfigureResolverWithoutContext,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(CONNECT_FIELD_RESOLVER, `Foo.bar`, `1st`, [
        undefinedRequiredArgumentsErrorMessage(CONNECT_FIELD_RESOLVER, [CONTEXT], []),
      ]),
    );
  });
});

const subgraphWithConnectConfigureResolver: Subgraph = {
  name: 'connect-configure-resolver',
  url: '',
  definitions: parse(`
      type Foo {
        bar(baz: String!): String @connect__fieldResolver(context: "id")
        id: ID!
      }

      type Query {
        foo: Foo!
      }
    `),
};

const subgraphWithConnectConfigureResolverWithoutContext: Subgraph = {
  name: 'connect-configure-resolver-without-context',
  url: '',
  definitions: parse(`
      type Foo {
        bar(baz: String!): String @connect__fieldResolver
        id: ID!
      }
    `),
};
