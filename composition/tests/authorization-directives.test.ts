import { describe, expect, test } from 'vitest';
import { federateSubgraphs, Subgraph } from '../src';
import { parse } from 'graphql';
import { documentNodeToNormalizedString, normalizeString, versionTwoPersistedBaseSchema } from './utils/utils';

describe('Authorization Directives Tests', () => {
  describe('Federation Tests', () => {
    test('that @authenticated is persisted in the federated schema', () => {
      const { errors, federationResult} = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionTwoPersistedBaseSchema + `
          type Query {
            object: Object!
          }
          
          type Object @authenticated {
            id: ID!
            name: String!
            age: Int!
          }
        `)
      );
    });

    test('that @requiresScopes is persisted in the federated schema', () => {
      const { errors, federationResult} = federateSubgraphs([subgraphB, subgraphC]);
      expect(errors).toBeUndefined();
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionTwoPersistedBaseSchema + `
          type Object @requiresScopes(scopes: [["read:object"]]) {
            id: ID!
            age: Int!
            name: String!
          }
          
          type Query {
            object: Object!
          }
        `)
      );
    });
  });
  describe('Router Configuration Tests', () => {
    test('that @authenticated generates the correct router configuration', () => {

    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @authenticated {
      id: ID!
      name: String!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Object @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @requiresScopes(scopes: [["read:object"]]) {
      id: ID!
      name: String!
    }
  `),
};