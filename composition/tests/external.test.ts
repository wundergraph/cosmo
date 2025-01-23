import { describe, expect, test } from 'vitest';
import {
  allExternalFieldInstancesError,
  ConfigurationData,
  EXTERNAL,
  externalEntityExtensionKeyFieldWarning,
  externalInterfaceFieldsError,
  externalInterfaceFieldsWarning,
  federateSubgraphs,
  invalidDirectiveError,
  invalidExternalDirectiveError,
  invalidExternalFieldWarning,
  invalidRepeatedDirectiveErrorMessage,
  normalizeSubgraph,
  NOT_APPLICABLE,
  parse,
  requiresDefinedOnNonEntityFieldWarning,
  Subgraph,
} from '../src';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('@external directive tests', () => {
  describe('Normalization tests', () => {
    test('that @external declared on the Object level applies to its defined Fields #1', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Object {
              """
              This is the description for Object.externalFieldFour
              """
              externalFieldFour: String! @external
              externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
              externalFieldThree: Float @external
              externalFieldTwo: Int! @external
              nonExternalFieldOne: Boolean!
              nonExternalFieldThree: Boolean
              nonExternalFieldTwo(argOne: Int"""This is a description for Object.nonExternalFieldTwo.argTwo"""argTwo: Boolean!): Float!
            }

            scalar openfed__FieldSet
          `,
        ),
      );
      expect(warnings).toHaveLength(4);
      expect(warnings[0]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldOne', subgraphN.name));
      expect(warnings[1]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldTwo', subgraphN.name));
      expect(warnings[2]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldThree', subgraphN.name));
      expect(warnings[3]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldFour', subgraphN.name));
    });

    test('that @external declared on the Object level applies to all its defined Fields #2', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Object {
              """
              This is the description for Object.externalFieldFour
              """
              externalFieldFour: String! @external
              externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
              externalFieldThree: Float @external
              externalFieldTwo: Int! @external
              nonExternalFieldOne: Boolean!
              nonExternalFieldThree: Boolean
              nonExternalFieldTwo(argOne: Int"""This is a description for Object.nonExternalFieldTwo.argTwo"""argTwo: Boolean!): Float!
            }

            scalar openfed__FieldSet
          `,
        ),
      );
      expect(warnings).toHaveLength(4);
      expect(warnings[0]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldFour', subgraphO.name));
      expect(warnings[1]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldTwo', subgraphO.name));
      expect(warnings[2]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldThree', subgraphO.name));
      expect(warnings[3]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldOne', subgraphO.name));
    });

    test('that @external declared on both the parent and field level is not repeated', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphF.definitions);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors } = normalizeSubgraph(subgraphG.definitions);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidDirectiveError(EXTERNAL, 'Entity.field', [
          invalidRepeatedDirectiveErrorMessage(EXTERNAL, 'Entity.field'),
        ]),
      ]);
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const { errors } = normalizeSubgraph(
        parse(`
          type Query @shareable {
            dummy: String!
          }

          interface Interface {
            name: String! @external
          }
        `),
      );
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['name']));
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['age', 'name']));
    });

    test('that a warning is returned if a V1 interface fields are declared @external', () => {
      const { errors, warnings } = normalizeSubgraph(
        parse(`
          interface Interface {
            age: Int! @external
            id: ID!
            name: String! @external
          }`),
      );
      expect(errors).toBeUndefined();
      expect(warnings).toBeDefined();
      expect(warnings).toHaveLength(1);
      expect(warnings![0]).toStrictEqual(externalInterfaceFieldsWarning(NOT_APPLICABLE, 'Interface', ['age', 'name']));
      expect(warnings![0].subgraph.name).toBe(NOT_APPLICABLE);
    });

    test('that a warning is returned if a V1 interface extension field is declared @external', () => {
      const { errors, warnings } = normalizeSubgraph(
        parse(`
          interface Interface {
            name: String!
          }

          extend interface Interface {
            age: Int! @external
            id: ID! @external
          }
        `),
      );
      expect(errors).toBeUndefined();
      expect(warnings).toBeDefined();
      expect(warnings).toHaveLength(1);
      expect(warnings![0]).toStrictEqual(externalInterfaceFieldsWarning(NOT_APPLICABLE, 'Interface', ['age', 'id']));
      expect(warnings![0].subgraph.name).toBe(NOT_APPLICABLE);
    });

    test('that an error is returned for an invalid V2 @external directive', () => {
      const { errors } = normalizeSubgraph(
        parse(`
          type Object {
            name: String! @shareable
            age: Int! @external
          }
        `),
      );
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(invalidExternalDirectiveError(`Object.age`));
    });

    test('that V2 @external is valid on a Field to satisfy an Interface #1', () => {
      const { errors } = normalizeSubgraph(
        parse(`
          interface Interface {
            age: Int!
          }
          
          type Object implements Interface {
            name: String! @shareable
            age: Int! @external
          }
        `),
      );
      expect(errors).toBeUndefined();
    });

    test('that V2 @external is valid on a Field to satisfy an Interface #2', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that an error is returned if a V2 @external directive is invalid', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(invalidExternalDirectiveError(`Nested.age`));
    });

    test('that a warning is returned if a V1 @external directive is unused', () => {
      const { errors, warnings } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(invalidExternalFieldWarning(`Nested.age`, NOT_APPLICABLE));
    });

    test('that V2 @external is valid on a Field that forms part of a @key FieldSet #1', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that @external is valid on a Field that forms part of a @key FieldSet #2', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that @external is valid on a Field that forms part of a @key FieldSet #3', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that V2 @external is valid on a Field that forms part of a @provides FieldSet #1', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that @external is valid on a Field that forms part of a @provides FieldSet #2', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that @external is valid on a Field that forms part of a @provides FieldSet #3', () => {
      const { errors } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
    });

    test('that V2 @external is valid on a Field that forms part of a @requires FieldSet #1', () => {
      const { errors, warnings } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });

    test('that @external is valid on a Field that forms part of a @requires FieldSet #2', () => {
      const { errors, warnings } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(requiresDefinedOnNonEntityFieldWarning('NestedOne.field', NOT_APPLICABLE));
    });

    test('that @external is valid on a Field that forms part of a @requires FieldSet #3', () => {
      const { errors, warnings } = normalizeSubgraph(
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
      );
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });

    test('that a nested @external key field that is a key field of its non-extension entity parent is considered unconditionally provided', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(subgraphAC.definitions, subgraphAC.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id object { id }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Object',
            },
          ],
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning(
          'Entity',
          'id object { id }',
          ['Entity.id', 'Entity.object', 'Object.id'],
          subgraphAC.name,
        ),
      );
    });

    test('that entities with all @external key fields generate the correct configuration data.', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(subgraphAD.definitions, subgraphAD.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id', 'object']),
              fieldNames: new Set<string>(),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id object { id }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              externalFieldNames: new Set<string>(['id']),
              fieldNames: new Set<string>(),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Object',
            },
          ],
          [
            'Query',
            {
              fieldNames: new Set<string>(['entities']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe('Federation tests', () => {
    test('that @external does not contribute to shareability checks #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphA, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphB, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors } = federateSubgraphs([subgraphH, subgraphI]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        allExternalFieldInstancesError(
          'Entity',
          new Map<string, Array<string>>([['name', ['subgraph-h', 'subgraph-i']]]),
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphK]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphL, subgraphM]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphL]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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

    test('that unique direct @external key fields on V1 entity extensions are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphQ]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphQ.name),
      );
      expect(warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphQ.name),
      );
      const q = federationResult!.subgraphConfigBySubgraphName.get(subgraphQ.name);
      expect(q).toBeDefined();
      expect(q!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id' },
                { fieldName: '', selectionSet: 'name' },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    // Apollo returns an error for only this case, but it's not meaningful nor necessary.
    // For consistency, we apply the same behaviour for the other cases of @external on extensions.
    test('that unique nested @external key fields on V1 entity extensions are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphR]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
              object: Object!
            }
            
            type Object {
              id: ID!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphR.name),
      );
      const r = federationResult!.subgraphConfigBySubgraphName.get(subgraphR.name);
      expect(r).toBeDefined();
      expect(r!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id' },
                { fieldName: '', selectionSet: 'object { id }' },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that unique direct @external key fields on V1 entities with @extends are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphS]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphS.name),
      );
      expect(warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphS.name),
      );
    });

    test('that unique nested @external key fields on V1 entities with @extends are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphT]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
              object: Object!
            }
            
            type Object {
              id: ID!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphT.name),
      );
    });

    test('that errors are returned for unique direct @external key fields on V1 entities', () => {
      const { errors } = federateSubgraphs([subgraphU]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        allExternalFieldInstancesError(
          'Entity',
          new Map<string, Array<string>>([
            ['id', [subgraphU.name]],
            ['name', [subgraphU.name]],
          ]),
        ),
      );
    });

    test('that errors are returned for unique nested @external key fields on V1 entities', () => {
      const { errors } = federateSubgraphs([subgraphV]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        allExternalFieldInstancesError('Object', new Map<string, Array<string>>([['id', [subgraphV.name]]])),
      );
    });

    //V2
    test('that unique direct @external key fields on V2 entity extensions are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphW]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
            }
            
            scalar openfed__Scope
          `,
        ),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphW.name),
      );
      expect(warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphW.name),
      );
      const w = federationResult!.subgraphConfigBySubgraphName.get(subgraphW.name);
      expect(w).toBeDefined();
      expect(w!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id' },
                { fieldName: '', selectionSet: 'name' },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that unique nested @external key fields on V2 entity extensions are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphX]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              id: ID!
              object: Object!
            }
            
            type Object {
              id: ID!
            }

            type Query {
              entity: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphX.name),
      );
      const x = federationResult!.subgraphConfigBySubgraphName.get(subgraphX.name);
      expect(x).toBeDefined();
      expect(x!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object']),
              isRootNode: true,
              keys: [
                { fieldName: '', selectionSet: 'id' },
                { fieldName: '', selectionSet: 'object { id }' },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that unique direct @external key fields on V2 entities with @extends are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphY]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphY.name),
      );
      expect(warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphY.name),
      );
    });

    test('that unique nested @external key fields on V2 entities with @extends are valid', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([subgraphP, subgraphZ]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              id: ID!
              object: Object!
            }
            
            type Object {
              id: ID!
            }

            type Query {
              entity: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphZ.name),
      );
    });

    test('that errors are returned for unique direct @external key fields on V2 entities', () => {
      const { errors } = federateSubgraphs([subgraphAA]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        allExternalFieldInstancesError(
          'Entity',
          new Map<string, Array<string>>([
            ['id', [subgraphAA.name]],
            ['name', [subgraphAA.name]],
          ]),
        ),
      );
    });

    test('that errors are returned for unique nested @external key fields on V2 entities', () => {
      const { errors } = federateSubgraphs([subgraphAB]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        allExternalFieldInstancesError('Object', new Map<string, Array<string>>([['id', [subgraphAB.name]]])),
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

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
      type Object {
        externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
        nonExternalFieldOne: Boolean!
      }
      
      extend type Object @external {
        externalFieldTwo: Int!
        externalFieldThree: Float
      }
      
      extend type Object @external {
        """
          This is the description for Object.externalFieldFour
        """
        externalFieldFour: String!
      }
      
      extend type Object {
        nonExternalFieldTwo(argOne: Int, """This is a description for Object.nonExternalFieldTwo.argTwo""" argTwo: Boolean!): Float!
        nonExternalFieldThree: Boolean
      }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    extend type Object @external {
      """
      This is the description for Object.externalFieldFour
      """
      externalFieldFour: String!
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
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    extend type Entity @key(fields: "id") @key(fields: "name") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    extend type Entity @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @extends @key(fields: "id") @key(fields: "name") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @extends @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @key(fields: "name") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity!
    }
    
    extend type Entity @key(fields: "id") @key(fields: "name") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity!
    }
    
    extend type Entity @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity!
    }
    
    type Entity @extends @key(fields: "id") @key(fields: "name") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity!
    }
    
    type Entity @extends @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @key(fields: "name") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @key(fields: "object { id }") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entities: [Entity!]!
    }
    
    extend type Entity @key(fields: "id object { id }") {
      id: ID! @external
      object: Object! @external
    }
    
    type Object @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id object { id }") {
      id: ID! @external
      object: Object! @external
    }
    
    type Object @key(fields: "id") {
      id: ID! @external
    }
  `),
};
