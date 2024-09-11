import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  duplicateFieldDefinitionError,
  federateSubgraphs,
  noBaseDefinitionForExtensionError,
  noFieldDefinitionsError,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  OBJECT,
  parse,
  Subgraph,
} from '../src';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneBaseSchema,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('Object tests', () => {
  describe('Normalization tests', () => {
    test('that an Object extension orphan is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphJ.definitions, subgraphJ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            age: Int!
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            age: Int!
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphQ.definitions, subgraphQ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #3', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphR.definitions, subgraphR.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #4', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphS.definitions, subgraphS.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #5', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphT.definitions, subgraphT.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphU.definitions, subgraphU.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphV.definitions, subgraphV.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object extension can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphW.definitions, subgraphW.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object extension can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphX.definitions, subgraphX.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a final Object defines no Fields', () => {
      const { errors } = normalizeSubgraph(subgraphA.definitions, subgraphA.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final Object extension defines no Fields', () => {
      const { errors } = normalizeSubgraph(subgraphB.definitions, subgraphB.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final extended Object defines no Fields #1', () => {
      const { errors } = normalizeSubgraph(subgraphC.definitions, subgraphC.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final extended Object defines no Fields #2', () => {
      const { errors } = normalizeSubgraph(subgraphD.definitions, subgraphD.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if an Object defines a duplicate Field', () => {
      const { errors } = normalizeSubgraph(subgraphE.definitions, subgraphE.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an Object extension defines a duplicate Field', () => {
      const { errors } = normalizeSubgraph(subgraphF.definitions, subgraphF.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an extended Object defines a duplicate Field #1', () => {
      const { errors } = normalizeSubgraph(subgraphG.definitions, subgraphG.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an extended Object defines a duplicate Field #2', () => {
      const { errors } = normalizeSubgraph(subgraphH.definitions, subgraphH.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that a Query root type that defines no Fields is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Query
      `);
      expect(errors).toBeUndefined();
      expect(normalizeString(normalizationResult!.subgraphString)).toBe(
        normalizeString(
          versionOneBaseSchema +
            `
        type Query
      `,
        ),
      );
    });

    test('that a renamed Query root type that defines no Fields is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        schema {
          query: Queries
        }
        
        type Queries
      `);
      expect(errors).toBeUndefined();
      expect(normalizeString(normalizationResult!.subgraphString)).toBe(
        normalizeString(
          versionOneBaseSchema +
            `
        schema {
          query: Queries
        }
        
        type Queries
      `,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    test('that an Object type and extension definition federate successfully #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ, subgraphM]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Object {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that an Object type and extension definition federate successfully #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphM, subgraphJ]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Object {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that an error is returned if federation results in an Object extension orphan', () => {
      const { errors } = federateSubgraphs([subgraphI, subgraphJ]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that a V1 Object with @extends directive federates with a base definition #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphK, subgraphM]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Object {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that a V1 Object with @extends directive federates with a base definition #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphM, subgraphK]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Object {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #1', () => {
      const { errors } = federateSubgraphs([subgraphI, subgraphK]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #2.1', () => {
      const { errors } = federateSubgraphs([subgraphI, subgraphJ, subgraphK]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #2.2', () => {
      const { errors } = federateSubgraphs([subgraphI, subgraphK, subgraphJ]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that a V2 Object @extends directive orphan is valid #1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphL]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Object @extends directive orphan is valid with another base type #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphL, subgraphM]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
                type Object {
                  age: Int!
                  name: String!
                }

                type Query {
                  dummy: String!
                }

                scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Object @extends directive orphan is valid with another base type #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphL, subgraphM]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
                type Object {
                  age: Int!
                  name: String!
                }

                type Query {
                  dummy: String!
                }

                scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Object @extends directive orphan is valid with another extension #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ, subgraphL]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Object @extends directive orphan is valid with another extension #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphL, subgraphJ]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });
  });

  describe('Router configuration tests', () => {
    test('that an object extended within the same graph generates the correct router configuration', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          name: String!
        }
        
        extend type Object {
          age: Int!
        }
      `);

      expect(errors).toBeUndefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['age', 'name']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Object
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    extend type Object @tag(name: "test")
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Object
    extend type Object @tag(name: "test")
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    extend type Object @tag(name: "test")
    type Object
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
      name: String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
      name: String!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Object {
      name: String!  
    }
    
    extend type Object {
      name: String!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
    }
    
    type Object {
      name: String!  
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Object @extends {
      name: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Object @extends {
      name: String! @shareable
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Object {
      age: Int!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Object {
      age: Int!
    }
    
    extend type Object {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
    }
    
    type Object {
      age: Int!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Object
    
    extend type Object {
      name: String!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
    }
    
    type Object
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Object
    
    extend type Object {
      name: String!
    }
    
    extend type Object @tag(name: "name")
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
    }
    
    type Object
    
    extend type Object @tag(name: "name")
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    extend type Object @tag(name: "name")
    
    extend type Object {
      name: String!
    }
    
    type Object
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    extend type Object @tag(name: "name")
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    extend type Object @tag(name: "name")
    
    type Object {
      name: String!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    extend type Object {
      name: String!
    }

    extend type Object @tag(name: "name")
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    extend type Object @tag(name: "name")
    
    extend type Object {
      name: String!
    }
  `),
};
