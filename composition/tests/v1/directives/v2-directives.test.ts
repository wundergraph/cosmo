import { describe, expect, test } from 'vitest';
import {
  FieldData,
  invalidFieldShareabilityError,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('V2 Directives Tests', () => {
  test('that external fields do not produce shareable errors', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphA, subgraphB, subgraphC],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type Entity {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
      `,
      ),
    );
  });

  test('that if all fields but one are external, no shareable error is returned', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphA, subgraphB, subgraphE],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type Entity {
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
      `,
      ),
    );
  });

  test('that unshareable fields defined in multiple subgraphs return an error', () => {
    const { errors } = federateSubgraphsFailure([subgraphC, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
