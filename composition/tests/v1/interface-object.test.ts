import { describe, expect, test } from 'vitest';
import { invalidInterfaceObjectImplementationDefinitionsError, Subgraph } from '../../src';
import { parse } from 'graphql';
import { federateSubgraphsFailure } from '../utils/utils';
import { ROUTER_COMPATIBILITY_VERSION_ONE } from '../../src';

describe('@interfaceObject tests', () => {
  test('that an error is returned if implementations are defined alongside an entity declared with @interfaceObject', () => {
    const result = federateSubgraphsFailure([a, b], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
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
