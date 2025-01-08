import {
  duplicateEnumValueDefinitionError,
  ENUM,
  EnumDefinitionData,
  federateSubgraphs,
  incompatibleSharedEnumError,
  noBaseDefinitionForExtensionError,
  noDefinedEnumValuesError,
  normalizeSubgraph,
  parse,
  Subgraph,
} from '../src';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
  versionTwoClientDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('Enum tests', () => {
  describe('Normalization tests', () => {
    test('that an Enum extension orphan is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphQ.definitions, subgraphQ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphS.definitions, subgraphS.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum {
            A
            B
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphT.definitions, subgraphT.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum {
            A
            B
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphV.definitions, subgraphV.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphW.definitions, subgraphW.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #3', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphX.definitions, subgraphX.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #4', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphY.definitions, subgraphY.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum stub can be extended #5', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphZ.definitions, subgraphZ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAA.definitions, subgraphAA.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAB.definitions, subgraphAB.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum extension can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAC.definitions, subgraphAC.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Enum extension can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAD.definitions, subgraphAD.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          enum Enum @tag(name: "name") {
            A
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a final Enum defines no Enum Values', () => {
      const { errors } = normalizeSubgraph(subgraphI.definitions, subgraphI.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final Enum extension defines no Enum Values', () => {
      const { errors } = normalizeSubgraph(subgraphJ.definitions, subgraphJ.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final extended Enum defines no Enum Values #1', () => {
      const { errors } = normalizeSubgraph(subgraphK.definitions, subgraphK.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final extended Enum defines no Enum Values #2', () => {
      const { errors } = normalizeSubgraph(subgraphL.definitions, subgraphL.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if an Enum defines a duplicate Enum Value', () => {
      const { errors } = normalizeSubgraph(subgraphM.definitions, subgraphM.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an Enum extension defines a duplicate Enum Value', () => {
      const { errors } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an extended Enum defines a duplicate Enum Value #1', () => {
      const { errors } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an extended Enum defines a duplicate Enum Value #2', () => {
      const { errors } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });
  });

  describe('Federation tests', () => {
    const parentName = 'Instruction';

    test('that an error is returned if federation results in an Enum extension orphan', () => {
      const { errors } = federateSubgraphs([subgraphR, subgraphQ]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(ENUM, ENUM));
    });

    test('that an Enum type and extension definition federate successfully #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphR, subgraphQ, subgraphU]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphR, subgraphU, subgraphQ]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
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

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that Enums merge by intersection if used as an Input Field', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
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

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that Enums merge by intersection if used as an Argument', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphF]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
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

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that Enums must be consistent if used as both an input and output', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
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

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that an error is returned if an inconsistent Enum is used as both input and output', () => {
      const { errors } = federateSubgraphs([subgraphC, subgraphE]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(incompatibleSharedEnumError(parentName));
    });

    test('that declaring an Enum Value as inaccessible prevents an Enum inconsistency error #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphG, subgraphH]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
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

            scalar openfed__Scope
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          versionTwoClientDefinitions +
            `
            enum Enum {
              A
              B
            }

            type Query {
              enum(enum: Enum!): Enum!
              enumTwo(enum: Enum!): Enum!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that declaring an Enum Value as inaccessible prevents an Enum inconsistency error #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphG]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
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

            scalar openfed__Scope
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          versionTwoClientDefinitions +
            `
            enum Enum {
              A
              B
            }

            type Query {
              enum(enum: Enum!): Enum!
              enumTwo(enum: Enum!): Enum!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that an Enum has subgraphs data', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
      expect(errors).toBeUndefined();

      const enumDef = federationResult?.parentDefinitionDataByTypeName.get('Instruction') as EnumDefinitionData;

      expect(enumDef.subgraphNames.size).toBe(2);
      expect(enumDef.subgraphNames).toContain(subgraphA.name);
      expect(enumDef.subgraphNames).toContain(subgraphC.name);

      const fightEnumVal = enumDef.enumValueDataByValueName.get('FIGHT');
      expect(fightEnumVal?.subgraphNames.size).toBe(2);
      expect(fightEnumVal?.subgraphNames).toContain(subgraphA.name);
      expect(fightEnumVal?.subgraphNames).toContain(subgraphC.name);

      const pokemonEnumVal = enumDef.enumValueDataByValueName.get('POKEMON');
      expect(pokemonEnumVal?.subgraphNames.size).toBe(2);
      expect(pokemonEnumVal?.subgraphNames).toContain(subgraphA.name);
      expect(pokemonEnumVal?.subgraphNames).toContain(subgraphC.name);

      const itemEnumVal = enumDef.enumValueDataByValueName.get('ITEM');
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
