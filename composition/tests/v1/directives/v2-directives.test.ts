import { describe, expect, test } from 'vitest';
import {
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  FieldData,
  invalidFieldShareabilityError,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { versionOnePersistedBaseSchema, versionTwoRouterDefinitions } from '../utils/utils';
import { documentNodeToNormalizedString, normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';

describe('V2 Directives Tests', () => {
  test('that external fields do not produce shareable errors', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphB, subgraphC],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
    const result = federateSubgraphs(
      [subgraphA, subgraphB, subgraphE],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(documentNodeToNormalizedString(result.federatedGraphAST)).toBe(
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
    const result = federateSubgraphs(
      [subgraphC, subgraphD],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          name: 'Entity',
          fieldDataByName: new Map<string, FieldData>([
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
