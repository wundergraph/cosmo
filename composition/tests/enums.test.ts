import { federateSubgraphs, incompatibleSharedEnumError, parse, Subgraph } from '../src';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoClientDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('Enum federation tests', () => {
  const parentName = 'Instruction';

  test('that enums merge by union if unused in inputs or arguments', () => {
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

  test('that enums merge by intersection if used as an input', () => {
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

  test('that enums merge by intersection if used as an argument', () => {
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

  test('that enums must be consistent if used as both an input and output', () => {
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

  test('that an error is returned if an inconsistent enum is used as both input and output', () => {
    const { errors } = federateSubgraphs([subgraphC, subgraphE]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(incompatibleSharedEnumError(parentName));
  });

  test('that declaring an enum value as inaccessible prevents an enum inconsistency error #1.1', () => {
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

  test('that declaring an enum value as inaccessible prevents an enum inconsistency error #1.2', () => {
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
