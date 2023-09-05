import { federateSubgraphs, federationRequiredInputFieldError, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOnePersistedBaseSchema } from './utils/utils';

describe('Input federation tests', () => {
  test('that inputs merge by intersection if the removed fields are nullable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema + `
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
    const parentName = 'TechnicalMachine';
    const fieldName = 'move';
    const { errors } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(federationRequiredInputFieldError(parentName, fieldName));
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
