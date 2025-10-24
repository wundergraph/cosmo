import { describe, expect, test } from 'vitest';
import {
  allExternalFieldInstancesError,
  ConfigurationData,
  EXTERNAL,
  externalEntityExtensionKeyFieldWarning,
  externalInterfaceFieldsError,
  externalInterfaceFieldsWarning,
  FIRST_ORDINAL,
  invalidDirectiveError,
  invalidExternalDirectiveError,
  invalidExternalFieldWarning,
  invalidRepeatedDirectiveErrorMessage,
  parse,
  requiresDefinedOnNonEntityFieldWarning,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { baseDirectiveDefinitions, versionOneRouterDefinitions, versionTwoRouterDefinitions } from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('@external directive tests', () => {
  describe('Normalization tests', () => {
    test('that @external declared on the Object level applies to its defined fields #1', () => {
      const result = normalizeSubgraphSuccess(na, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      expect(result.warnings).toHaveLength(4);
      expect(result.warnings[0]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldOne', na.name));
      expect(result.warnings[1]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldTwo', na.name));
      expect(result.warnings[2]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldThree', na.name));
      expect(result.warnings[3]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldFour', na.name));
    });

    test('that @external declared on the Object level applies to all its defined fields #2', () => {
      const result = normalizeSubgraphSuccess(nb, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      expect(result.warnings).toHaveLength(4);
      expect(result.warnings[0]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldFour', nb.name));
      expect(result.warnings[1]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldTwo', nb.name));
      expect(result.warnings[2]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldThree', nb.name));
      expect(result.warnings[3]).toStrictEqual(invalidExternalFieldWarning('Object.externalFieldOne', nb.name));
    });

    test('that @external declared on both the parent and field level is not repeated', () => {
      const result = normalizeSubgraphSuccess(nc, ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = normalizeSubgraphFailure(nd, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors).toStrictEqual([
        invalidDirectiveError(EXTERNAL, 'Entity.field', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(EXTERNAL),
        ]),
      ]);
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const result = normalizeSubgraphFailure(ne, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['name']));
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const result = normalizeSubgraphFailure(nf, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['age', 'name']));
    });

    test('that a warning is returned if a V1 interface fields are declared @external', () => {
      const result = normalizeSubgraphSuccess(ng, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toStrictEqual(externalInterfaceFieldsWarning(ng.name, 'Interface', ['age', 'name']));
      expect(result.warnings![0].subgraph.name).toBe(ng.name);
    });

    test('that a warning is returned if a V1 interface extension field is declared @external', () => {
      const result = normalizeSubgraphSuccess(nh, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toStrictEqual(externalInterfaceFieldsWarning(nh.name, 'Interface', ['age', 'id']));
      expect(result.warnings![0].subgraph.name).toBe(nh.name);
    });

    test('that an error is returned for an invalid V2 @external directive', () => {
      const result = normalizeSubgraphFailure(ni, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(invalidExternalDirectiveError(`Object.age`));
    });

    test('that V2 @external is valid on a field to satisfy an Interface #1', () => {
      const result = normalizeSubgraphSuccess(nj, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that V2 @external is valid on a field to satisfy an Interface #2', () => {
      const result = normalizeSubgraphSuccess(nk, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that an error is returned if a V2 @external directive is invalid', () => {
      const result = normalizeSubgraphFailure(nl, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(invalidExternalDirectiveError(`Nested.age`));
    });

    test('that a warning is returned if a V1 @external directive is unused', () => {
      const result = normalizeSubgraphSuccess(nm, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(invalidExternalFieldWarning(`Nested.age`, nm.name));
    });

    test('that V2 @external is valid on a Field that forms part of a @key FieldSet #1', () => {
      const result = normalizeSubgraphSuccess(nn, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @key FieldSet #2', () => {
      const result = normalizeSubgraphSuccess(no, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @key FieldSet #3', () => {
      const result = normalizeSubgraphSuccess(np, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that V2 @external is valid on a Field that forms part of a @provides FieldSet #1', () => {
      const result = normalizeSubgraphSuccess(nq, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @provides FieldSet #2', () => {
      const result = normalizeSubgraphSuccess(nr, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that @external is valid on a Field that forms part of a @provides FieldSet #3', () => {
      const result = normalizeSubgraphSuccess(ns, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });

    test('that V2 @external is valid on a Field that forms part of a @requires FieldSet #1', () => {
      const result = normalizeSubgraphSuccess(nt, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('that @external is valid on a Field that forms part of a @requires FieldSet #2', () => {
      const result = normalizeSubgraphSuccess(nu, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(requiresDefinedOnNonEntityFieldWarning('NestedOne.field', nu.name));
    });

    test('that @external is valid on a Field that forms part of a @requires FieldSet #3', () => {
      const result = normalizeSubgraphSuccess(nv, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('that a nested @external entity extension key field is considered unconditionally provided', () => {
      const result = normalizeSubgraphSuccess(subgraphAC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning(
          'Entity',
          'id object { id }',
          ['Entity.id', 'Entity.object', 'Object.id'],
          subgraphAC.name,
        ),
      );
    });

    test('that entities with all @external key fields generate the correct configuration data', () => {
      const result = normalizeSubgraphSuccess(subgraphAD, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Federation tests', () => {
    test('that @external does not contribute to shareability checks #1.1', () => {
      const result = federateSubgraphsSuccess([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphB, subgraphA], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphA, subgraphB, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphA, subgraphC, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphB, subgraphA, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphB, subgraphC, subgraphA], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphC, subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphC, subgraphB, subgraphA], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphD, subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphE, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsFailure([subgraphH, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphJ, subgraphK], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphL, subgraphM], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const result = federateSubgraphsSuccess([subgraphM, subgraphL], ROUTER_COMPATIBILITY_VERSION_ONE);
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

    test('that unique direct @external key fields on V1 entity extensions are valid', () => {
      const result = federateSubgraphsSuccess([subgraphP, subgraphQ], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphQ.name),
      );
      expect(result.warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphQ.name),
      );
      const q = result.subgraphConfigBySubgraphName.get(subgraphQ.name);
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
      const result = federateSubgraphsSuccess([subgraphP, subgraphR], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphR.name),
      );
      const r = result.subgraphConfigBySubgraphName.get(subgraphR.name);
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
      const result = federateSubgraphsSuccess([subgraphP, subgraphS], ROUTER_COMPATIBILITY_VERSION_ONE);
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
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphS.name),
      );
      expect(result.warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphS.name),
      );
    });

    test('that unique nested @external key fields on V1 entities with @extends are valid', () => {
      const result = federateSubgraphsSuccess([subgraphP, subgraphT], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphT.name),
      );
    });

    test('that errors are returned for unique direct @external key fields on V1 entities', () => {
      const result = federateSubgraphsFailure([subgraphU], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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
      const result = federateSubgraphsFailure([subgraphV], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        allExternalFieldInstancesError('Object', new Map<string, Array<string>>([['id', [subgraphV.name]]])),
      );
    });

    //V2
    test('that unique direct @external key fields on V2 entity extensions are valid', () => {
      const result = federateSubgraphsSuccess([subgraphP, subgraphW], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphW.name),
      );
      expect(result.warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphW.name),
      );
      const w = result.subgraphConfigBySubgraphName.get(subgraphW.name);
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
      const result = federateSubgraphsSuccess([subgraphP, subgraphX], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphX.name),
      );
      const x = result.subgraphConfigBySubgraphName.get(subgraphX.name);
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
      const result = federateSubgraphsSuccess([subgraphP, subgraphY], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'id', ['Entity.id'], subgraphY.name),
      );
      expect(result.warnings[1]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'name', ['Entity.name'], subgraphY.name),
      );
    });

    test('that unique nested @external key fields on V2 entities with @extends are valid', () => {
      const result = federateSubgraphsSuccess([subgraphP, subgraphZ], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStrictEqual(
        externalEntityExtensionKeyFieldWarning('Entity', 'object { id }', ['Object.id'], subgraphZ.name),
      );
    });

    test('that errors are returned for unique direct @external key fields on V2 entities', () => {
      const result = federateSubgraphsFailure([subgraphAA], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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
      const result = federateSubgraphsFailure([subgraphAB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        allExternalFieldInstancesError('Object', new Map<string, Array<string>>([['id', [subgraphAB.name]]])),
      );
    });
  });
});

const na: Subgraph = {
  name: 'na',
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
      
      extend type Object {
        """
          This is the description for Object.externalFieldFour
        """
        externalFieldFour: String! @external
      }
      
      extend type Object {
        nonExternalFieldTwo(argOne: Int, """This is a description for Object.nonExternalFieldTwo.argTwo""" argTwo: Boolean!): Float!
        nonExternalFieldThree: Boolean
      }
  `),
};

const nb: Subgraph = {
  name: 'nb',
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

    extend type Object {
      externalFieldTwo: Int! @external
      externalFieldThree: Float @external
    }

    type Object {
      externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
      nonExternalFieldOne: Boolean!
    }
  `),
};

const nc: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @external {
      id: ID!
      field: String! @external
    }
  `),
};

const nd: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      field: String! @external @external
    }
  `),
};

const ne: Subgraph = {
  name: 'ne',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }

    interface Interface {
      name: String! @external
    }
  `),
};

const nf: Subgraph = {
  name: 'nf',
  url: '',
  definitions: parse(`
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
};

const ng: Subgraph = {
  name: 'ng',
  url: '',
  definitions: parse(`
          interface Interface {
            age: Int! @external
            id: ID!
            name: String! @external
          }
  `),
};

const nh: Subgraph = {
  name: 'nh',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }

    extend interface Interface {
      age: Int! @external
      id: ID! @external
    }
  `),
};

const ni: Subgraph = {
  name: 'ni',
  url: '',
  definitions: parse(`
    type Object {
      name: String! @shareable
      age: Int! @external
    }
  `),
};

const nj: Subgraph = {
  name: 'nj',
  url: '',
  definitions: parse(`
    interface Interface {
      age: Int!
    }
    
    type Object implements Interface {
      name: String! @shareable
      age: Int! @external
    }
  `),
};

const nk: Subgraph = {
  name: 'nk',
  url: '',
  definitions: parse(`
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
};

const nl: Subgraph = {
  name: 'nl',
  url: '',
  definitions: parse(`
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
};

const nm: Subgraph = {
  name: 'nm',
  url: '',
  definitions: parse(`
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
};

const nn: Subgraph = {
  name: 'nn',
  url: '',
  definitions: parse(`
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
};

const no: Subgraph = {
  name: 'no',
  url: '',
  definitions: parse(`
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
};

const np: Subgraph = {
  name: 'np',
  url: '',
  definitions: parse(`
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
};

const nq: Subgraph = {
  name: 'nq',
  url: '',
  definitions: parse(`
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
};

const nr: Subgraph = {
  name: 'nr',
  url: '',
  definitions: parse(`
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
};

const ns: Subgraph = {
  name: 'ns',
  url: '',
  definitions: parse(`
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
};

const nt: Subgraph = {
  name: 'nt',
  url: '',
  definitions: parse(`
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
};

const nu: Subgraph = {
  name: 'nu',
  url: '',
  definitions: parse(`
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
};

const nv: Subgraph = {
  name: 'nv',
  url: '',
  definitions: parse(`
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
};

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
