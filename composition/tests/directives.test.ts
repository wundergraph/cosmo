import { federateSubgraphs, normalizeSubgraphFromString, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionOnePersistedBaseSchema } from './utils/utils';

describe('Directive tests', () => {
  describe('Normalization tests', () => {
    test('that @specifiedBy is supported', () => {
      const { errors } = normalizeSubgraphFromString(subgraphAString);
      expect(errors).toBeUndefined();
    });
  });

  describe('Federation tests', () => {
    test('that @specifiedBy is supported', () => {
      const { errors, federationResult, f } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionOnePersistedBaseSchema +
            `
          type Query {
            json: JSON!
            field: String!
          }
          
          scalar JSON
        `,
        ),
      );
    });
  });
});

const subgraphAString = `
  type Query {
    json: JSON!
  }
  
  scalar JSON @specifiedBy(url: "https://wundergraph.com")
`;

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(subgraphAString),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
  type Query {
    field: String!
  }`),
};
