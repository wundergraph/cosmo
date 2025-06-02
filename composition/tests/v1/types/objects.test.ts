import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  duplicateFieldDefinitionError,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  FieldData,
  InputObjectDefinitionData,
  invalidNamedTypeError,
  noBaseDefinitionForExtensionError,
  noFieldDefinitionsError,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  OBJECT,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import {
  baseDirectiveDefinitions,
  stringToTypeNode,
  versionOneBaseSchema,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from '../utils/utils';
import { normalizeString, normalizeSubgraphFailure, schemaToSortedNormalizedString } from '../../utils/utils';
import { Kind } from 'graphql';

describe('Object tests', () => {
  describe('Normalization tests', () => {
    test('that an Object extension orphan is valid', () => {
      const result = normalizeSubgraph(
        subgraphJ.definitions,
        subgraphJ.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphN.definitions,
        subgraphN.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphO.definitions,
        subgraphO.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphP.definitions,
        subgraphP.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
          type Object {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #3', () => {
      const result = normalizeSubgraph(
        subgraphR.definitions,
        subgraphR.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object stub can be extended #5', () => {
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
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object can be extended with just a directive #1', () => {
      const result = normalizeSubgraph(
        subgraphU.definitions,
        subgraphU.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object extension can be extended with just a directive #1', () => {
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
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Object extension can be extended with just a directive #2', () => {
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
          type Object @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a final Object defines no Fields', () => {
      const result = normalizeSubgraph(
        subgraphA.definitions,
        subgraphA.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final Object extension defines no Fields', () => {
      const result = normalizeSubgraph(
        subgraphB.definitions,
        subgraphB.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final extended Object defines no Fields #1', () => {
      const result = normalizeSubgraph(
        subgraphC.definitions,
        subgraphC.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final extended Object defines no Fields #2', () => {
      const result = normalizeSubgraph(
        subgraphD.definitions,
        subgraphD.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if an Object defines a duplicate Field', () => {
      const result = normalizeSubgraph(
        subgraphE.definitions,
        subgraphE.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an Object extension defines a duplicate Field', () => {
      const result = normalizeSubgraph(
        subgraphF.definitions,
        subgraphF.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an extended Object defines a duplicate Field #1', () => {
      const result = normalizeSubgraph(
        subgraphG.definitions,
        subgraphG.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an extended Object defines a duplicate Field #2', () => {
      const result = normalizeSubgraph(
        subgraphH.definitions,
        subgraphH.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that a Query root type that defines no Fields is valid', () => {
      const result = normalizeSubgraphFromString(
        `
        type Query
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(normalizeString(result.subgraphString)).toBe(
        normalizeString(
          versionOneBaseSchema +
            `
        type Query
      `,
        ),
      );
    });

    test('that a renamed Query root type that defines no Fields is valid', () => {
      const result = normalizeSubgraphFromString(
        `
        schema {
          query: Queries
        }
        
        type Queries
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(normalizeString(result.subgraphString)).toBe(
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

  test('that an error is returned if a field returns an input node type', () => {
    const { errors } = normalizeSubgraphFailure(naa, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidNamedTypeError({
        data: {
          kind: Kind.FIELD_DEFINITION,
          name: 'field',
          originalParentTypeName: 'Object',
          type: stringToTypeNode('Input!'),
        } as FieldData,
        namedTypeData: { kind: Kind.INPUT_OBJECT_TYPE_DEFINITION, name: 'Input' } as InputObjectDefinitionData,
        nodeType: 'Object field',
      }),
    );
  });

  describe('Federation tests', () => {
    test('that an Object type and extension definition federate successfully #1.1', () => {
      const result = federateSubgraphs(
        [subgraphI, subgraphJ, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphM, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that a V1 Object with @extends directive federates with a base definition #1.1', () => {
      const result = federateSubgraphs(
        [subgraphI, subgraphK, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphM, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #2.1', () => {
      const result = federateSubgraphs(
        [subgraphI, subgraphJ, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #2.2', () => {
      const result = federateSubgraphs(
        [subgraphI, subgraphK, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that a V2 Object @extends directive orphan is valid #1', () => {
      const result = federateSubgraphs(
        [subgraphI, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphL, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphL, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphJ, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphL, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = normalizeSubgraphFromString(
        `
        type Object {
          name: String!
        }
        
        extend type Object {
          age: Int!
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;

      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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

const naa: Subgraph = {
  name: 'naa',
  url: '',
  definitions: parse(`
    type Object {
      field: Input!
    }
    
    input Input {
      name: String!
    }
  `),
};
