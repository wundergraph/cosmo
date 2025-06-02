import {
  duplicateInputFieldDefinitionError,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  incompatibleInputValueDefaultValueTypeError,
  INPUT_OBJECT,
  InputValueData,
  invalidNamedTypeError,
  invalidRequiredInputValueError,
  noInputValueDefinitionsError,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  subgraphValidationError,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import { baseDirectiveDefinitions, stringToTypeNode, versionOneRouterDefinitions } from '../utils/utils';
import { normalizeString, normalizeSubgraphFailure, schemaToSortedNormalizedString } from '../../utils/utils';
import { Kind } from 'graphql';

describe('Input tests', () => {
  describe('Normalization tests', () => {
    test('that an Input Object extension orphan is valid', () => {
      const result = normalizeSubgraph(
        subgraphM.definitions,
        subgraphM.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          input Input {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object can be extended #1', () => {
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
          input Input {
            age: Int!
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object can be extended #2', () => {
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
          input Input {
            age: Int!
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object stub can be extended #1', () => {
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
          input Input {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object stub can be extended #2', () => {
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
          input Input {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object stub can be extended #3', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object stub can be extended #4', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object stub can be extended #5', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object can be extended with just a directive #1', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object can be extended with just a directive #2', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object extension can be extended with just a directive #1', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Input Object extension can be extended with just a directive #2', () => {
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
          input Input @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a final Input Object does not define any values', () => {
      const result = normalizeSubgraph(
        subgraphE.definitions,
        subgraphE.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a final Input Object extension does not define values', () => {
      const result = normalizeSubgraph(
        subgraphF.definitions,
        subgraphF.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a final extended Input Object does not define any values #1', () => {
      const result = normalizeSubgraph(
        subgraphG.definitions,
        subgraphG.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a final extended Input Object does not define any values #2', () => {
      const result = normalizeSubgraph(
        subgraphH.definitions,
        subgraphH.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a an Input Object defines a duplicate value', () => {
      const result = normalizeSubgraph(
        subgraphI.definitions,
        subgraphI.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if a an Input Object extension defines a duplicate value #1', () => {
      const result = normalizeSubgraph(
        subgraphJ.definitions,
        subgraphJ.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if a an extended Input Object defines a duplicate value #1', () => {
      const result = normalizeSubgraph(
        subgraphK.definitions,
        subgraphK.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if a an extended Input Object defines a duplicate value #2', () => {
      const result = normalizeSubgraph(
        subgraphL.definitions,
        subgraphL.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if an Input field returns an output node type', () => {
      const { errors } = normalizeSubgraphFailure(naa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidNamedTypeError({
          data: {
            kind: Kind.INPUT_VALUE_DEFINITION,
            originalCoords: 'Input.field',
            type: stringToTypeNode('EntityInterface!'),
          } as InputValueData,
          namedTypeData: { kind: Kind.OBJECT_TYPE_DEFINITION, name: 'EntityInterface' } as ObjectDefinitionData,
          nodeType: 'Input Object field',
        }),
      );
    });
  });

  describe('Federation tests', () => {
    test('that Input Objects merge by intersection if the removed values are nullable', () => {
      const result = federateSubgraphs(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Query {
              dummy: String!
            }

            input TechnicalMachine {
              move: String!
              number: Int!
            }
          `,
        ),
      );
    });

    test('that a required Input Object value that is omitted from the federated graph returns an error', () => {
      const result = federateSubgraphs(
        [subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidRequiredInputValueError(
          INPUT_OBJECT,
          'TechnicalMachine',
          [
            { inputValueName: 'move', missingSubgraphs: ['subgraph-c'], requiredSubgraphs: ['subgraph-a'] },
            { inputValueName: 'number', missingSubgraphs: ['subgraph-c'], requiredSubgraphs: ['subgraph-a'] },
          ],
          false,
        ),
      );
    });

    test('that @deprecated is persisted on an Input field', () => {
      const result = federateSubgraphs([subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input {
              id: ID
              name: String @deprecated(reason: "use id")
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that Float Input field accept integer default values', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'Float = 1')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input {
              field: Float = 1
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an error is returned if a required Input field uses a null default value', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'String! = null')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input field "field"', 'Input.field', 'String!', 'null'),
        ]),
      );
    });

    test.skip('that an error is returned if a required Input field uses an object default value', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'String! = { field: "value" }')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input field "name"', 'Input.name', 'String!', 'null'),
        ]),
      );
    });

    // @TODO a String input should coerce a default value string without quotations into a string
    test.skip('that an error is returned if a required Input field uses an enum default value', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'String! = VALUE')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input field "field"', 'Input.field', 'String!', 'VALUE'),
        ]),
      );
    });

    test('that an error is returned if a required argument uses a null default value', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'Boolean! = null')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input field "field"', 'Input.field', 'Boolean!', 'null'),
        ]),
      );
    });

    test('that an error is returned if a required argument defines an incompatible default value', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'Int = "test"')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input field "field"', 'Input.field', 'Int', '"test"'),
        ]),
      );
    });

    test('that an error is returned if an Int input receives a float default value', () => {
      const result = federateSubgraphs(
        [subgraphWithInputField('subgraph', 'Int = 1.0')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input field "field"', 'Input.field', 'Int', '1.0'),
        ]),
      );
    });
  });
});

function subgraphWithInputField(name: string, typeName: string): Subgraph {
  return {
    name,
    url: '',
    definitions: parse(`
      type Query {
        dummy: String!
      }

      input Input {
        field: ${typeName}
      }
    `),
  };
}

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    input TechnicalMachine {
      move: String!
      number: Int!
      name: String
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    input TechnicalMachine {
      move: String
      number: Int
      cost: Float
      reusable: Boolean
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    input TechnicalMachine {
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    input Input {
      name: String @deprecated(reason: "use id")
      id: ID
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    input Input
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    extend input Input @tag(name: "test")
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    input Input
    extend input Input @tag(name: "test")
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    extend input Input @tag(name: "test")
    input Input
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    input Input {
      name: String!
      name: String!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
      name: String!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    input Input {
      name: String!
    }
    
    extend input Input {
      name: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
    }
    
    input Input {
      name: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    input Input {
      age: Int!  
    }
    
    extend input Input {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
    }
    
    input Input {
      age: Int!  
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    input Input
    
    extend input Input {
      name: String!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
    }
    
    input Input
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    input Input
    
    extend input Input {
      name: String!
    }
    
    extend input Input @tag(name: "name")
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
    }
    
    input Input
    
    extend input Input @tag(name: "name")
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    extend input Input @tag(name: "name")
    
    extend input Input {
      name: String!
    }
    
    input Input
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    input Input {
      name: String!
    }
    
    extend input Input @tag(name: "name")
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    extend input Input @tag(name: "name")
    
    input Input {
      name: String!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String!
    }

    extend input Input @tag(name: "name")
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    extend input Input @tag(name: "name")
    
    extend input Input {
      name: String!
    }
  `),
};

const naa: Subgraph = {
  name: 'naa',
  url: '',
  definitions: parse(`
    type EntityInterface @key(fields: "id") @interfaceObject {
      id: ID!
    }
    
    input Input {
      field: EntityInterface!
    }
  `),
};
