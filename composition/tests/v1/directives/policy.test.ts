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
});
