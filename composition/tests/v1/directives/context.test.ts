import { describe, expect, it } from 'vitest';
import {
  createSubgraph,
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { contextArgumentRequiredError, ROUTER_COMPATIBILITY_VERSION_ONE } from '../../../src';
import {
  CONTEXT_DIRECTIVE,
  CONTEXT_FIELD_VALUE_SCALAR,
  FROM_CONTEXT_DIRECTIVE,
  KEY_DIRECTIVE,
  OPENFED_FIELD_SET,
  SCHEMA_QUERY_DEFINITION,
} from '../utils/utils';

const subgraphWithContextOnObject = createSubgraph(
  'subgraph-context-object',
  `
    type Query {
      user: User!
    }

    type User @context(name: "userContext") {
      id: ID!
      name: String!
    }
  `,
);

const subgraphWithContextOnInterface = createSubgraph(
  'subgraph-context-interface',
  `
    type Query {
      node: Node!
    }

    interface Node @context(name: "nodeContext") {
      id: ID!
    }

    type User implements Node {
      id: ID!
      name: String!
    }
  `,
);

const subgraphWithContextOnUnion = createSubgraph(
  'subgraph-context-union',
  `
    type Query {
      account: Account!
    }

    union Account @context(name: "accountContext") = User | Organisation

    type User {
      id: ID!
    }

    type Organisation {
      id: ID!
    }
  `,
);

const subgraphWithRepeatedContextOnObject = createSubgraph(
  'subgraph-context-repeated',
  `
    type Query {
      user: User!
    }

    type User @context(name: "userContext") @context(name: "accountContext") {
      id: ID!
      name: String!
    }
  `,
);

const subgraphWithFromContextOnArgument = createSubgraph(
  'subgraph-from-context-argument',
  `
    type Query {
      user: User!
    }

    type User @context(name: "userContext") {
      id: ID!
      locale: String!
      profile: Profile!
    }

    type Profile {
      greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
    }
  `,
);

const subgraphWithFromContextOnEntity = createSubgraph(
  'subgraph-from-context-entity',
  `
    type Query {
      user: User!
    }

    type User @key(fields: "id") @context(name: "userContext") {
      id: ID!
      locale: String!
      profile: Profile!
    }

    type Profile @key(fields: "id") {
      id: ID!
      greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
    }
  `,
);

const subgraphWithManuallyDefinedContextFieldValue = createSubgraph(
  'subgraph-manual-context-field-value',
  `
    scalar ContextFieldValue

    type Query {
      user: User!
    }

    type User @context(name: "userContext") {
      id: ID!
      locale: String!
      profile: Profile!
    }

    type Profile {
      greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
    }
  `,
);

const subgraphWithTypeConditionedFromContext = createSubgraph(
  'subgraph-from-context-type-condition',
  `
    type Query {
      account: Account!
    }

    union Account @context(name: "accountContext") = User | Organisation

    type User {
      id: ID!
      locale: String!
      profile: Profile!
    }

    type Organisation {
      id: ID!
      defaultLocale: String!
      profile: Profile!
    }

    type Profile {
      greeting(
        locale: String
          @fromContext(field: "$accountContext ... on User { locale } ... on Organisation { defaultLocale }")
      ): String!
    }
  `,
);

const subgraphWithContextOnTypeExtension = createSubgraph(
  'subgraph-context-type-extension',
  `
    type Query {
      user: User!
    }

    type User @key(fields: "id") {
      id: ID!
    }

    extend type User @context(name: "userContext") {
      locale: String!
    }
  `,
);

const subgraphWithMultipleContextArguments = createSubgraph(
  'subgraph-multiple-context-arguments',
  `
    type Query {
      user: User!
    }

    type User @context(name: "userContext") {
      id: ID!
      locale: String!
      tier: String!
      profile: Profile!
    }

    type Profile {
      greeting(
        locale: String @fromContext(field: "$userContext { locale }")
        tier: String @fromContext(field: "$userContext { tier }")
      ): String!
    }
  `,
);

const subgraphWithContextArgument = createSubgraph(
  'subgraph-context-argument',
  `
    type Query {
      member(id: ID!): Member
    }

    type Member @key(fields: "id") @context(name: "memberContext") {
      id: ID!
      plan: String!
    }

    type Wallet @key(fields: "id") @shareable {
      id: ID!
      apply(plan: String @fromContext(field: "$memberContext { plan }")): Int!
    }
  `,
);

const subgraphWithNullableArgument = createSubgraph(
  'subgraph-nullable-argument',
  `
    type Query {
      noop: Int
    }

    type Wallet @key(fields: "id") @shareable {
      id: ID!
      apply(plan: String): Int!
    }
  `,
);

const subgraphWithRequiredArgument = createSubgraph(
  'subgraph-required-argument',
  `
    type Query {
      noop: Int
    }

    type Wallet @key(fields: "id") @shareable {
      id: ID!
      apply(plan: String!): Int!
    }
  `,
);

const SCHEMA_WITHOUT_CONTEXT_ARGUMENT = normalizeString(
  SCHEMA_QUERY_DEFINITION +
    `
    type Profile {
      greeting: String!
    }

    type Query {
      user: User!
    }

    type User {
      id: ID!
      locale: String!
      profile: Profile!
    }
  `,
);

describe('@context and @fromContext directives', () => {
  describe('normalisation', () => {
    it('preserves @context on an interface type', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithContextOnInterface, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            `
            interface Node @context(name: "nodeContext") {
              id: ID!
            }

            type Query {
              node: Node!
            }

            type User implements Node {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    it('preserves @context on a union type', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithContextOnUnion, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            `
            union Account @context(name: "accountContext") = Organisation | User

            type Organisation {
              id: ID!
            }

            type Query {
              account: Account!
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    it('preserves multiple @context declarations on the same type', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraphWithRepeatedContextOnObject,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            `
            type Query {
              user: User!
            }

            type User @context(name: "userContext") @context(name: "accountContext") {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    it('preserves a @fromContext selection with type conditions', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraphWithTypeConditionedFromContext,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            FROM_CONTEXT_DIRECTIVE +
            `
            union Account @context(name: "accountContext") = Organisation | User
          ` +
            CONTEXT_FIELD_VALUE_SCALAR +
            `
            type Organisation {
              defaultLocale: String!
              id: ID!
              profile: Profile!
            }

            type Profile {
              greeting(locale: String @fromContext(field: "$accountContext ... on User { locale } ... on Organisation { defaultLocale }")): String!
            }

            type Query {
              account: Account!
            }

            type User {
              id: ID!
              locale: String!
              profile: Profile!
            }
          `,
        ),
      );
    });

    it('preserves @context declared on a type extension', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithContextOnTypeExtension, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            KEY_DIRECTIVE +
            `
            type Query {
              user: User!
            }

            type User @key(fields: "id") @context(name: "userContext") {
              id: ID!
              locale: String!
            }
          ` +
            OPENFED_FIELD_SET,
        ),
      );
    });

    it('preserves multiple context arguments on the same field', () => {
      const { schema } = normalizeSubgraphSuccess(
        subgraphWithMultipleContextArguments,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            FROM_CONTEXT_DIRECTIVE +
            CONTEXT_FIELD_VALUE_SCALAR +
            `
            type Profile {
              greeting(locale: String @fromContext(field: "$userContext { locale }"), tier: String @fromContext(field: "$userContext { tier }")): String!
            }

            type Query {
              user: User!
            }

            type User @context(name: "userContext") {
              id: ID!
              locale: String!
              profile: Profile!
              tier: String!
            }
          `,
        ),
      );
    });

    it('preserves @context and @fromContext alongside @key on entities', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithFromContextOnEntity, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            CONTEXT_DIRECTIVE +
            FROM_CONTEXT_DIRECTIVE +
            KEY_DIRECTIVE +
            CONTEXT_FIELD_VALUE_SCALAR +
            `
            type Profile @key(fields: "id") {
              greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
              id: ID!
            }

            type Query {
              user: User!
            }

            type User @key(fields: "id") @context(name: "userContext") {
              id: ID!
              locale: String!
              profile: Profile!
            }
          ` +
            OPENFED_FIELD_SET,
        ),
      );
    });
  });

  describe('federation', () => {
    it('strips @context from federated graphs', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithContextOnObject],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              user: User!
            }

            type User {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    it('strips @context from interface types in federated graphs', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithContextOnInterface],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            interface Node {
              id: ID!
            }

            type Query {
              node: Node!
            }

            type User implements Node {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    it('strips @context from union types in federated graphs', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithContextOnUnion],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            union Account = Organisation | User

            type Organisation {
              id: ID!
            }

            type Query {
              account: Account!
            }

            type User {
              id: ID!
            }
          `,
        ),
      );
    });

    it('strips context arguments from federated graphs', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithFromContextOnArgument],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(SCHEMA_WITHOUT_CONTEXT_ARGUMENT);
    });

    it('strips @context and @fromContext from entities in federated graphs', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithFromContextOnEntity],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Profile {
              greeting: String!
              id: ID!
            }

            type Query {
              user: User!
            }

            type User {
              id: ID!
              locale: String!
              profile: Profile!
            }
          `,
        ),
      );
    });

    it('strips an argument that only one subgraph declares as a context argument', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithContextArgument, subgraphWithNullableArgument],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const expected = normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type Member {
            id: ID!
            plan: String!
          }

          type Query {
            member(id: ID!): Member
            noop: Int
          }

          type Wallet {
            apply: Int!
            id: ID!
          }
        `,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(expected);
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(expected);
    });

    it('strips a context argument regardless of the subgraph order', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithNullableArgument, subgraphWithContextArgument],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Member {
              id: ID!
              plan: String!
            }

            type Query {
              member(id: ID!): Member
              noop: Int
            }

            type Wallet {
              apply: Int!
              id: ID!
            }
          `,
        ),
      );
    });

    it('returns an error if an argument takes a context in one subgraph and is required in another', () => {
      const { errors } = federateSubgraphsFailure(
        [subgraphWithContextArgument, subgraphWithRequiredArgument],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        contextArgumentRequiredError(
          'Wallet.apply(plan: ...)',
          ['subgraph-context-argument'],
          ['subgraph-required-argument'],
        ),
      );
    });

    it('strips a manually defined ContextFieldValue scalar from federated graphs', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithManuallyDefinedContextFieldValue],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(SCHEMA_WITHOUT_CONTEXT_ARGUMENT);
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(SCHEMA_WITHOUT_CONTEXT_ARGUMENT);
    });

    it('excludes context arguments from client schemas', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithFromContextOnArgument],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(SCHEMA_WITHOUT_CONTEXT_ARGUMENT);
    });
  });
});
