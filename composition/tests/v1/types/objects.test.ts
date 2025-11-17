import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  duplicateFieldDefinitionError,
  FieldData,
  InputObjectDefinitionData,
  invalidNamedTypeError,
  noBaseDefinitionForExtensionError,
  noFieldDefinitionsError,
  OBJECT,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  TypeName,
} from '../../../src';
import { SCHEMA_QUERY_DEFINITION, stringToTypeNode, TAG_DIRECTIVE } from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { Kind } from 'graphql';

describe('Object tests', () => {
  describe('Normalization tests', () => {
    test('that an Object extension orphan is valid', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphJ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          type Object {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object can be extended #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphN, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          type Object {
            age: Int!
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object can be extended #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphO, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          type Object {
            age: Int!
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object stub can be extended #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphP, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          type Object {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object stub can be extended #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphQ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          type Object {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object stub can be extended #3', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphR, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object stub can be extended #4', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphS, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object stub can be extended #5', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphT, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object can be extended with just a directive #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphU, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object can be extended with just a directive #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphV, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object extension can be extended with just a directive #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphW, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an Object extension can be extended with just a directive #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphX, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          type Object @tag(name: "name") {
            name: String!
          }
        `,
        ),
      );
    });

    test('that an error is returned if a final Object defines no Fields', () => {
      const { errors } = normalizeSubgraphFailure(subgraphA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final Object extension defines no Fields', () => {
      const { errors } = normalizeSubgraphFailure(subgraphB, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final extended Object defines no Fields #1', () => {
      const { errors } = normalizeSubgraphFailure(subgraphC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if a final extended Object defines no Fields #2', () => {
      const { errors } = normalizeSubgraphFailure(subgraphD, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noFieldDefinitionsError(OBJECT, OBJECT));
    });

    test('that an error is returned if an Object defines a duplicate Field', () => {
      const { errors } = normalizeSubgraphFailure(subgraphE, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an Object extension defines a duplicate Field', () => {
      const { errors } = normalizeSubgraphFailure(subgraphF, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an extended Object defines a duplicate Field #1', () => {
      const { errors } = normalizeSubgraphFailure(subgraphG, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    test('that an error is returned if an extended Object defines a duplicate Field #2', () => {
      const { errors } = normalizeSubgraphFailure(subgraphH, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(duplicateFieldDefinitionError(OBJECT, OBJECT, 'name'));
    });

    /* Some Federation servers accept an empty query root type.
     * This is so the query can be renamed without defining any fields.
     * Then the server appends the boilerplate fields to the renamed node.
     * */
    test('that a Query root type that defines no Fields is valid', () => {
      const { schema } = normalizeSubgraphSuccess(naaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Query
      `,
        ),
      );
    });

    /* Some Federation servers accept an empty query root type.
     * This is so the query can be renamed without defining any fields.
     * Then the server appends the boilerplate fields to the renamed node.
     * */ test('that a renamed Query root type that defines no Fields is valid', () => {
      const { schema } = normalizeSubgraphSuccess(nbaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
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
    const { errors } = normalizeSubgraphFailure(ncaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
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
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphJ, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphM, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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
      const { errors } = federateSubgraphsFailure([subgraphI, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that a V1 Object with @extends directive federates with a base definition #1.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphK, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphM, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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
      const { errors } = federateSubgraphsFailure([subgraphI, subgraphK], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #2.1', () => {
      const { errors } = federateSubgraphsFailure([subgraphI, subgraphJ, subgraphK], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that an error is returned if federation results in a V1 Object with @extends directive orphan #2.2', () => {
      const { errors } = federateSubgraphsFailure([subgraphI, subgraphK, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
    });

    test('that a V2 Object @extends directive orphan is valid #1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that a V2 Object @extends directive orphan is valid with another base type #1.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphL, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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

    test('that a V2 Object @extends directive orphan is valid with another base type #1.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphL, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
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

    test('that a V2 Object @extends directive orphan is valid with another extension #1.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphJ, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that a V2 Object @extends directive orphan is valid with another extension #1.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphL, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });
  });

  describe('Router configuration tests', () => {
    test('that an object extended within the same graph generates the correct router configuration', () => {
      const { configurationDataByTypeName } = normalizeSubgraphSuccess(ndaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(configurationDataByTypeName).toStrictEqual(
        new Map<TypeName, ConfigurationData>([
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

const naaaa: Subgraph = {
  name: 'naaaa',
  url: '',
  definitions: parse(`
    type Query
  `),
};

const nbaaa: Subgraph = {
  name: 'nbaaa',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    type Queries
  `),
};

const ncaaa: Subgraph = {
  name: 'ncaaa',
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

const ndaaa: Subgraph = {
  name: 'ndaaa',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    extend type Object {
      age: Int!
    }
  `),
};

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
