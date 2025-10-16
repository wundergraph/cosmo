import {
  ConfigurationData,
  EntityInterfaceFederationData,
  EntityInterfaceSubgraphData,
  INTERFACE,
  InvalidEntityInterface,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SimpleFieldData,
  Subgraph,
  undefinedEntityInterfaceImplementationsError,
} from '../../src';
import { describe, expect, test } from 'vitest';
import { versionOneRouterDefinitions, versionTwoRouterDefinitions } from './utils/utils';

import { parse } from 'graphql';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../utils/utils';

describe('Entity Interface Tests', () => {
  test('that an @interfaceObject does not need to contribute new fields', () => {
    const result = federateSubgraphsSuccess([subgraphC, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Entity implements Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      interface Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that fields contributed by an interface object are added to each concrete type', () => {
    const result = federateSubgraphsSuccess([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Entity implements Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      interface Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        interface: Interface!
      }

      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that interface objects produce the correct engine configuration', () => {
    const result = federateSubgraphsSuccess([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(true);
    const subgraphConfigBySubgraphName = result.subgraphConfigBySubgraphName;
    expect(subgraphConfigBySubgraphName).toBeDefined();
    expect(subgraphConfigBySubgraphName.get('subgraph-a')!.configurationDataByTypeName).toStrictEqual(
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
    expect(subgraphConfigBySubgraphName.get('subgraph-b')!.configurationDataByTypeName).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([subgraphE, subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      undefinedEntityInterfaceImplementationsError(
        new Map<string, InvalidEntityInterface[]>([
          [
            INTERFACE,
            [
              {
                subgraphName: 'subgraph-e',
                definedConcreteTypeNames: new Set<string>(['EntityOne', 'EntityTwo']),
                requiredConcreteTypeNames: new Set<string>(['EntityOne', 'EntityTwo', 'EntityThree']),
              },
              {
                subgraphName: 'subgraph-f',
                definedConcreteTypeNames: new Set<string>(['EntityOne', 'EntityThree']),
                requiredConcreteTypeNames: new Set<string>(['EntityOne', 'EntityTwo', 'EntityThree']),
              },
            ],
          ],
        ]),
        new Map<string, EntityInterfaceFederationData>([
          [
            INTERFACE,
            {
              concreteTypeNames: new Set<string>(['EntityOne', 'EntityTwo', 'EntityThree']),
              fieldDatasBySubgraphName: new Map<string, Array<SimpleFieldData>>(),
              interfaceFieldNames: new Set<string>(['id', 'name', 'age', 'isEntity']),
              interfaceObjectFieldNames: new Set<string>(),
              interfaceObjectSubgraphNames: new Set<string>(),
              subgraphDataByTypeName: new Map<string, EntityInterfaceSubgraphData>(),
              typeName: 'Interface',
            },
          ],
        ]),
      ),
    );
  });

  test('that an entity Interface with a @key defining resolvable: false does not need to define all implementations', () => {
    const result = federateSubgraphsSuccess([subgraphG, subgraphH], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type EntityOne implements Interface {
        id: ID!
        name: String!
      }
      type EntityTwo implements Interface {
        id: ID!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entities: [Interface!]!
      }
    `,
      ),
    );
  });

  test('that @interfaceObject works correctly with implicit key checks #.1.1', () => {
    const result = federateSubgraphsSuccess([subgraphI, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Object {
        interface: Interface!
      }
      
      type One implements Interface {
        id: ID!
        name: String!
        one: Int!
      }
      
      type Query {
        objects: [Object!]!
      }
      
      type Three implements Interface {
          id: ID!
          name: String!
          three: Int!
      }
      
      type Two implements Interface {
        id: ID!
        name: String!
        two: Int!
      }

      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that  @interfaceObject works correctly with implicit key checks #1.2', () => {
    const result = federateSubgraphsSuccess([subgraphJ, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Object {
        interface: Interface!
      }
      
      type One implements Interface {
        id: ID!
        name: String!
        one: Int!
      }
      
      type Query {
        objects: [Object!]!
      }
      
      type Three implements Interface {
          id: ID!
          name: String!
          three: Int!
      }
      
      type Two implements Interface {
        id: ID!
        name: String!
        two: Int!
      }

      scalar openfed__Scope
    `,
      ),
    );
  });

  test.skip('that an error is returned if a type declared with @interfaceObject is not an interface in other subgraphs', () => {});

  test.skip('that an error is returned if a type declared with @interfaceObject is not an entity', () => {});

  test.skip('that an error is returned if an interface object does not include the same primary keys as its interface definition', () => {});
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
      name: String! @shareable
      age: Int! @shareable
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

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id", resolvable: false) {
      id: ID!
    }
    
    type EntityOne implements Interface @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Interface!]!
    }
    
    interface Interface @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityOne implements Interface @key(fields: "id") {
      id: ID!
      name: String!
    }
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id") @key(fields: "name") {
      id: ID!
      name: String!
    }
    
    type One implements Interface @key(fields: "id") @key(fields: "name") {
      id: ID!
      name: String!
      one: Int!
    }
    
    type Two implements Interface @key(fields: "id") @key(fields: "name") {
      id: ID!
      name: String!
      two: Int!
    }
    
    type Three implements Interface @key(fields: "id") @key(fields: "name") {
        id: ID!
        name: String!
        three: Int!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id", resolvable: false) @interfaceObject {
      id: ID!
    }
    
    type Object {
      interface: Interface!
    }
    
    type Query {
      objects: [Object!]!
    }
  `),
};
