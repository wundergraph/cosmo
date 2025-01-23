import { describe, expect, test } from 'vitest';
import { federateSubgraphs, invalidInterfaceObjectImplementationDefinitionsError, Subgraph } from '../src';
import { parse } from 'graphql';

describe('@interfaceObject tests', () => {
  test('that an error is returned if implementations are defined alongside an entity declared with @interfaceObject', () => {
    const { errors } = federateSubgraphs([a, b]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      invalidInterfaceObjectImplementationDefinitionsError('Interface', 'a', ['EntityOne', 'EntityTwo']),
    );
  });
});

const a: Subgraph = {
  name: 'a',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Interface!]!
    }
    
    type Interface @key(fields: "id") @interfaceObject {
      id: ID!
      name: String!
    }

    type EntityOne @key(fields: "id") {
      id: ID!
    }

    type EntityTwo @key(fields: "id") {
      id: ID!
    }
  `),
};

const b: Subgraph = {
  name: 'b',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id") {
      id: ID!
    }
    
    type EntityOne implements Interface @key(fields: "id") {
      id: ID!
    }

    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
    }
  `),
};
