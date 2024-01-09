import {
  ConfigurationData,
  EntityInterfaceFederationData,
  federateSubgraphs,
  InvalidEntityInterface,
  Subgraph,
  undefinedEntityInterfaceImplementationsError,
} from '../src';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionTwoPersistedBaseSchema } from './utils/utils';

import { parse } from 'graphql';

describe('Entity Interface Tests', () => {
  test('that an @interfaceObject does not need to contribute new fields', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphD]);
    expect(errors).toBeUndefined();
    const federatedGraph = federationResult!.federatedGraphAST;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
        `
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
    `,
      ),
    );
  });

  test('that fields contributed by an interface object are added to each concrete type', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema +
        `
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
    `,
      ),
    );
  });

  test('that interface objects produce the correct engine configuration', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    const subgraphConfigBySubgraphName = federationResult!.subgraphConfigBySubgraphName;
    expect(subgraphConfigBySubgraphName).toBeDefined();
    expect(subgraphConfigBySubgraphName.get('subgraph-a')!.configurationDataMap).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Interface',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['Entity']),
            fieldNames: new Set<string>(['id']),
            isInterfaceObject: false,
            isRootNode: true,
            typeName: 'Interface',
            keys: [{ fieldName: '', selectionSet: 'id' }],
          },
        ],
        [
          'Entity',
          {
            fieldNames: new Set<string>(['id']),
            isRootNode: true,
            typeName: 'Entity',
            keys: [{ fieldName: '', selectionSet: 'id' }],
          },
        ],
      ]),
    );
    expect(subgraphConfigBySubgraphName.get('subgraph-b')!.configurationDataMap).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Query',
          {
            fieldNames: new Set<string>(['interface']),
            isRootNode: true,
            typeName: 'Query',
          },
        ],
        [
          'Interface',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['Entity']),
            fieldNames: new Set<string>(['id', 'name', 'age']),
            isInterfaceObject: true,
            isRootNode: true,
            typeName: 'Interface',
            keys: [{ fieldName: '', selectionSet: 'id' }],
          },
        ],
        [
          'Entity',
          {
            fieldNames: new Set<string>(['id', 'name', 'age']),
            isRootNode: true,
            typeName: 'Entity',
            keys: [{ fieldName: '', selectionSet: 'id' }],
          },
        ],
      ]),
    );
  });

  test('that an error is returned if a subgraph does not define all implementations of an entity interface', () => {
    const { errors } = federateSubgraphs([subgraphE, subgraphF]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(undefinedEntityInterfaceImplementationsError(
      new Map<string, InvalidEntityInterface[]>([
        ['Interface', [
          {
            subgraphName: 'subgraph-e',
            concreteTypeNames: new Set<string>(['EntityOne', 'EntityTwo']),
          },
          {
            subgraphName: 'subgraph-f',
            concreteTypeNames: new Set<string>(['EntityOne', 'EntityThree'])
          },
        ]],
      ]),
      new Map<string, EntityInterfaceFederationData>([
        ['Interface', {
          interfaceFieldNames: new Set<string>(['id', 'name', 'age', 'isEntity']),
          interfaceObjectFieldNames: new Set<string>(),
          interfaceObjectSubgraphs: new Set<string>(),
          typeName: 'Interface',
          concreteTypeNames: new Set<string>(['EntityOne', 'EntityTwo', 'EntityThree']),
        }],
      ]),
    ));
  });

  test.skip('that an error is returned if a type declared with @interfaceObject is not an interface in other subgraphs', () => {
  });

  test.skip('that an error is returned if a type declared with @interfaceObject is not an entity', () => {
  });

  test.skip('that an error is returned if an interface object does not include the same primary keys as its interface definition', () => {
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

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      interfaces: [Interface!]!
    }
    
    interface Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
    
    type EntityOne implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }  
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id") {
      id: ID!
      isEntity: Boolean!
    }
    
    type EntityOne implements Interface @key(fields: "id") {
      id: ID!
      isEntity: Boolean!
    }
    
    type EntityThree implements Interface @key(fields: "id") {
      id: ID!
      isEntity: Boolean!
    }  
  `),
};
