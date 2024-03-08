import {
  federateSubgraphs,
  incompatibleInputValueDefaultValueTypeError,
  invalidRequiredInputValueError,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';
import { INPUT_OBJECT } from '../src/utils/string-constants';

describe('Input federation tests', () => {
  test('that inputs merge by intersection if the removed fields are nullable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneSchemaQueryAndPersistedDirectiveDefinitions +
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

  test('that a required input object field that is omitted from the federated graph returns an error', () => {
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

  test('that @deprecated is persisted on an input field', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphD]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneSchemaQueryAndPersistedDirectiveDefinitions +
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

  test('that Float inputs accept integer default values', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphWithInputField('subgraph', 'Float = 1')]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneSchemaQueryAndPersistedDirectiveDefinitions +
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

  test('that an error is returned if a required input field uses a null default value', () => {
    const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'String! = null')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('input field "field"', 'Input.field', 'String!', 'null'),
      ]),
    );
  });

  test.skip('that an error is returned if a required input field uses an object default value', () => {
    const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'String! = { field: "value" }')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('input field "name"', 'Input.name', 'String!', 'null'),
      ]),
    );
  });

  test.skip('that an error is returned if a required input field uses an enum default value', () => {
    const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'String! = VALUE')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('input field "field"', 'Input.field', 'String!', 'VALUE'),
      ]),
    );
  });

  test('that an error is returned if a required argument uses a null default value', () => {
    const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'Boolean! = null')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('input field "field"', 'Input.field', 'Boolean!', 'null'),
      ]),
    );
  });

  test('that an error is returned if a required argument defines an incompatible default value', () => {
    const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'Int = "test"')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('input field "field"', 'Input.field', 'Int', '"test"'),
      ]),
    );
  });

  test('that an error is returned if an Int input receives a float default value', () => {
    const { errors } = federateSubgraphs([subgraphWithInputField('subgraph', 'Int = 1.0')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('input field "field"', 'Input.field', 'Int', '1.0'),
      ]),
    );
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
