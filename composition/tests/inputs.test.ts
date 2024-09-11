import {
  duplicateInputFieldDefinitionError,
  federateSubgraphs,
  incompatibleInputValueDefaultValueTypeError,
  INPUT_OBJECT,
  invalidRequiredInputValueError,
  noInputValueDefinitionsError,
  normalizeSubgraph,
  parse,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
} from './utils/utils';

describe('Input tests', () => {
  describe('Normalization tests', () => {
    test('that an Input Object extension orphan is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphM.definitions, subgraphM.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphQ.definitions, subgraphQ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphR.definitions, subgraphR.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphS.definitions, subgraphS.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphT.definitions, subgraphT.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphU.definitions, subgraphU.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphV.definitions, subgraphV.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphW.definitions, subgraphW.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraph(subgraphX.definitions, subgraphX.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors } = normalizeSubgraph(subgraphE.definitions, subgraphE.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a final Input Object extension does not define values', () => {
      const { errors } = normalizeSubgraph(subgraphF.definitions, subgraphF.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a final extended Input Object does not define any values #1', () => {
      const { errors } = normalizeSubgraph(subgraphG.definitions, subgraphG.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a final extended Input Object does not define any values #2', () => {
      const { errors } = normalizeSubgraph(subgraphH.definitions, subgraphH.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noInputValueDefinitionsError('Input'));
    });

    test('that an error is returned if a an Input Object defines a duplicate value', () => {
      const { errors } = normalizeSubgraph(subgraphI.definitions, subgraphI.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if a an Input Object extension defines a duplicate value #1', () => {
      const { errors } = normalizeSubgraph(subgraphJ.definitions, subgraphJ.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if a an extended Input Object defines a duplicate value #1', () => {
      const { errors } = normalizeSubgraph(subgraphK.definitions, subgraphK.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });

    test('that an error is returned if a an extended Input Object defines a duplicate value #2', () => {
      const { errors } = normalizeSubgraph(subgraphL.definitions, subgraphL.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateInputFieldDefinitionError('Input', 'name'));
    });
  });

  describe('Federation tests', () => {
    test('that Input Objects merge by intersection if the removed values are nullable', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
      const { errors } = federateSubgraphs([subgraphA, subgraphC]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
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

    test('that @deprecated is persisted on an Input Field', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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

    test('that Float Input Field accept integer default values', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphWithInputField('subgraph', 'Float = 1')]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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

    test('that an error is returned if a required Input Values uses a null default value', () => {
      const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'String! = null')]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input Field "field"', 'Input.field', 'String!', 'null'),
        ]),
      );
    });

    test.skip('that an error is returned if a required input field uses an object default value', () => {
      const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'String! = { field: "value" }')]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input Field "name"', 'Input.name', 'String!', 'null'),
        ]),
      );
    });

    test.skip('that an error is returned if a required input field uses an enum default value', () => {
      const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'String! = VALUE')]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input Field "field"', 'Input.field', 'String!', 'VALUE'),
        ]),
      );
    });

    test('that an error is returned if a required argument uses a null default value', () => {
      const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'Boolean! = null')]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input Field "field"', 'Input.field', 'Boolean!', 'null'),
        ]),
      );
    });

    test('that an error is returned if a required argument defines an incompatible default value', () => {
      const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'Int = "test"')]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input Field "field"', 'Input.field', 'Int', '"test"'),
        ]),
      );
    });

    test('that an error is returned if an Int input receives a float default value', () => {
      const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'Int = 1.0')]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph', [
          incompatibleInputValueDefaultValueTypeError('Input Field "field"', 'Input.field', 'Int', '1.0'),
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
