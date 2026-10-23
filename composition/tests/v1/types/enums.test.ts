import {
  type ContractTagOptions,
  duplicateEnumValueDefinitionError,
  ENUM,
  type EnumDefinitionData,
  federateSubgraphsContract,
  type FederationFailure,
  incompatibleSharedEnumError,
  noBaseDefinitionForExtensionError,
  noDefinedEnumValuesError,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import { INACCESSIBLE_DIRECTIVE, SCHEMA_QUERY_DEFINITION, TAG_DIRECTIVE } from '../utils/utils';
import {
  createSubgraph,
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('Enum tests', () => {
  describe('Normalization tests', () => {
    test('that an Enum extension orphan is valid', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphQ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          enum Enum {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum can be extended #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphS, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          enum Enum {
            A
            B
          }
        `,
        ),
      );
    });

    test('that an Enum can be extended #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphT, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          enum Enum {
            A
            B
          }
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphV, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          enum Enum {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphW, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          enum Enum {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #3', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphX, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #4', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphY, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #5', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphZ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum can be extended with just a directive #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphAA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum can be extended with just a directive #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphAB, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum extension can be extended with just a directive #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphAC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an Enum extension can be extended with just a directive #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphAD, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          enum Enum @tag(name: "name") {
            A
          }
        `,
        ),
      );
    });

    test('that an error is returned if a final Enum defines no Enum Values', () => {
      const { errors } = normalizeSubgraphFailure(subgraphI, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final Enum extension defines no Enum Values', () => {
      const { errors } = normalizeSubgraphFailure(subgraphJ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final extended Enum defines no Enum Values #1', () => {
      const { errors } = normalizeSubgraphFailure(subgraphK, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final extended Enum defines no Enum Values #2', () => {
      const { errors } = normalizeSubgraphFailure(subgraphL, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if an Enum defines a duplicate Enum Value', () => {
      const { errors } = normalizeSubgraphFailure(subgraphM, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an Enum extension defines a duplicate Enum Value', () => {
      const { errors } = normalizeSubgraphFailure(subgraphN, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an extended Enum defines a duplicate Enum Value #1', () => {
      const { errors } = normalizeSubgraphFailure(subgraphO, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an extended Enum defines a duplicate Enum Value #2', () => {
      const { errors } = normalizeSubgraphFailure(subgraphP, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that a Directive argument that accepts an Enum can be passed as a String', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(subgraphAE, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toStrictEqual(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        directive @a(enum: Enum!) on FIELD_DEFINITION

        enum Enum {
          A
        }

        type Query {
          a: ID @a(enum: A)
        }
      `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a Directive argument Enum default value can be passed as a String', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(subgraphAF, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toStrictEqual(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        directive @a(enum: Enum! = A) on FIELD_DEFINITION

        enum Enum {
          A
          B
        }

        type Query {
          a: ID @a(enum: B)
        }
      `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a field argument that accepts an Enum can use a String default value', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(subgraphAG, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toStrictEqual(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        enum Enum {
          A
        }

        type Query {
          a(a: Enum! = A): ID
        }
      `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that an Input value that accepts an Enum can use a String default value', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(subgraphAH, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toStrictEqual(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        enum Enum {
          A
        }

        input Input {
          a: Enum! = A
        }

        type Query {
          a(a: Input!): ID
        }
      `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe('Federation tests', () => {
    const parentName = 'Instruction';

    test('that an error is returned if federation results in an Enum extension orphan', () => {
      const { errors } = federateSubgraphsFailure([subgraphR, subgraphQ], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(ENUM, ENUM));
    });

    test('that an Enum type and extension definition federate successfully #1.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphR, subgraphQ, subgraphU],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            enum Enum {
              A
              B
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Enum type and extension definition federate successfully #1.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphR, subgraphU, subgraphQ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            enum Enum {
              A
              B
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that Enums merge by union if unused in Input Fields or Arguments', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            enum Instruction {
              FIGHT
              ITEM
              POKEMON
              RUN
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that Enums merge by intersection if used as an Input Field', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            enum Instruction {
              FIGHT
              POKEMON
            }

            type Query {
              dummy: String!
            }

            input TrainerBattle {
              actions: Instruction!
            }
          `,
        ),
      );
    });

    test('that Enums merge by intersection if used as an Argument', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphA, subgraphF],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type BattleAction {
              baseAction(input: Instruction): Boolean!
            }

            enum Instruction {
              FIGHT
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that Enums must be consistent if used as both an input and output', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphC, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type BattleAction {
              baseAction: Instruction!
            }

            enum Instruction {
              FIGHT
              ITEM
              POKEMON
            }

            type Query {
              dummy: String!
            }

            input TrainerBattle {
              actions: Instruction!
            }
          `,
        ),
      );
    });

    test('that an error is returned if an inconsistent Enum is used as both input and output', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          type Query {
            dummy: String! @shareable
          }

          enum Instruction {
            FIGHT
            POKEMON
            ITEM
          }

          input TrainerBattle {
            actions: Instruction!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Instruction {
            FIGHT
            POKEMON
          }

          type BattleAction {
            baseAction: Instruction!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['TrainerBattle.actions']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['ITEM']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['BattleAction.baseAction']]]),
          typeName: parentName,
        }),
      );
    });

    test('that a single error is returned for an Enum regardless of the number of inconsistent Enum Values #1.1', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          enum Enum {
            A
            B
          }

          type Query {
            a(enum: Enum!): Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
            C
            D
          }

          type Query {
            b: Enum!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a(enum: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['C', 'D']],
            [subgraphB.name, ['B']],
          ]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.a']],
            [subgraphB.name, ['Query.b']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that a single error is returned for an Enum regardless of the number of inconsistent Enum Values #1.2', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          enum Enum {
            A
            B
          }

          type Query {
            a(enum: Enum!): Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
            C
            D
          }

          type Query {
            b: Enum!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphB, subgraphA], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a(enum: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([
            [subgraphB.name, ['B']],
            [subgraphA.name, ['C', 'D']],
          ]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphB.name, ['Query.b']],
            [subgraphA.name, ['Query.a']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that an error is returned for each inconsistent Enum that is used as both input and output', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          enum EnumOne {
            A
            B
          }

          enum EnumTwo {
            X
            Y
          }

          type Query {
            a(one: EnumOne!): EnumTwo!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum EnumOne {
            A
          }

          enum EnumTwo {
            X
          }

          type Query {
            b(two: EnumTwo!): EnumOne!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a(one: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['B']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['Query.b']]]),
          typeName: 'EnumOne',
        }),
      );
      expect(errors[1]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['Query.b(two: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['Y']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a']]]),
          typeName: 'EnumTwo',
        }),
      );
    });

    test('that an inconsistent shared Enum error includes subgraphs that use the Enum as an input, an output, or not at all', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          enum Enum {
            A
            B
          }

          type Query {
            both(enum: Enum!): Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
          }

          type Query {
            unused: String!
          }
        `,
      );
      const subgraphC = createSubgraph(
        'subgraph-c',
        `
          enum Enum {
            A
            B
            C
          }

          input Input {
            enum: Enum!
          }

          type Query {
            input(input: Input!): String!
          }
        `,
      );
      const subgraphD = createSubgraph(
        'subgraph-d',
        `
          enum Enum {
            B
          }

          type Object {
            enum: Enum!
          }

          type Query {
            output: Object!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure(
        [subgraphA, subgraphB, subgraphC, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.both(enum: ...)']],
            [subgraphC.name, ['Input.enum']],
          ]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['C']],
            [subgraphB.name, ['B', 'C']],
            [subgraphD.name, ['A', 'C']],
          ]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.both']],
            [subgraphD.name, ['Object.enum']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that usage of an Enum before its declaration does not affect validation', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `

        type Query {
          both(enum: Enum!): Enum!
        }
        
        enum Enum {
            A
            B
          }

        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
          }

          type Query {
            unused: String!
          }
        `,
      );
      const subgraphC = createSubgraph(
        'subgraph-c',
        `
          enum Enum {
            A
            B
            C
          }

          input Input {
            enum: Enum!
          }

          type Query {
            input(input: Input!): String!
          }
        `,
      );
      const subgraphD = createSubgraph(
        'subgraph-d',
        `
          enum Enum {
            B
          }

          type Object {
            enum: Enum!
          }

          type Query {
            output: Object!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure(
        [subgraphA, subgraphB, subgraphC, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.both(enum: ...)']],
            [subgraphC.name, ['Input.enum']],
          ]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['C']],
            [subgraphB.name, ['B', 'C']],
            [subgraphD.name, ['A', 'C']],
          ]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.both']],
            [subgraphD.name, ['Object.enum']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that an inconsistent shared Enum error includes coordinates shared by multiple subgraphs', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          enum Enum {
            A
            B
          }

          type Query {
            shared(enum: Enum!): Enum! @shareable
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
          }

          type Query {
            shared(enum: Enum!): Enum! @shareable
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.shared(enum: ...)']],
            [subgraphB.name, ['Query.shared(enum: ...)']],
          ]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['B']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.shared']],
            [subgraphB.name, ['Query.shared']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that an inconsistent shared Enum error includes executable directive arguments as input usages', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          directive @directive(enum: Enum!) on FIELD

          enum Enum {
            A
            B
          }

          type Query {
            a: Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          directive @directive(enum: Enum!) on FIELD

          enum Enum {
            A
          }

          type Query {
            b: Enum!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['@directive(enum: ...)']],
            [subgraphB.name, ['@directive(enum: ...)']],
          ]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['B']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.a']],
            [subgraphB.name, ['Query.b']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that an inconsistent shared Enum error does not include executable directive arguments after the locations fail to intersect', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          directive @directive(enum: Enum!) on FIELD

          enum Enum {
            A
            B
          }

          type Query {
            a: Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          directive @directive(enum: Enum!) on QUERY

          enum Enum {
            A
            B
          }

          type Query {
            b: String!
          }
        `,
      );
      const subgraphC = createSubgraph(
        'subgraph-c',
        `
          directive @directive(enum: Enum!) on FIELD

          enum Enum {
            A
          }

          type Query {
            c: String!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['@directive(enum: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphC.name, ['B']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a']]]),
          typeName: ENUM,
        }),
      );
    });

    test('that an inconsistent shared Enum error does not include inaccessible Enum Values', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          enum Enum {
            A
            B
            C @inaccessible
          }

          type Query {
            a(enum: Enum!): Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
          }

          type Query {
            b: Enum!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a(enum: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['B']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.a']],
            [subgraphB.name, ['Query.b']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that an inconsistent shared Enum error uses the renamed root type coordinates', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          schema {
            query: MyQuery
          }

          enum Enum {
            A
            B
          }

          type MyQuery {
            a(enum: Enum!): Enum!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Enum {
            A
          }

          type Query {
            b: Enum!
          }
        `,
      );
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['Query.a(enum: ...)']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['B']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([
            [subgraphA.name, ['Query.a']],
            [subgraphB.name, ['Query.b']],
          ]),
          typeName: ENUM,
        }),
      );
    });

    test('that an error is returned if an inconsistent Enum is used as both input and output in a contract', () => {
      const subgraphA = createSubgraph(
        'subgraph-a',
        `
          type Query {
            dummy: String! @shareable
          }

          enum Instruction {
            FIGHT
            POKEMON
            ITEM
          }

          input TrainerBattle {
            actions: Instruction!
          }
        `,
      );
      const subgraphB = createSubgraph(
        'subgraph-b',
        `
          enum Instruction {
            FIGHT
            POKEMON
          }

          type BattleAction {
            baseAction: Instruction!
          }
        `,
      );
      const contractTagOptions: ContractTagOptions = {
        tagNamesToExclude: new Set<string>(['exclude']),
        tagNamesToInclude: new Set<string>(),
      };
      const result = federateSubgraphsContract({
        contractTagOptions,
        subgraphs: [subgraphA, subgraphB],
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(result.success).toBe(false);
      const { errors } = result as FederationFailure;
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        incompatibleSharedEnumError({
          inputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphA.name, ['TrainerBattle.actions']]]),
          missingValueNamesBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['ITEM']]]),
          outputCoordsBySubgraphName: new Map<string, Array<string>>([[subgraphB.name, ['BattleAction.baseAction']]]),
          typeName: parentName,
        }),
      );
    });

    test('that declaring an Enum Value as inaccessible prevents an Enum inconsistency error #1.1', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphG, subgraphH],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            INACCESSIBLE_DIRECTIVE +
            `
            enum Enum {
              A
              B
              C @inaccessible
            }

            type Query {
              enum(enum: Enum!): Enum!
              enumTwo(enum: Enum!): Enum!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            enum Enum {
              A
              B
            }

            type Query {
              enum(enum: Enum!): Enum!
              enumTwo(enum: Enum!): Enum!
            }
          `,
        ),
      );
    });

    test('that declaring an Enum Value as inaccessible prevents an Enum inconsistency error #1.2', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphH, subgraphG],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            INACCESSIBLE_DIRECTIVE +
            `
            enum Enum {
              A
              B
              C @inaccessible
            }

            type Query {
              enum(enum: Enum!): Enum!
              enumTwo(enum: Enum!): Enum!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            enum Enum {
              A
              B
            }

            type Query {
              enum(enum: Enum!): Enum!
              enumTwo(enum: Enum!): Enum!
            }
          `,
        ),
      );
    });

    test('that an Enum has subgraphs data', () => {
      const { parentDefinitionDataByTypeName } = federateSubgraphsSuccess(
        [subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );

      const enumDef = parentDefinitionDataByTypeName.get('Instruction') as EnumDefinitionData;

      expect(enumDef.subgraphNames.size).toBe(2);
      expect(enumDef.subgraphNames).toContain(subgraphA.name);
      expect(enumDef.subgraphNames).toContain(subgraphC.name);

      const fightEnumVal = enumDef.enumValueDataByName.get('FIGHT');
      expect(fightEnumVal?.subgraphNames.size).toBe(2);
      expect(fightEnumVal?.subgraphNames).toContain(subgraphA.name);
      expect(fightEnumVal?.subgraphNames).toContain(subgraphC.name);

      const pokemonEnumVal = enumDef.enumValueDataByName.get('POKEMON');
      expect(pokemonEnumVal?.subgraphNames.size).toBe(2);
      expect(pokemonEnumVal?.subgraphNames).toContain(subgraphA.name);
      expect(pokemonEnumVal?.subgraphNames).toContain(subgraphC.name);

      const itemEnumVal = enumDef.enumValueDataByName.get('ITEM');
      expect(itemEnumVal?.subgraphNames.size).toBe(1);
      expect(itemEnumVal?.subgraphNames).toContain(subgraphC.name);
    });

    test('that an Enum preserve its description', () => {
      const a = createSubgraph(
        'a',
        `
          "Enum description"
          enum Enum {
            A
          }
          
          type Query {
            enums: [Enum]!
          }
        `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [a],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          `
            ${SCHEMA_QUERY_DEFINITION}
            
            """Enum description"""
            enum Enum {
              A
            }
            
            type Query {
              enums: [Enum]!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          `
            ${SCHEMA_QUERY_DEFINITION}
            
            """Enum description"""
            enum Enum {
              A
            }
            
            type Query {
              enums: [Enum]!
            }
          `,
        ),
      );
    });

    test('that Enum values preserve their descriptions', () => {
      const a = createSubgraph(
        'a',
        `
          enum Enum {
            "Enum.A description"
            A
            B
            """
            Enum.C description
            """
            C
          }
          
          type Query {
            enums: [Enum]!
          }
        `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [a],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          `
            ${SCHEMA_QUERY_DEFINITION}
            
            enum Enum {
              """Enum.A description"""
              A
              B
              """Enum.C description"""
              C
            }
            
            type Query {
              enums: [Enum]!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          `
            ${SCHEMA_QUERY_DEFINITION}
            
            enum Enum {
              """Enum.A description"""
              A
              B
              """Enum.C description"""
              C
            }
            
            type Query {
              enums: [Enum]!
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
      dummy: String! @shareable
    }

    enum Instruction {
      FIGHT
      POKEMON
    }
  `),
};

const subgraphB = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    enum Instruction {
      ITEM
      RUN
    }
  `),
};

const subgraphC = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String! @shareable
    }

    enum Instruction {
      FIGHT
      POKEMON
      ITEM
    }

    input TrainerBattle {
      actions: Instruction!
    }
  `),
};

const subgraphD = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    enum Instruction {
      FIGHT
      POKEMON
      ITEM
    }

    type BattleAction {
      baseAction: Instruction!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    enum Instruction {
      FIGHT
      ITEM
    }

    type BattleAction {
      baseAction(input: Instruction): Boolean!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    enum Enum {
      A
      B
      C @inaccessible
    }

    type Query {
      enum(enum: Enum!): Enum!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    enum Enum {
      A
      B
    }

    type Query {
      enumTwo(enum: Enum!): Enum!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    enum Enum
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    extend enum Enum @tag(name: "name")
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    extend enum Enum @tag(name: "name")
    enum Enum
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    enum Enum
    extend enum Enum @tag(name: "name")
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    enum Enum {
      A
      A
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    extend enum Enum {
      A
      A
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    enum Enum {
      A
    }

    extend enum Enum {
      A
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-P',
  url: '',
  definitions: parse(`
    extend enum Enum {
      A
    }

    enum Enum {
      A
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    extend enum Enum {
      A
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    enum Enum {
      A
    }

    extend enum Enum {
      B
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    extend enum Enum {
      B
    }

    enum Enum {
      A
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    enum Enum {
      B
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    enum Enum

    extend enum Enum {
      A
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    extend enum Enum {
      A
    }

    enum Enum
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    enum Enum

    extend enum Enum {
      A
    }

    extend enum Enum @tag(name: "name")
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    extend enum Enum {
      A
    }

    enum Enum

    extend enum Enum @tag(name: "name")
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-Z',
  url: '',
  definitions: parse(`
    extend enum Enum @tag(name: "name")

    extend enum Enum {
      A
    }

    enum Enum
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    enum Enum {
      A
    }

    extend enum Enum @tag(name: "name")
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    extend enum Enum @tag(name: "name")

    enum Enum {
      A
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    extend enum Enum {
      A
    }

    extend enum Enum @tag(name: "name")
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    extend enum Enum @tag(name: "name")

    extend enum Enum {
      A
    }
  `),
};

const subgraphAE = createSubgraph(
  'subgraph-ae',
  `
    directive @a(enum: Enum!) on FIELD_DEFINITION

    enum Enum {
      A
    }

    type Query {
      a: ID @a(enum: "A")
    }
  `,
);

const subgraphAF = createSubgraph(
  'subgraph-af',
  `
    directive @a(enum: Enum! = "A") on FIELD_DEFINITION

    enum Enum {
      A
      B
    }

    type Query {
      a: ID @a(enum: "B")
    }
  `,
);

const subgraphAG = createSubgraph(
  'subgraph-ag',
  `
    enum Enum {
      A
    }

    type Query {
      a(a: Enum! = "A"): ID
    }
  `,
);

const subgraphAH = createSubgraph(
  'subgraph-ah',
  `
    enum Enum {
      A
    }

    input Input {
      a: Enum! = "A"
    }

    type Query {
      a(a: Input!): ID
    }
  `,
);
