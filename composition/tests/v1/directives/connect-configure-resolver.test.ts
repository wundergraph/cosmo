import { describe, expect, test } from 'vitest';
import {
  NormalizationFailure,
  NormalizationSuccess,
  normalizeSubgraph,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { parse, printSchema } from 'graphql';

describe('@connect__configureResolver tests', () => {
  test('that @connect__configureResolver is automatically included in the subgraph schema if it is referenced', () => {
    const result = normalizeSubgraph(
      subgraphWithConnectConfigureResolver.definitions,
      subgraphWithConnectConfigureResolver.name,
      undefined,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );

    expect(result.success).toBe(true);
    const normalizationSuccess = result as NormalizationSuccess;
    expect(normalizationSuccess.warnings).toHaveLength(0);
    expect(normalizationSuccess.subgraphString).toContain(
      `directive @connect__configureResolver(context: connect__FieldSet!) on FIELD_DEFINITION`,
    );
    expect(normalizationSuccess.subgraphString).toContain(`scalar connect__FieldSet`);
  });

  test('that @connect__configureResolver needs to have a context', () => {
    const result = normalizeSubgraph(
      subgraphWithConnectConfigureResolverWithoutContext.definitions,
      subgraphWithConnectConfigureResolverWithoutContext.name,
      undefined,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );

    expect(result.success).toBe(false);
    const normalizationFailure = result as NormalizationFailure;
    expect(normalizationFailure.errors).toHaveLength(1);
    expect(normalizationFailure.errors[0].message).toContain(
      'The definition for "@connect__configureResolver" defines the following 1 required argument: "context".\n However, no arguments are defined on this instance.',
    );
  });
});

const subgraphWithConnectConfigureResolver: Subgraph = {
  name: 'connect-configure-resolver',
  url: '',
  definitions: parse(`
      type Foo {
        id: ID!
        bar(baz: String!): String @connect__configureResolver(context: "id")  
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
        id: ID!
        bar(baz: String!): String @connect__configureResolver
      }
    `),
};
