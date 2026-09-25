import { describe, expect, test } from 'vitest';
import {
  createSubgraph,
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  requiredContextArgumentError,
  type ImplementationErrors,
  type InvalidFieldImplementation,
  invalidInterfaceImplementationError,
  OBJECT,
  ROUTER_COMPATIBILITY_VERSION_ONE,
} from '../../../src';
import {
  CONTEXT_DIRECTIVE,
  CONTEXT_FIELD_VALUE_SCALAR,
  FROM_CONTEXT_DIRECTIVE,
  KEY_DIRECTIVE,
  OPENFED_FIELD_SET,
  SCHEMA_QUERY_DEFINITION,
} from '../utils/utils';

describe('@context and @fromContext directives', () => {
  describe('normalization', () => {
    test('preserves @context on an interface type', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

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
        `),
      );
    });

    test('preserves @context on a union type', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

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
        `),
      );
    });

    test('preserves multiple @context declarations on the same type', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

          type Query {
            user: User!
          }

          type User @context(name: "userContext") @context(name: "accountContext") {
            id: ID!
            name: String!
          }
        `),
      );
    });

    test('preserves a @fromContext selection with type conditions', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

          ${FROM_CONTEXT_DIRECTIVE}

          union Account @context(name: "accountContext") = Organisation | User

          ${CONTEXT_FIELD_VALUE_SCALAR}

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
        `),
      );
    });

    test('preserves @context declared on a type extension', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

          ${KEY_DIRECTIVE}

          type Query {
            user: User!
          }

          type User @key(fields: "id") @context(name: "userContext") {
            id: ID!
            locale: String!
          }

          ${OPENFED_FIELD_SET}
        `),
      );
    });

    test('preserves multiple context arguments on the same field', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

          ${FROM_CONTEXT_DIRECTIVE}

          ${CONTEXT_FIELD_VALUE_SCALAR}

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
        `),
      );
    });

    test('preserves @context and @fromContext alongside @key on entities', () => {
      const subgraph = createSubgraph(
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
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CONTEXT_DIRECTIVE}

          ${FROM_CONTEXT_DIRECTIVE}

          ${KEY_DIRECTIVE}

          ${CONTEXT_FIELD_VALUE_SCALAR}

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

          ${OPENFED_FIELD_SET}
        `),
      );
    });
  });

  describe('federation', () => {
    test('strips @context from federated graphs', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphSchema } = federateSubgraphsSuccess([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          type Query {
            user: User!
          }

          type User {
            id: ID!
            name: String!
          }
        `),
      );
    });

    test('strips @context from interface types in federated graphs', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphSchema } = federateSubgraphsSuccess([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

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
        `),
      );
    });

    test('strips @context from union types in federated graphs', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphSchema } = federateSubgraphsSuccess([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

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
        `),
      );
    });

    test('strips context arguments from federated graphs', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphSchema } = federateSubgraphsSuccess([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

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
        `),
      );
    });

    test('strips @context and @fromContext from entities in federated graphs', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphSchema } = federateSubgraphsSuccess([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

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
        `),
      );
    });

    test('strips an argument that only one subgraph declares as a context argument', () => {
      const subgraphA = createSubgraph(
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
      const subgraphB = createSubgraph(
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
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const expectedSchema = normalizeString(`
        ${SCHEMA_QUERY_DEFINITION}

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
      `);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(expectedSchema);
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(expectedSchema);
    });

    test('strips a context argument regardless of the subgraph order', () => {
      const subgraphA = createSubgraph(
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
      const subgraphB = createSubgraph(
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
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

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
        `),
      );
    });

    test('returns an error if an argument takes a context in one subgraph and is required in another', () => {
      const subgraphA = createSubgraph(
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
      const subgraphB = createSubgraph(
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
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        requiredContextArgumentError(
          'Wallet.apply(plan: ...)',
          ['subgraph-context-argument'],
          ['subgraph-required-argument'],
        ),
      );
    });

    test('returns an error if a context argument is declared on both an interface field and its implementation', () => {
      const subgraph = createSubgraph(
        'subgraph-context-interface-implementation',
        `
          type Query {
            user: User!
            profile: Profile!
          }

          type User @context(name: "userContext") {
            id: ID!
            locale: String!
          }

          interface Node {
            greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
          }

          type Profile implements Node {
            greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Profile',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Node',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'greeting',
                    {
                      implementationContextCoords: new Set<string>(['Profile.greeting(locale: ...)']),
                      interfaceContextCoords: new Set<string>(['Node.greeting(locale: ...)']),
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });

    test('returns an error if an argument is a context argument on an implementation but not on the interface', () => {
      const subgraph = createSubgraph(
        'subgraph-context-implementation-only',
        `
          type Query {
            user: User!
            profile: Profile!
          }

          type User @context(name: "userContext") {
            id: ID!
            locale: String!
          }

          interface Node {
            greeting(locale: String): String!
          }

          type Profile implements Node {
            greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Profile',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Node',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'greeting',
                    {
                      implementationContextCoords: new Set<string>(['Profile.greeting(locale: ...)']),
                      interfaceContextCoords: new Set<string>(),
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });

    test('returns an error if an argument is a context argument on an interface but not on the implementation', () => {
      const subgraph = createSubgraph(
        'subgraph-context-interface-only',
        `
          type Query {
            user: User!
            profile: Profile!
          }

          type User @context(name: "userContext") {
            id: ID!
            locale: String!
          }

          interface Node {
            greeting(locale: String @fromContext(field: "$userContext { locale }")): String!
          }

          type Profile implements Node {
            greeting(locale: String): String!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Profile',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Node',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'greeting',
                    {
                      implementationContextCoords: new Set<string>(),
                      interfaceContextCoords: new Set<string>(['Node.greeting(locale: ...)']),
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });

    test('returns an error for each sibling Interface if only the implementation declares a context argument', () => {
      const subgraph = createSubgraph(
        'subgraph-context-argument-sibling-interfaces',
        `
          type Query {
            object: Object!
          }

          interface InterfaceA {
            a(a: ID): ID
          }

          interface InterfaceB {
            a(a: ID): ID
          }

          type Entity @key(fields: "id") @context(name: "entity") {
            id: ID!
          }

          type Object implements InterfaceA & InterfaceB @key(fields: "id") {
            id: ID!
            a(a: ID @fromContext(field: "$entity { id }")): ID
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
          [
            'a',
            {
              implementationContextCoords: new Set<string>(['Object.a(a: ...)']),
              interfaceContextCoords: new Set<string>(),
              invalidAdditionalArguments: new Set<string>(),
              invalidImplementedArguments: [],
              isInaccessible: false,
              originalResponseType: 'ID',
              unimplementedArguments: new Set<string>(),
            },
          ],
        ]),
        unimplementedFields: [],
      };
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Object',
          OBJECT,
          new Map<string, ImplementationErrors>([
            ['InterfaceA', implementationErrors],
            ['InterfaceB', implementationErrors],
          ]),
        ),
      );
    });

    test('returns an error for each Interface in a hierarchy if only the implementation declares a context argument', () => {
      const subgraph = createSubgraph(
        'subgraph-context-argument-interface-hierarchy',
        `
          type Query {
            object: Object!
          }

          interface InterfaceA {
            a(a: ID): ID
          }

          interface InterfaceB implements InterfaceA {
            a(a: ID): ID
          }

          type Entity @key(fields: "id") @context(name: "entity") {
            id: ID!
          }

          type Object implements InterfaceA & InterfaceB @key(fields: "id") {
            id: ID!
            a(a: ID @fromContext(field: "$entity { id }")): ID
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
          [
            'a',
            {
              implementationContextCoords: new Set<string>(['Object.a(a: ...)']),
              interfaceContextCoords: new Set<string>(),
              invalidAdditionalArguments: new Set<string>(),
              invalidImplementedArguments: [],
              isInaccessible: false,
              originalResponseType: 'ID',
              unimplementedArguments: new Set<string>(),
            },
          ],
        ]),
        unimplementedFields: [],
      };
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Object',
          OBJECT,
          new Map<string, ImplementationErrors>([
            ['InterfaceA', implementationErrors],
            ['InterfaceB', implementationErrors],
          ]),
        ),
      );
    });

    test('returns an error if an argument is required in the subgraph that declares it a context argument', () => {
      const subgraph = createSubgraph(
        'subgraph-required-context-argument',
        `
          type Query {
            member(id: ID!): Member
          }

          type Member @key(fields: "id") @context(name: "memberContext") {
            id: ID!
            plan: String!
          }

          type Wallet @key(fields: "id") {
            id: ID!
            apply(plan: String! @fromContext(field: "$memberContext { plan }")): Int!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        requiredContextArgumentError(
          'Wallet.apply(plan: ...)',
          ['subgraph-required-context-argument'],
          ['subgraph-required-context-argument'],
        ),
      );
    });

    test('strips a manually defined ContextFieldValue scalar from federated graphs', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraph],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const expectedSchema = normalizeString(`
        ${SCHEMA_QUERY_DEFINITION}

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
      `);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(expectedSchema);
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(expectedSchema);
    });

    test('excludes context arguments from client schemas', () => {
      const subgraph = createSubgraph(
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
      const { federatedGraphClientSchema } = federateSubgraphsSuccess([subgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

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
        `),
      );
    });
  });
});
