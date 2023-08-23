import { federateSubgraphs, federationRequiredInputFieldError, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOneBaseSchema } from './utils/utils';

describe('Input federation tests', () => {
  test('that inputs merge by intersection if the removed fields are nullable', () => {
    const result = federateSubgraphs([subgraphA, subgraphB]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      input TechnicalMachine {
        move: String!
        number: Int!
      }
    `,
      ),
    );
  });

  // TODO shouldn't be a throw
  test('that a required input object field that is omitted from the federated graph returns an error', () => {
    // const result = federateSubgraphs([subgraphA, subgraphC]);
    const parentName = 'TechnicalMachine';
    const fieldName = 'move';
    expect(() => federateSubgraphs([subgraphA, subgraphC])).toThrowError(
      federationRequiredInputFieldError(parentName, fieldName).message,
    );
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
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
