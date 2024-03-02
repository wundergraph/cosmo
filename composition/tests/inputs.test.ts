import { federateSubgraphs, invalidRequiredInputFieldError, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';

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
    expect(errors![0]).toStrictEqual(invalidRequiredInputFieldError('TechnicalMachine', ['move', 'number']));
  });

  test('that @deprecated is persisted on an input value field', () => {
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
});

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
