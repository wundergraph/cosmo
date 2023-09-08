import { describe, expect, test } from 'vitest';
import { federateSubgraphs, ObjectContainer, shareableFieldDefinitionsError, stringToNameNode, Subgraph } from '../src';
import {
  documentNodeToNormalizedString,
  normalizeString,
  versionOnePersistedBaseSchema,
  versionTwoPersistedBaseSchema,
} from './utils/utils';
import { parse } from 'graphql';

describe('V2 Directives Tests', () => {
  test('that external fields do not produce shareable errors', () => {
    const { errors, federationResult } = federateSubgraphs(
      [subgraphA, subgraphB, subgraphC]
    );
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(versionTwoPersistedBaseSchema + `
        type Query {
          query: Entity!
        }
        
        type Entity {
          id: ID!
          name: String!
          age: Int!
        }
      `),
    );
  });

  test('that if all fields but one are external, no shareable error is returned', () => {
    const { errors, federationResult } = federateSubgraphs(
      [subgraphA, subgraphB, subgraphE]
    );
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(versionOnePersistedBaseSchema + `
        type Query {
          query: Entity!
        }
        
        type Entity {
          id: ID!
          name: String!
        }
      `),
    );
  });

  test('that fields defined in multiple subgraphs with shareable return an error', () => {
    const { errors } = federateSubgraphs(
      [subgraphC, subgraphD]
    );
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(shareableFieldDefinitionsError(
      {
        node: { name: stringToNameNode('Entity') },
        fields: new Map<string, any>([
          ['age', {
            node: { name: stringToNameNode('age'), subgraphs: new Set<string>(['subgraph-c']) },
            subgraphsByShareable: new Map<string, boolean>([['subgraph-c', true], ['subgraph-d', false]]),
          }],
        ]),
      } as ObjectContainer,
      new Set<string>(['age']),
    ));
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      query: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @external
    }    
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    } 
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Entity @shareable @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
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
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable
      age: Int!
    } 
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @external
    }    
  `),
};
