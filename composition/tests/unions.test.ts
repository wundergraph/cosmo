import { federateSubgraphs, invalidUnionError, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOneBaseSchema } from './utils/utils';

describe('Union federation tests', () => {
  test('that unions merge by union', () => {
    const result = federateSubgraphs([subgraphA, subgraphB]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionOneBaseSchema +
          `
      union Starters = Bulbasaur | Squirtle | Charmander | Chikorita | Totodile | Cyndaquil

      type Bulbasaur {
        name: String!
      }

      type Squirtle {
        name: String!
      }

      type Charmander {
        name: String!
      }

      type Chikorita {
        name: String!
      }

      type Totodile {
        name: String!
      }

      type Cyndaquil {
        name: String!
      }
    `,
      ),
    );
  });

  test('that unions with no members throw an error', () => {
    const result = federateSubgraphs([subgraphB, subgraphC]);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).equals(invalidUnionError('Starters').message);
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
  `),
};

const subgraphB = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
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
