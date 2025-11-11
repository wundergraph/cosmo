import {
  duplicateEnumValueDefinitionError,
  ENUM,
  EnumDefinitionData,
  incompatibleSharedEnumError,
  noBaseDefinitionForExtensionError,
  noDefinedEnumValuesError,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import { INACCESSIBLE_DIRECTIVE, SCHEMA_QUERY_DEFINITION, TAG_DIRECTIVE } from '../utils/utils';
import {
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
      const { errors } = federateSubgraphsFailure([subgraphC, subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(incompatibleSharedEnumError(parentName));
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

const subgraphE = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    enum Instruction {
      FIGHT
      POKEMON
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
