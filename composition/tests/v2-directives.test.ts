import { describe, expect, test } from 'vitest';
import { federateSubgraphs, FieldData, invalidFieldShareabilityError, ObjectDefinitionData, Subgraph } from '../src';
import {
  documentNodeToNormalizedString,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOnePersistedBaseSchema,
  versionTwoRouterDefinitions,
} from './utils/utils';
import { parse } from 'graphql';

describe('V2 Directives Tests', () => {
  test('that external fields do not produce shareable errors', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB, subgraphC]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
        
        scalar openfed__Scope
      `,
      ),
    );
  });

  test('that if all fields but one are external, no shareable error is returned', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB, subgraphE]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
        type Query {
          query: Entity!
        }
        
        type Entity {
          id: ID!
          name: String!
        }
      `,
      ),
    );
  });

  test('that unshareable fields defined in multiple subgraphs return an error', () => {
    const { errors } = federateSubgraphs([subgraphC, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          name: 'Entity',
          fieldDataByFieldName: new Map<string, FieldData>([
            [
              'age',
              {
                isShareableBySubgraphName: new Map<string, boolean>([
                  ['subgraph-c', true],
                  ['subgraph-d', false],
                ]),
              } as FieldData,
            ],
          ]),
        } as ObjectDefinitionData,
        new Set<string>(['age']),
      ),
    );
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
