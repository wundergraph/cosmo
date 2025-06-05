import {
  duplicateEnumValueDefinitionError,
  ENUM,
  EnumDefinitionData,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  incompatibleSharedEnumError,
  noBaseDefinitionForExtensionError,
  noDefinedEnumValuesError,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  schemaQueryDefinition,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from '../utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';

describe('Enum tests', () => {
  describe('Normalization tests', () => {
    test('that an Enum extension orphan is valid', () => {
      const result = normalizeSubgraph(
        subgraphQ.definitions,
        subgraphQ.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphS.definitions,
        subgraphS.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphT.definitions,
        subgraphT.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphV.definitions,
        subgraphV.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphW.definitions,
        subgraphW.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphX.definitions,
        subgraphX.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphY.definitions,
        subgraphY.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphZ.definitions,
        subgraphZ.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphAA.definitions,
        subgraphAA.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphAB.definitions,
        subgraphAB.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphAC.definitions,
        subgraphAC.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphAD.definitions,
        subgraphAD.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphI.definitions,
        subgraphI.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final Enum extension defines no Enum Values', () => {
      const result = normalizeSubgraph(
        subgraphJ.definitions,
        subgraphJ.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final extended Enum defines no Enum Values #1', () => {
      const result = normalizeSubgraph(
        subgraphK.definitions,
        subgraphK.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if a final extended Enum defines no Enum Values #2', () => {
      const result = normalizeSubgraph(
        subgraphL.definitions,
        subgraphL.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noDefinedEnumValuesError(ENUM));
    });

    test('that an error is returned if an Enum defines a duplicate Enum Value', () => {
      const result = normalizeSubgraph(
        subgraphM.definitions,
        subgraphM.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an Enum extension defines a duplicate Enum Value', () => {
      const result = normalizeSubgraph(
        subgraphN.definitions,
        subgraphN.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an extended Enum defines a duplicate Enum Value #1', () => {
      const result = normalizeSubgraph(
        subgraphO.definitions,
        subgraphO.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });

    test('that an error is returned if an extended Enum defines a duplicate Enum Value #2', () => {
      const result = normalizeSubgraph(
        subgraphP.definitions,
        subgraphP.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateEnumValueDefinitionError(ENUM, 'A'));
    });
  });

  describe('Federation tests', () => {
    const parentName = 'Instruction';

    test('that an error is returned if federation results in an Enum extension orphan', () => {
      const result = federateSubgraphs(
        [subgraphR, subgraphQ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(ENUM, ENUM));
    });

    test('that an Enum type and extension definition federate successfully #1.1', () => {
      const result = federateSubgraphs(
        [subgraphR, subgraphQ, subgraphU],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphR, subgraphU, subgraphQ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphA, subgraphF],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphC, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphC, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(incompatibleSharedEnumError(parentName));
    });

    test('that declaring an Enum Value as inaccessible prevents an Enum inconsistency error #1.1', () => {
      const result = federateSubgraphs(
        [subgraphG, subgraphH],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
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
      const result = federateSubgraphs(
        [subgraphH, subgraphG],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
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
      const result = federateSubgraphs(
        [subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);

      const enumDef = result.parentDefinitionDataByTypeName.get('Instruction') as EnumDefinitionData;

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
