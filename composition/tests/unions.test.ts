import {
  duplicateUnionMemberDefinitionError,
  federateSubgraphs,
  invalidUnionMemberTypeError,
  noBaseDefinitionForExtensionError,
  noDefinedUnionMembersError,
  normalizeSubgraph,
  OBJECT,
  Subgraph,
  subgraphValidationError,
  UNION,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
} from './utils/utils';

describe('Union tests', () => {
  describe('Normalization tests', () => {
    test('that a Union extension orphan is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphI.definitions, subgraphI.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphJ.definitions, subgraphJ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type AnotherObject {
            name: String!
          }
                
          type Object {
            name: String!
          }
          
          union Union = AnotherObject | Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphK.definitions, subgraphK.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type AnotherObject {
            name: String!
          }
                
          type Object {
            name: String!
          }
          
          union Union = AnotherObject | Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union stub can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphL.definitions, subgraphL.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union stub can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphM.definitions, subgraphM.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union stub can be extended #3', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union stub can be extended #4', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union stub can be extended #5', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphQ.definitions, subgraphQ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphR.definitions, subgraphR.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union extension can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphS.definitions, subgraphS.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Union extension can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphT.definitions, subgraphT.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          union Union @tag(name: "name") = Object
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a final Union defines no Union Members', () => {
      const { errors } = normalizeSubgraph(subgraphU.definitions, subgraphU.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedUnionMembersError(UNION));
    });

    test('that an error is returned if a final Union extension defines no Union Members', () => {
      const { errors } = normalizeSubgraph(subgraphV.definitions, subgraphV.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedUnionMembersError(UNION));
    });

    test('that an error is returned if a final extended Union defines no Union Members #1', () => {
      const { errors } = normalizeSubgraph(subgraphW.definitions, subgraphW.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedUnionMembersError(UNION));
    });

    test('that an error is returned if a final extended Union defines no Union Members #2', () => {
      const { errors } = normalizeSubgraph(subgraphX.definitions, subgraphX.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noDefinedUnionMembersError(UNION));
    });

    test('that an error is returned if a Union defines a duplicate Union Member', () => {
      const { errors } = normalizeSubgraph(subgraphY.definitions, subgraphY.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateUnionMemberDefinitionError(UNION, OBJECT));
    });

    test('that an error is returned if a Union extension defines a duplicate Union Member', () => {
      const { errors } = normalizeSubgraph(subgraphZ.definitions, subgraphZ.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateUnionMemberDefinitionError(UNION, OBJECT));
    });

    test('that an error is returned if an extended Union defines a duplicate Union Member #1', () => {
      const { errors } = normalizeSubgraph(subgraphAA.definitions, subgraphAA.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateUnionMemberDefinitionError(UNION, OBJECT));
    });

    test('that an error is returned if an extended Union defines a duplicate Union Member #2', () => {
      const { errors } = normalizeSubgraph(subgraphAB.definitions, subgraphAB.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateUnionMemberDefinitionError(UNION, OBJECT));
    });

    test('that an error is returned if non-Objects are defined as Union Members', () => {
      const { errors } = normalizeSubgraph(subgraphF.definitions, subgraphF.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(
        invalidUnionMemberTypeError('Union', [
          '"Interface", which is type "Interface"',
          '"Scalar", which is type "Scalar"',
          '"Input", which is type "Input Object"',
          '"Union", which is type "Union"',
        ]),
      );
    });

    test('that an error is returned if non-objects are defined as union members through an extension', () => {
      const { errors } = normalizeSubgraph(subgraphG.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidUnionMemberTypeError('Union', ['"Scalar", which is type "Scalar"']));
    });

    test('that an error is returned if non-objects are defined as union members and the union is extended', () => {
      const { errors } = normalizeSubgraph(subgraphH.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidUnionMemberTypeError('Union', ['"Scalar", which is type "Scalar"']));
    });
  });

  describe('Federation tests', () => {
    test('that a Union type and extension definition federate successfully #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAC, subgraphAD, subgraphAE]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type AnotherObject {
              name: String!
            }
            
            type Object {
              name: String!
            }
            
            type Query {
              dummy: String!
            }
            
            union Union = AnotherObject | Object
          `,
        ),
      );
    });

    test('that a Union type and extension definition federate successfully #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAC, subgraphAE, subgraphAD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type AnotherObject {
              name: String!
            }
            
            type Object {
              name: String!
            }
            
            type Query {
              dummy: String!
            }
            
            union Union = AnotherObject | Object
          `,
        ),
      );
    });

    test('that an error is returned if federation results in a Union extension orphan', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAC, subgraphAE]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(UNION, UNION));
    });

    test('that unions merge by union #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
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

const subgraphI: Subgraph = {
  name: 'subgraph-I',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    extend union Union = Object
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    union Union = Object
    
    extend union Union = AnotherObject
    
    type Object {
      name: String!
    }

    type AnotherObject {
      name: String!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    extend union Union = AnotherObject
    
    union Union = Object
    
    type Object {
      name: String!
    }

    type AnotherObject {
      name: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    union Union
    
    extend union Union = Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    extend union Union = Object
    
    union Union
    
    type Object {
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    union Union
    
    extend union Union = Object
    
    extend union Union @tag(name: "name")
    
    type Object {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    extend union Union = Object
    
    union Union
    
    extend union Union @tag(name: "name")
    
    type Object {
      name: String!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    extend union Union @tag(name: "name")
    
    extend union Union = Object
    
    union Union
    
    type Object {
      name: String!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    union Union = Object
    
    extend union Union @tag(name: "name")
    
    type Object {
      name: String!
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    extend union Union @tag(name: "name")
    
    union Union = Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    extend union Union = Object
    
    extend union Union @tag(name: "name")
    
    type Object {
      name: String!
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    extend union Union @tag(name: "name")
    
    extend union Union = Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    union Union
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    extend union Union @tag(name: "name")
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    union Union
    
    extend union Union @tag(name: "name")
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    extend union Union @tag(name: "name")
    
    union Union
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    union Union = Object | Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    extend union Union = Object | Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    union Union = Object
    
    extend union Union = Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    extend union Union = Object
    
    union Union = Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    union Union = Object
    
    type Object {
      name: String!
    }
  `),
};

const subgraphAE: Subgraph = {
  name: 'subgraph-ae',
  url: '',
  definitions: parse(`
    extend union Union = AnotherObject
    
    type AnotherObject {
      name: String!
    }
  `),
};
