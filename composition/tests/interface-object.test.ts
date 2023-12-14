import { federateSubgraphs, Subgraph } from '../src';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  versionOnePersistedBaseSchema,
  versionTwoPersistedBaseSchema,
} from './utils/utils';

import { parse } from 'graphql';
describe('@interfaceObject Tests', () => {
  test('that an @interfaceObject does not need to contribute new fields', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphD]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(normalizeString(versionTwoPersistedBaseSchema + `
      interface Interface {
        id: ID!
        name: String!
        age: Int!
      }
      
      type Query {
        dummy: String!
      }

      type Entity implements Interface {
        id: ID!
        name: String!
        age: Int!
      }
    `));
  });

  test('that fields contributed by an interface object are added to each concrete type', () => {
    const { errors, federationResult } = federateSubgraphs(
      [subgraphA, subgraphB],
    );
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST))
      .toBe(normalizeString(versionTwoPersistedBaseSchema + `
      interface Interface {
        id: ID!
        name: String!
        age: Int!
      }
      
      type Query {
        interface: Interface!
      }

      type Entity implements Interface {
        id: ID!
        name: String!
        age: Int!
      }
    `));
  });

  test.skip('that an error is returned if a type declared with @interfaceObject is not an interface in other subgraphs', () => {
  });


  test.skip('that an error is returned if a type declared with @interfaceObject is not an entity' ,() => {

  });

  test.skip('that an error is returned if an interface object does not include the same primary keys as its interface definition' ,() => {

  });

  test.skip('that an error is returned if the concerete types that implement the entity interface are present in the same graph as the interface object', () => {

  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id") {
      id: ID!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      interface: Interface!
    }
    
    type Interface @key(fields: "id") @interfaceObject {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    interface Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
    
    type Entity implements Interface @key(fields: "id") {
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
    type Interface @key(fields: "id") @interfaceObject {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};