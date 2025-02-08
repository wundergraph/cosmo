import { describe, expect, test } from 'vitest';
import {
  allExternalFieldInstancesError,
  EXTERNAL,
  externalInterfaceFieldsError,
  externalInterfaceFieldsWarning,
  federateSubgraphs,
  invalidDirectiveError,
  invalidExternalDirectiveError,
  invalidExternalFieldWarning,
  invalidRepeatedDirectiveErrorMessage,
  NOT_APPLICABLE,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  parse,
  requiresDefinedOnNonEntityFieldWarning,
  Subgraph,
  FIRST_ORDINAL,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  NormalizationResultSuccess,
  FederationResultSuccess,
  NormalizationResultFailure,
  FederationResultFailure,
} from '../../src';
import { baseDirectiveDefinitions, versionOneRouterDefinitions, versionTwoRouterDefinitions } from './utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../utils/utils';

describe('@external directive tests', () => {
  describe('Normalization tests', () => {
    // TODO external validation  (fieldset)
    test('that @external declared on the object level applies to its defined fields #1.1', () => {
      const result = normalizeSubgraphFromString(
        `
        type Object {
          externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
          nonExternalFieldOne: Boolean!
        }
        
        extend type Object @external {
          externalFieldTwo: Int!
          externalFieldThree: Float
        }
        
        extend type Object {
          """
            This is the description for Object.nonExternalFieldFour
          """
          nonExternalFieldFour: String!
        }
        
        extend type Object {
          nonExternalFieldTwo(argOne: Int, """This is a description for Object.nonExternalFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonExternalFieldThree: Boolean
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Object {
              externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
              externalFieldThree: Float @external
              externalFieldTwo: Int! @external
              """
              This is the description for Object.nonExternalFieldFour
              """
              nonExternalFieldFour: String!
              nonExternalFieldOne: Boolean!
              nonExternalFieldThree: Boolean
              nonExternalFieldTwo(argOne: Int"""This is a description for Object.nonExternalFieldTwo.argTwo"""argTwo: Boolean!): Float!
            }

            scalar openfed__FieldSet
          `,
        ),
      );
    });

    test('that @external declared on the object level applies to all its defined fields #1.2', () => {
      const result = normalizeSubgraphFromString(
        `
        extend type Object {
          """
           This is the description for Object.nonExternalFieldFour
          """
          nonExternalFieldFour: String!
        }
        
        extend type Object {
          nonExternalFieldTwo(argOne: Int, """This is a description for Object.nonExternalFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonExternalFieldThree: Boolean
        }
        
        extend type Object @external {
          externalFieldTwo: Int!
          externalFieldThree: Float
        }
        
        type Object {
          externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
          nonExternalFieldOne: Boolean!
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Object {
              externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
              externalFieldThree: Float @external
              externalFieldTwo: Int! @external
              """
              This is the description for Object.nonExternalFieldFour
              """
              nonExternalFieldFour: String!
              nonExternalFieldOne: Boolean!
              nonExternalFieldThree: Boolean
              nonExternalFieldTwo(argOne: Int"""This is a description for Object.nonExternalFieldTwo.argTwo"""argTwo: Boolean!): Float!
            }

            scalar openfed__FieldSet
          `,
        ),
      );
    });

    test('that @external declared on both the parent and field level is not repeated', () => {
      const result = normalizeSubgraph(
        subgraphF.definitions,
        subgraphF.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Entity @key(fields: "id") {
              field: String! @external
              id: ID! @external
            }

            scalar openfed__FieldSet
          `,
        ),
      );
    });

    test('that an error is returned if @external is repeated on the same level', () => {
      const result = normalizeSubgraph(
        subgraphG.definitions,
        subgraphG.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors).toStrictEqual([
        invalidDirectiveError(EXTERNAL, 'Entity.field', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(EXTERNAL),
        ]),
      ]);
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const result = normalizeSubgraph(
        parse(`
          type Query @shareable {
            dummy: String!
          }

          interface Interface {
            name: String! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['name']));
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const result = normalizeSubgraph(
        parse(`
          type Query @shareable {
            dummy: String!
          }

          interface Interface {
            id: ID!
          }

          extend interface Interface {
            age: Int! @external
            name: String! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['age', 'name']));
    });

    test('that a warning is returned if a V1 interface fields are declared @external', () => {
      const result = normalizeSubgraph(
        parse(`
          interface Interface {
            age: Int! @external
            id: ID!
            name: String! @external
          }`),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toStrictEqual(
        externalInterfaceFieldsWarning(NOT_APPLICABLE, 'Interface', ['age', 'name']),
      );
      expect(result.warnings![0].subgraph.name).toBe(NOT_APPLICABLE);
    });

    test('that a warning is returned if a V1 interface extension field is declared @external', () => {
      const result = normalizeSubgraph(
        parse(`
          interface Interface {
            name: String!
          }

          extend interface Interface {
            age: Int! @external
            id: ID! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toStrictEqual(
        externalInterfaceFieldsWarning(NOT_APPLICABLE, 'Interface', ['age', 'id']),
      );
      expect(result.warnings![0].subgraph.name).toBe(NOT_APPLICABLE);
    });

    test('that an error is returned for an invalid V2 @external directive', () => {
      const result = normalizeSubgraph(
        parse(`
          type Object {
            name: String! @shareable
            age: Int! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(invalidExternalDirectiveError(`Object.age`));
    });

    test('that V2 @external is valid on a Field to satisfy an Interface #1', () => {
      const result = normalizeSubgraph(
        parse(`
          interface Interface {
            age: Int!
          }
          
          type Object implements Interface {
            name: String! @shareable
            age: Int! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
    });

    test('that V2 @external is valid on a Field to satisfy an Interface #2', () => {
      const result = normalizeSubgraph(
        parse(`
          interface Interface {
            age: Int!
          }

          type Object {
            name: String! @shareable
            nested: Nested!
          }

          type Nested implements Interface {
            age: Int! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
    });

    test('that an error is returned if a V2 @external directive is invalid', () => {
      const result = normalizeSubgraph(
        parse(`
          interface Interface {
            nested: Nested!
          }
          
          type Object implements Interface {
            name: String! @shareable
            nested: Nested!
          }
          
          type Nested {
            age: Int! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(invalidExternalDirectiveError(`Nested.age`));
    });

    test('that a warning is returned if a V1 @external directive is unused', () => {
      const result = normalizeSubgraph(
        parse(`
          interface Interface {
            nested: Nested!
          }
          
          type Object implements Interface {
            name: String!
            nested: Nested!
          }
          
          type Nested {
            age: Int! @external
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(invalidExternalFieldWarning(`Nested.age`, NOT_APPLICABLE));
    });

    test('that V2 @external is valid on a Field that forms part of a @key FieldSet #1', () => {
      const result = normalizeSubgraph(
        parse(`
          type NestedOne {
            nestedTwo: NestedTwo! @external
          }

          type NestedTwo {
            field: Int!
          }

          type Entity @key(fields: "nestedOne { nestedTwo { field } }") {
            name: String! @shareable
            nestedOne: NestedOne!
          }

          type Query {
            entity: Entity!
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @key FieldSet #2', () => {
      const result = normalizeSubgraph(
        parse(`
          type NestedOne {
            nestedTwo: NestedTwo!
          }

          type NestedTwo {
            field: Int! @external
          }

          type Entity @key(fields: "nestedOne { nestedTwo { field } }") {
            name: String! @shareable
            nestedOne: NestedOne!
          }

          type Query {
            entity: Entity!
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @key FieldSet #3', () => {
      const result = normalizeSubgraph(
        parse(`
          type NestedOne {
            nestedTwo: NestedTwo! @external
          }

          type NestedTwo {
            field: Int! @external
          }

          type Entity @key(fields: "nestedOne { nestedTwo { field } }") {
            name: String! @shareable
            nestedOne: NestedOne!
          }

          type Query {
            entity: Entity!
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(true);
    });

    test('that V2 @external is valid on a Field that forms part of a @provides FieldSet #1', () => {
      const result = normalizeSubgraph(
        parse(`
          type NestedOne {
            nestedTwo: NestedTwo! @external
          }
          
          type NestedTwo {
            field: Int!
          }
          
          type Object {
            name: String! @shareable
            nestedOne: NestedOne!
          }
          
          type Query {
            object: Object! @provides(fields: "nestedOne { nestedTwo { field } }")
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @provides FieldSet #2', () => {
      const result = normalizeSubgraph(
        parse(`
          type NestedOne {
            nestedTwo: NestedTwo!
          }
          
          type NestedTwo {
            field: Int! @external
          }
          
          type Object {
            name: String! @shareable
            nestedOne: NestedOne!
          }
          
          type Query {
            object: Object! @provides(fields: "nestedOne { nestedTwo { field } }")
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @provides FieldSet #3', () => {
      const result = normalizeSubgraph(
        parse(`
          type NestedOne {
            nestedTwo: NestedTwo! @external
          }
          
          type NestedTwo {
            field: Int! @external
          }
          
          type Object {
            name: String! @shareable
            nestedOne: NestedOne!
          }
          
          type Query {
            object: Object! @provides(fields: "nestedOne { nestedTwo { field } }")
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
    });

    test('that V2 @external is valid on a Field that forms part of a @requires FieldSet #1', () => {
      const result = normalizeSubgraph(
        parse(`
          type Entity @key(fields: "id") {
            id: ID!
            name: String! @shareable @requires(fields: "nestedOne { nestedTwo { field } }")
            nestedOne: NestedOne!
          }
          
          type NestedOne {
            nestedTwo: NestedTwo! @external
          }
          
          type NestedTwo {
            field: Int!
          }
          
          type Query {
            entity: Entity!
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('that @external is valid on a Field that forms part of a @requires FieldSet #2', () => {
      const result = normalizeSubgraph(
        parse(`
          type Entity @key(fields: "id") {
            id: ID!
            name: String!
            nestedOne: NestedOne!
          }
          
          type NestedOne {
            field: Int! @shareable @requires(fields: "nestedTwo { field }")
            nestedTwo: NestedTwo!
          }
          
          type NestedTwo {
            field: Int! @external
          }
          
          type Query {
            entity: Entity!
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        requiresDefinedOnNonEntityFieldWarning('NestedOne.field', NOT_APPLICABLE),
      );
    });

    test('that @external is valid on a Field that forms part of a @requires FieldSet #3', () => {
      const result = normalizeSubgraph(
        parse(`
          type Entity @key(fields: "id") {
            id: ID!
            name: String! @shareable @requires(fields: "nestedOne { nestedTwo { field } }")
            nestedOne: NestedOne!
          }
          
          type NestedOne {
            nestedTwo: NestedTwo! @external
          }
          
          type NestedTwo {
            field: Int! @external
          }
          
          type Query {
            entity: Entity!
          }
        `),
        '',
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Federation tests', () => {
    test('that @external does not contribute to shareability checks #1.1', () => {
      const result = federateSubgraphs(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #1.2', () => {
      const result = federateSubgraphs(
        [subgraphB, subgraphA],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.1', () => {
      const result = federateSubgraphs(
        [subgraphA, subgraphB, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.2', () => {
      const result = federateSubgraphs(
        [subgraphA, subgraphC, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.3', () => {
      const result = federateSubgraphs(
        [subgraphB, subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.4', () => {
      const result = federateSubgraphs(
        [subgraphB, subgraphC, subgraphA],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.5', () => {
      const result = federateSubgraphs(
        [subgraphC, subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.6', () => {
      const result = federateSubgraphs(
        [subgraphC, subgraphB, subgraphA],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #3.1', () => {
      const result = federateSubgraphs(
        [subgraphD, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              field: String!
              id: ID!
            }

            type Query {
              anotherField: Entity!
              field: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #3.2', () => {
      const result = federateSubgraphs(
        [subgraphE, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              field: String!
              id: ID!
            }

            type Query {
              anotherField: Entity!
              field: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that an error is returned if all instances of a field are declared @external #1', () => {
      const result = federateSubgraphs(
        [subgraphH, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        allExternalFieldInstancesError(
          'Entity',
          new Map<string, Array<string>>([['name', ['subgraph-h', 'subgraph-i']]]),
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #1', () => {
      const result = federateSubgraphs(
        [subgraphJ, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #2.1', () => {
      const result = federateSubgraphs(
        [subgraphL, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #2.2', () => {
      const result = federateSubgraphs(
        [subgraphM, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
      entityTwo: EntityTwo!
    }
    
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      isEntity: Boolean!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external @shareable
      field: String!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      field: String!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      isEntity: Boolean!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      field: Entity!
    }
    
    type Entity @extends @key(fields: "id") {
      id: ID!
      field: String! @external
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query @shareable {
      anotherField: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      field: String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @external {
      id: ID!
      field: String! @external
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      field: String! @external @external
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String! @external
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @extends @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID! @external
      name: String! @external
    }
  `),
};
