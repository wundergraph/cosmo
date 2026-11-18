import { describe, expect, test } from 'vitest';
import {
  FEDERATION_POLICY,
  FIRST_ORDINAL,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  POLICIES,
  POLICY,
  policyOnExternalFieldErrorMessage,
  policyOnInterfaceErrorMessage,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  unsupportedDirectiveWarning,
} from '../../../src';
import {
  createSubgraph,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  FEDERATION_POLICY_SCALAR,
  INTERFACE_OBJECT_DIRECTIVE,
  KEY_DIRECTIVE,
  OPENFED_FIELD_SET,
  OPENFED_SCOPE,
  POLICY_DIRECTIVE,
  REQUIRES_SCOPES_DIRECTIVE,
  SCHEMA_QUERY_DEFINITION,
} from '../utils/utils';

describe('@policy directive tests', () => {
  describe('Normalization tests', () => {
    test('that defining @policy produces an unsupported directive warning', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            a: ID @policy(policies: [["p"]])
          }
        `,
      );
      const { schema, warnings } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(warnings).toStrictEqual([unsupportedDirectiveWarning({ directiveName: POLICY, subgraphName: 'a' })]);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is preserved on a field', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            a: ID @policy(policies: [["p1", "p2"], ["p3"]])
          }
        `,
      );
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p1", "p2"], ["p3"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is preserved on an object', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            u: User
          }

          type User @policy(policies: [["user"]]) {
            id: ID
          }
        `,
      );
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            u: User
          }

          type User @policy(policies: [["user"]]) {
            id: ID
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is preserved on a scalar', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            s: S
          }

          scalar S @policy(policies: [["scalar"]])
        `,
      );
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            s: S
          }

          scalar S @policy(policies: [["scalar"]])

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is preserved on an enum', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            e: E
          }

          enum E @policy(policies: [["enum"]]) {
            A
          }
        `,
      );
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          enum E @policy(policies: [["enum"]]) {
            A
          }

          type Query {
            e: E
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that a manually defined federation__Policy scalar is not duplicated', () => {
      const subgraph = createSubgraph(
        'a',
        `
          scalar federation__Policy

          type Query {
            a: ID @policy(policies: [["p"]])
          }
        `,
      );
      const { schema } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that an error is returned if @policy is defined on an interface', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          interface Node @policy(policies: [["p"]]) {
            id: ID
          }

          type User implements Node {
            id: ID
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'Node', FIRST_ORDINAL, [policyOnInterfaceErrorMessage()]),
      ]);
    });

    test('that an error is returned if @policy is defined on an interface field', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          interface Node {
            id: ID @policy(policies: [["p"]])
          }

          type User implements Node {
            id: ID
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'Node.id', FIRST_ORDINAL, [policyOnInterfaceErrorMessage()]),
      ]);
    });

    test('that an error is returned if @policy is defined on an interface extension field', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          interface Node {
            id: ID
          }

          extend interface Node {
            name: String @policy(policies: [["p"]])
          }

          type User implements Node {
            id: ID
            name: String
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'Node.name', FIRST_ORDINAL, [policyOnInterfaceErrorMessage()]),
      ]);
    });

    test('that an error is returned if @policy is defined on an @interfaceObject type', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          type Node @key(fields: "id") @interfaceObject @policy(policies: [["p"]]) {
            id: ID!
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'Node', FIRST_ORDINAL, [policyOnInterfaceErrorMessage()]),
      ]);
    });

    test('that @policy is preserved on an @interfaceObject field', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          type Node @key(fields: "id") @interfaceObject {
            id: ID!
            secret: String @policy(policies: [["p"]])
          }
        `,
      );
      const { schema, warnings } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(warnings).toStrictEqual([unsupportedDirectiveWarning({ directiveName: POLICY, subgraphName: 'a' })]);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${INTERFACE_OBJECT_DIRECTIVE}

          ${KEY_DIRECTIVE}

          ${POLICY_DIRECTIVE}

          type Node @key(fields: "id") @interfaceObject {
            id: ID!
            secret: String @policy(policies: [["p"]])
          }

          type Query {
            node: Node
          }

          ${FEDERATION_POLICY_SCALAR}

          ${OPENFED_FIELD_SET}
        `),
      );
    });

    test('that an error is returned if @policy is defined on an @external field', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            user: User
          }

          type User @key(fields: "id") {
            id: ID!
            name: String @external @policy(policies: [["p"]])
            greeting: String @requires(fields: "name")
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'User.name', FIRST_ORDINAL, [policyOnExternalFieldErrorMessage()]),
      ]);
    });

    test('that an error is returned if @policy is defined on a field of an @external type extension', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            user: User
          }

          type User @key(fields: "id") {
            id: ID!
            greeting: String @requires(fields: "name")
          }

          extend type User @external {
            name: String @policy(policies: [["p"]])
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'User.name', FIRST_ORDINAL, [policyOnExternalFieldErrorMessage()]),
      ]);
    });

    test('that an error is returned if a policy is not a string', () => {
      const subgraph = createSubgraph(
        'a',
        `
          type Query {
            a: ID @policy(policies: [[1]])
          }
        `,
      );
      const { errors } = normalizeSubgraphFailure(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toStrictEqual([
        invalidDirectiveError(POLICY, 'Query.a', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('[[1]]', `@${POLICY}`, POLICIES, `[[${FEDERATION_POLICY}!]!]!`),
        ]),
      ]);
    });
  });

  describe('Federation tests', () => {
    test('that @policy is persisted in the router schema but not the client schema', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @policy(policies: [["p1", "p2"], ["p3"]])
            u: User
          }

          type User @policy(policies: [["user"]]) {
            id: ID
          }
        `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [a],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p1", "p2"], ["p3"]])
            u: User
          }

          type User @policy(policies: [["user"]]) {
            id: ID
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          type Query {
            a: ID
            u: User
          }

          type User {
            id: ID
          }
        `),
      );
    });

    test('that a manually defined federation__Policy scalar is not duplicated', () => {
      const a = createSubgraph(
        'a',
        `
          scalar federation__Policy

          type Query {
            a: ID @policy(policies: [["p"]])
          }
        `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [a],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          type Query {
            a: ID
          }
        `),
      );
    });

    test('that @policy on a shared field is merged by AND-ing the policies of each subgraph', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p1"], ["p2"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p3"], ["p4"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p1", "p3"], ["p1", "p4"], ["p2", "p3"], ["p2", "p4"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that redundant policies are dropped when merging', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["a"], ["b"]])
            b: ID @shareable @policy(policies: [["a"]])
            c: ID @shareable @policy(policies: [["a"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["a"]])
            b: ID @shareable @policy(policies: [["a"]])
            c: ID @shareable @policy(policies: [["a", "b"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["a"]])
            b: ID @policy(policies: [["a"]])
            c: ID @policy(policies: [["a", "b"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is kept on a shared field that only one subgraph protects', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that type-level @policy on an entity is merged and field-level @policy is kept separate', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            user: User
          }

          type User @key(fields: "id") @policy(policies: [["typeA"]]) {
            id: ID!
            name: String
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type User @key(fields: "id") @policy(policies: [["typeB"]]) {
            id: ID!
            age: Int @policy(policies: [["fieldB"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            user: User
          }

          type User @policy(policies: [["typeA", "typeB"]]) {
            age: Int @policy(policies: [["fieldB"]])
            id: ID!
            name: String
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is propagated from implementations to the interface', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          interface Node {
            id: ID
            name: String
          }

          type A implements Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
            name: String
          }

          type B implements Node @policy(policies: [["typeB"]]) {
            id: ID @policy(policies: [["fieldB"]])
            name: String @policy(policies: [["nameB"]])
          }

          type C implements Node {
            id: ID
            name: String
          }
        `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [a],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type A implements Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
            name: String
          }

          type B implements Node @policy(policies: [["typeB"]]) {
            id: ID @policy(policies: [["fieldB"]])
            name: String @policy(policies: [["nameB"]])
          }

          type C implements Node {
            id: ID
            name: String
          }

          interface Node @policy(policies: [["typeA", "typeB"]]) {
            id: ID @policy(policies: [["fieldA", "fieldB"]])
            name: String @policy(policies: [["nameB"]])
          }

          type Query {
            node: Node
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          type A implements Node {
            id: ID
            name: String
          }

          type B implements Node {
            id: ID
            name: String
          }

          type C implements Node {
            id: ID
            name: String
          }

          interface Node {
            id: ID
            name: String
          }

          type Query {
            node: Node
          }
        `),
      );
    });

    test('that @policy is propagated to an interface from an implementation in another subgraph', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          interface Node {
            id: ID
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          interface Node {
            id: ID
          }

          type A implements Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type A implements Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
          }

          interface Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
          }

          type Query {
            node: Node
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy on an @interfaceObject field is propagated to the interface and its implementations', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          type Node @key(fields: "id") @interfaceObject {
            id: ID!
            secret: String @policy(policies: [["p"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          interface Node @key(fields: "id") {
            id: ID!
          }

          type User implements Node @key(fields: "id") {
            id: ID!
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          interface Node {
            id: ID!
            secret: String @policy(policies: [["p"]])
          }

          type Query {
            node: Node
          }

          type User implements Node {
            id: ID!
            secret: String @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is not propagated from union members to the union', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            account: Account
          }

          union Account = A | B

          type A @policy(policies: [["a"]]) {
            id: ID
          }

          type B @policy(policies: [["b"]]) {
            id: ID
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type A @policy(policies: [["a"]]) {
            id: ID
          }

          union Account = A | B

          type B @policy(policies: [["b"]]) {
            id: ID
          }

          type Query {
            account: Account
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is persisted alongside @requiresScopes', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @policy(policies: [["p"]]) @requiresScopes(scopes: [["s"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          ${REQUIRES_SCOPES_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]]) @requiresScopes(scopes: [["s"]])
          }

          ${FEDERATION_POLICY_SCALAR}

          ${OPENFED_SCOPE}
        `),
      );
    });

    test('that identical applications are kept as they are rather than merged', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["b", "a"], ["b", "a", "c"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["b", "a"], ["b", "a", "c"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["b", "a"], ["b", "a", "c"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that merged policies depend on subgraph names rather than subgraph order', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p3"], ["p4"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p1"], ["p2"]])
          }
        `,
      );
      const expected = normalizeString(`
        ${SCHEMA_QUERY_DEFINITION}

        ${POLICY_DIRECTIVE}

        type Query {
          a: ID @policy(policies: [["p1", "p3"], ["p2", "p3"], ["p1", "p4"], ["p2", "p4"]])
        }

        ${FEDERATION_POLICY_SCALAR}
      `);
      const { federatedGraphSchema: abSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      const { federatedGraphSchema: baSchema } = federateSubgraphsSuccess([b, a], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(abSchema)).toBe(expected);
      expect(schemaToSortedNormalizedString(baSchema)).toBe(expected);
    });

    test('that merged policies are ordered by the number of policies each OR group requires', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["b"], ["a", "z"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["c"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["b", "c"], ["a", "c", "z"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that merged policies of the same length are ordered by code unit', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["a"], ["B"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["c"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["B", "c"], ["a", "c"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that block string policies are accepted', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @policy(policies: [["""p"""]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that empty policies are treated as no requirement when merging', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [])
            b: ID @shareable @policy(policies: [[]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p"]])
            b: ID @shareable @policy(policies: [["p"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p"]])
            b: ID @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that the policies of three subgraphs are merged', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["a"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["b"], ["c"]])
          }
        `,
      );
      const c = createSubgraph(
        'c',
        `
          type Query {
            a: ID @shareable @policy(policies: [["d"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b, c], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["a", "b", "d"], ["a", "c", "d"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy on shared enums and scalars is merged', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            e: E @shareable
            s: S @shareable
          }

          enum E @policy(policies: [["a"]]) {
            A
          }

          scalar S @policy(policies: [["a"]])
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            e: E @shareable
            s: S @shareable
          }

          enum E @policy(policies: [["b"]]) {
            A
          }

          scalar S @policy(policies: [["b"]])
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          enum E @policy(policies: [["a", "b"]]) {
            A
          }

          type Query {
            e: E
            s: S
          }

          scalar S @policy(policies: [["a", "b"]])

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy is propagated to every interface an implementation implements', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          interface Node {
            id: ID
          }

          interface Named implements Node {
            id: ID
            name: String
          }

          type A implements Node & Named @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
            name: String
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type A implements Named & Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
            name: String
          }

          interface Named implements Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
            name: String
          }

          interface Node @policy(policies: [["typeA"]]) {
            id: ID @policy(policies: [["fieldA"]])
          }

          type Query {
            node: Node
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy on an @interfaceObject field is propagated to the other interfaces of its implementations', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            node: Node
          }

          type Node @key(fields: "id") @interfaceObject {
            id: ID!
            x: Int @policy(policies: [["p"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            other: Other
          }

          interface Node @key(fields: "id") {
            id: ID!
          }

          interface Other {
            x: Int
          }

          type User implements Node & Other @key(fields: "id") {
            id: ID!
            x: Int @external
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          interface Node {
            id: ID!
            x: Int @policy(policies: [["p"]])
          }

          interface Other {
            x: Int @policy(policies: [["p"]])
          }

          type Query {
            node: Node
            other: Other
          }

          type User implements Node & Other {
            id: ID!
            x: Int @policy(policies: [["p"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that @policy on a renamed root type and its fields is merged into the federated root type', () => {
      const a = createSubgraph(
        'a',
        `
          schema {
            query: Queries
          }

          type Queries @policy(policies: [["t"]]) {
            a: ID @shareable @policy(policies: [["f1"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["f2"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query @policy(policies: [["t"]]) {
            a: ID @policy(policies: [["f1", "f2"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that merged policies are not limited in the number of OR groups', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["a1"], ["a2"], ["a3"], ["a4"], ["a5"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["b1"], ["b2"], ["b3"], ["b4"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["a1", "b1"], ["a1", "b2"], ["a1", "b3"], ["a1", "b4"], ["a2", "b1"], ["a2", "b2"], ["a2", "b3"], ["a2", "b4"], ["a3", "b1"], ["a3", "b2"], ["a3", "b3"], ["a3", "b4"], ["a4", "b1"], ["a4", "b2"], ["a4", "b3"], ["a4", "b4"], ["a5", "b1"], ["a5", "b2"], ["a5", "b3"], ["a5", "b4"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });

    test('that semantically identical policies are merged into a sorted application', () => {
      const a = createSubgraph(
        'a',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p1"], ["p2"], ["p3"], ["p4"], ["p5"]])
          }
        `,
      );
      const b = createSubgraph(
        'b',
        `
          type Query {
            a: ID @shareable @policy(policies: [["p5"], ["p4"], ["p3"], ["p2"], ["p1"]])
          }
        `,
      );
      const { federatedGraphSchema } = federateSubgraphsSuccess([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${POLICY_DIRECTIVE}

          type Query {
            a: ID @policy(policies: [["p1"], ["p2"], ["p3"], ["p4"], ["p5"]])
          }

          ${FEDERATION_POLICY_SCALAR}
        `),
      );
    });
  });
});
