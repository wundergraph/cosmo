import {
  composeDirectiveBuiltInError,
  composeDirectiveNameMissingAtPrefixError,
  composeDirectiveNoMutualLocationsError,
  composeDirectiveRepeatableConflictError,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  undefinedComposeDirectiveNameError,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import {
  federateSubgraphsSuccess,
  federateSubgraphsFailure,
  normalizeString,
  normalizeSubgraphFailure,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('@composeDirective tests', () => {
  test('that a composed directive definition and its usages appear in the router schema', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphWithComposedDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        directive @myDirective(reason: String!) on FIELD_DEFINITION | OBJECT

        type Product {
          id: ID!
          name: String! @myDirective(reason: "field-cached")
        }

        type Query {
          product: Product
        }
      `,
      ),
    );
  });

  test('that a composed directive definition and its usages appear in the client schema', () => {
    const { federatedGraphClientSchema } = federateSubgraphsSuccess(
      [subgraphWithComposedDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        directive @myDirective(reason: String!) on FIELD_DEFINITION | OBJECT

        type Product {
          id: ID!
          name: String! @myDirective(reason: "field-cached")
        }

        type Query {
          product: Product
        }
      `,
      ),
    );
  });

  test('that object-level composed directive usages appear in both schemas', () => {
    const { federatedGraphSchema, federatedGraphClientSchema } = federateSubgraphsSuccess(
      [subgraphWithObjectLevelDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    const expected = normalizeString(
      SCHEMA_QUERY_DEFINITION +
        `
      directive @myDirective(reason: String!) on FIELD_DEFINITION | OBJECT

      type Product @myDirective(reason: "cached") {
        id: ID!
      }

      type Query {
        product: Product
      }
    `,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(expected);
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      directive @myDirective(reason: String!) on FIELD_DEFINITION | OBJECT

      type Product @myDirective(reason: "cached") {
        id: ID!
      }

      type Query {
        product: Product
      }
    `,
      ),
    );
  });

  test('that a composed directive from only one of two subgraphs still appears in the supergraph', () => {
    const { federatedGraphSchema, federatedGraphClientSchema } = federateSubgraphsSuccess(
      [subgraphWithComposedDirective, subgraphWithoutComposedDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    const expectedDirective = `directive @myDirective(reason: String!) on FIELD_DEFINITION | OBJECT`;
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toContain(expectedDirective);
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toContain(expectedDirective);
  });

  test('that a composed directive used in two subgraphs is merged into a single definition', () => {
    const { federatedGraphSchema, federatedGraphClientSchema } = federateSubgraphsSuccess(
      [subgraphAWithSharedDirective, subgraphBWithSharedDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    // definition should appear exactly once
    const routerSDL = schemaToSortedNormalizedString(federatedGraphSchema);
    const clientSDL = schemaToSortedNormalizedString(federatedGraphClientSchema);
    const occurrencesInRouter = (routerSDL.match(/directive @sharedDirective/g) ?? []).length;
    const occurrencesInClient = (clientSDL.match(/directive @sharedDirective/g) ?? []).length;
    expect(occurrencesInRouter).toBe(1);
    expect(occurrencesInClient).toBe(1);
  });

  test('that a repeatable composed directive is correctly emitted', () => {
    const { federatedGraphSchema, federatedGraphClientSchema } = federateSubgraphsSuccess(
      [subgraphWithRepeatableDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    const expected = `directive @tag2(name: String!) repeatable on FIELD_DEFINITION | OBJECT`;
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toContain(expected);
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toContain(expected);
  });

  test('that @composeDirective(name: "missingAt") returns an error during normalization', () => {
    const { errors } = normalizeSubgraphFailure(subgraphMissingAtPrefix, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(composeDirectiveNameMissingAtPrefixError('myDirective'));
  });

  test('that @composeDirective(name: "@notDefined") returns an error during normalization', () => {
    const { errors } = normalizeSubgraphFailure(subgraphUndefinedDirective, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(undefinedComposeDirectiveNameError('notDefined'));
  });

  test('that @composeDirective(name: "@key") returns an error during normalization', () => {
    const { errors } = normalizeSubgraphFailure(subgraphBuiltInDirective, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(composeDirectiveBuiltInError('key'));
  });

  test('that @composeDirective with a repeated name is deduplicated', () => {
    // Two @composeDirective(name: "@myDirective") on the same schema should not cause an error
    // and the definition should appear exactly once.
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphWithRepeatedComposeDirective],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    const sdl = schemaToSortedNormalizedString(federatedGraphSchema);
    const occurrences = (sdl.match(/directive @myDirective/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  test('that conflicting repeatable declarations for a composed directive return a composition error', () => {
    const { errors } = federateSubgraphsFailure(
      [subgraphRepeatableA, subgraphRepeatableB],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      composeDirectiveRepeatableConflictError('myDirective', new Set(['subgraph-a', 'subgraph-b'])),
    );
  });

  test('that a composed directive with disjoint locations across subgraphs returns a composition error', () => {
    const { errors } = federateSubgraphsFailure(
      [subgraphDirectiveOnFieldDefinition, subgraphDirectiveOnObject],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      composeDirectiveNoMutualLocationsError('myDirective', new Set(['subgraph-a', 'subgraph-b'])),
    );
  });
});

// ── Subgraph fixtures ──────────────────────────────────────────────────────────

const subgraphWithComposedDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) on OBJECT | FIELD_DEFINITION

    type Query {
      product: Product
    }

    type Product {
      id: ID!
      name: String! @myDirective(reason: "field-cached")
    }
  `),
};

const subgraphWithObjectLevelDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) on OBJECT | FIELD_DEFINITION

    type Query {
      product: Product
    }

    type Product @myDirective(reason: "cached") {
      id: ID!
    }
  `),
};

const subgraphWithoutComposedDirective: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      user: User
    }

    type User {
      id: ID!
    }
  `),
};

const subgraphAWithSharedDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@sharedDirective")

    directive @sharedDirective on FIELD_DEFINITION

    type Query {
      product: Product
    }

    type Product @shareable {
      id: ID! @sharedDirective
    }
  `),
};

const subgraphBWithSharedDirective: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@sharedDirective")

    directive @sharedDirective on FIELD_DEFINITION

    type Query {
      user: User
    }

    type Product @shareable {
      id: ID!
    }

    type User {
      id: ID! @sharedDirective
    }
  `),
};

const subgraphWithRepeatableDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@tag2")

    directive @tag2(name: String!) repeatable on OBJECT | FIELD_DEFINITION

    type Query {
      product: Product
    }

    type Product {
      id: ID! @tag2(name: "one") @tag2(name: "two")
    }
  `),
};

const subgraphMissingAtPrefix: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "myDirective")

    directive @myDirective on FIELD_DEFINITION

    type Query {
      dummy: String
    }
  `),
};

const subgraphUndefinedDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@notDefined")

    type Query {
      dummy: String
    }
  `),
};

const subgraphBuiltInDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@key")

    type Query {
      dummy: String
    }
  `),
};

const subgraphWithRepeatedComposeDirective: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema
      @composeDirective(name: "@myDirective")
      @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) on FIELD_DEFINITION

    type Query {
      dummy: String @myDirective(reason: "test")
    }
  `),
};

// subgraph-a declares @myDirective as repeatable; subgraph-b does not
const subgraphRepeatableA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) repeatable on FIELD_DEFINITION

    type Query {
      product: Product
    }

    type Product @shareable {
      id: ID! @myDirective(reason: "a") @myDirective(reason: "b")
    }
  `),
};

const subgraphRepeatableB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) on FIELD_DEFINITION

    type Query {
      user: User
    }

    type Product @shareable {
      id: ID!
    }

    type User {
      id: ID!
    }
  `),
};

// subgraph-a declares @myDirective on FIELD_DEFINITION; subgraph-b declares it on OBJECT only — disjoint
const subgraphDirectiveOnFieldDefinition: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) on FIELD_DEFINITION

    type Query {
      product: Product
    }

    type Product @shareable {
      id: ID! @myDirective(reason: "a")
    }
  `),
};

const subgraphDirectiveOnObject: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    extend schema @composeDirective(name: "@myDirective")

    directive @myDirective(reason: String!) on OBJECT

    type Query {
      user: User
    }

    type Product @shareable {
      id: ID!
    }

    type User {
      id: ID!
    }
  `),
};
