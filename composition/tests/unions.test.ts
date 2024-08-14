import {
  federateSubgraphs,
  invalidUnionMemberTypeError,
  noDefinedUnionMembersError,
  normalizeSubgraph,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { normalizeString, schemaToSortedNormalizedString, versionOneRouterDefinitions } from './utils/utils';

describe('Union tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if non-objects are defined as union members', () => {
      const { errors } = normalizeSubgraph(subgraphF.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(
        invalidUnionMemberTypeError('Union', [
          '"Interface", which is type "interface"',
          '"Scalar", which is type "scalar"',
          '"Input", which is type "input object"',
          '"Union", which is type "union"',
        ]),
      );
    });

    test('that an error is returned if non-objects are defined as union members through an extension', () => {
      const { errors } = normalizeSubgraph(subgraphG.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidUnionMemberTypeError('Union', ['"Scalar", which is type "scalar"']));
    });

    test('that an error is returned if non-objects are defined as union members and the union is extended', () => {
      const { errors } = normalizeSubgraph(subgraphH.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidUnionMemberTypeError('Union', ['"Scalar", which is type "scalar"']));
    });
  });

  describe('Federation tests', () => {
    test('that unions merge by union #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      const federatedGraph = federationResult!.federatedGraphAST;
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
      type Bulbasaur {
        name: String!
      }

      type Charmander {
        name: String!
      }
      
      type Chikorita {
        name: String!
      }

      type Cyndaquil {
        name: String!
      }
      
      type Query {
        starter: Starters
      }

      type Squirtle {
        name: String!
      }

      union Starters = Bulbasaur | Charmander | Chikorita | Cyndaquil | Squirtle | Totodile

      type Totodile {
        name: String!
      }
    `,
        ),
      );
    });

    test('that unions merge by union #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphA]);
      expect(errors).toBeUndefined();
      const federatedGraph = federationResult!.federatedGraphAST;
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
      type Bulbasaur {
        name: String!
      }

      type Charmander {
        name: String!
      }
      
      type Chikorita {
        name: String!
      }

      type Cyndaquil {
        name: String!
      }
      
      type Query {
        starter: Starters
      }

      type Squirtle {
        name: String!
      }

      union Starters = Bulbasaur | Charmander | Chikorita | Cyndaquil | Squirtle | Totodile

      type Totodile {
        name: String!
      }
    `,
        ),
      );
    });

    test('that an error is returned if a union has no members #1.1', () => {
      const { errors } = federateSubgraphs([subgraphB, subgraphC]);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(subgraphValidationError('subgraph-c', [noDefinedUnionMembersError('Starters')]));
    });

    test('that an error is returned if a union has no members #1.1', () => {
      const { errors } = federateSubgraphs([subgraphC, subgraphB]);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(subgraphValidationError('subgraph-c', [noDefinedUnionMembersError('Starters')]));
    });

    test('that union extensions federate correctly #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
        """
          001 Kanto
        """
        type Bulbasaur {
          """
            The Kanto Pokemon's name
          """
          name: String!
        }
        
        """
          004 of 150
        """
        type Charmander {
          """
            The Kanto Pokemon's name
          """
          name: String!
        }
        
        """
          152
        """
        type Chikorita {
          """
            The Pokemon's name
          """
          name: String!
        }

        """
          155
        """
        type Cyndaquil {
          """
            The Pokemon's name
          """
          name: String!
        }
        
        type Query {
          starters: [Starters!]!
        }

        """
          007 Kanto
        """
        type Squirtle {
          """
            The Pokemon's English name
          """
          name: String!
        }
        
        """
          The union of Pokemon starters (English names)
        """
        union Starters = Bulbasaur | Charmander | Chikorita | Cyndaquil | Squirtle | Totodile
        
        """
          158
        """
        type Totodile {
          """
            The Pokemon's name
          """
          name: String!
        }
        `,
        ),
      );
    });

    test('that union extensions federate correctly #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
        """
          001 Kanto
        """
        type Bulbasaur {
          """
            The Kanto Pokemon's name
          """
          name: String!
        }
        
        """
          004 of 150
        """
        type Charmander {
          """
            The Kanto Pokemon's name
          """
          name: String!
        }
        
        """
          152
        """
        type Chikorita {
          """
            The Pokemon's name
          """
          name: String!
        }

        """
          155
        """
        type Cyndaquil {
          """
            The Pokemon's name
          """
          name: String!
        }
        
        type Query {
          starters: [Starters!]!
        }

        """
          007 Kanto
        """
        type Squirtle {
          """
            The Pokemon's English name
          """
          name: String!
        }
        
        """
          The union of Pokemon starters (English names)
        """
        union Starters = Bulbasaur | Charmander | Chikorita | Cyndaquil | Squirtle | Totodile
        
        """
          158
        """
        type Totodile {
          """
            The Pokemon's name
          """
          name: String!
        }
        `,
        ),
      );
    });
  });
});

const subgraphA = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    union Starters = Bulbasaur | Squirtle | Charmander

    type Bulbasaur {
      name: String!
    }

    type Squirtle {
      name: String!
    }

    type Charmander {
      name: String!
    }
    
    type Query {
      starter: Starters
    }
  `),
};

const subgraphB = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      starter: Starters
    }
    
    union Starters = Chikorita | Totodile | Cyndaquil

    type Chikorita {
      name: String!
    }

    type Totodile {
      name: String!
    }

    type Cyndaquil {
      name: String!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`union Starters`),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      starters: [Starters!]!
    }
    
    """
      001
    """
    type Bulbasaur {
      """
        The Pokemon's name
      """
      name: String!
    }

    """
      004 of 150
    """
    type Charmander {
      """
        The Pokemon's name
      """
      name: String!
    }

    """
      007
    """
    type Squirtle {
      """
        The Pokemon's English name
      """
      name: String!
    }
    
    """
      The union of Pokemon starters (English names)
    """
    union Starters = Bulbasaur
    
    extend union Starters = Squirtle
    
    extend union Starters = Charmander
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      starters: [Starters!]!
    }
    
    """
      152
    """
    type Chikorita {
      """
        The Pokemon's name
      """
      name: String!
    }

    """
      155
    """
    type Cyndaquil {
      """
        The Pokemon's name
      """
      name: String!
    }

    """
      158
    """
    type Totodile {
      """
        The Pokemon's name
      """
      name: String!
    }
    
    """
      001 Kanto
    """
    type Bulbasaur {
      """
        The Kanto Pokemon's name
      """
      name: String!
    }

    """
      004 Kanto
    """
    type Charmander {
      """
        The Kanto Pokemon's name
      """
      name: String!
    }

    """
      007 Kanto
    """
    type Squirtle {
      """
        The Kanto Pokemon's name
      """
      name: String!
    }
    
    """
      The union of Pokemon starters
    """
    union Starters = Bulbasaur | Charmander
    
    extend union Starters = Squirtle | Chikorita
    
    extend union Starters = Cyndaquil | Totodile
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    interface Interface {
      name: String!
    }
    
    input Input {
      name: String!
    }
    
    scalar Scalar
    
    union Union = Object | Interface | Scalar | Input | Union
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    scalar Scalar
    
    union Union = Object
    
    extend union Union = Scalar
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    scalar Scalar
    
    union Union = Scalar
    
    extend union Union = Object
  `),
};
