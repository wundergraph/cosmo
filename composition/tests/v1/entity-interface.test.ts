import {
  ConfigurationData,
  EntityInterfaceFederationData,
  EntityInterfaceSubgraphData,
  incompatibleParentTypeMergeError,
  INTERFACE,
  InterfaceDefinitionData,
  InvalidEntityInterface,
  OBJECT,
  ObjectDefinitionData,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SimpleFieldData,
  Subgraph,
  SubgraphName,
  undefinedEntityInterfaceImplementationsError,
} from '../../src';
import { describe, expect, test } from 'vitest';
import { SCHEMA_QUERY_DEFINITION } from './utils/utils';

import { Kind, parse } from 'graphql';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../utils/utils';

describe('Entity Interface Tests', () => {
  test('that an @interfaceObject does not need to contribute new fields', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphC, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    `,
      ),
    );
  });

  test('that fields contributed by an interface object are added to each concrete type', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    `,
      ),
    );
  });

  test('that interface objects produce the correct engine configuration', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [subgraphA, subgraphB],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
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
    const { federatedGraphSchema, warnings } = federateSubgraphsSuccess(
      [subgraphG, subgraphH],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(warnings).toHaveLength(0);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphI, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    `,
      ),
    );
  });

  test('that @interfaceObject works correctly with implicit key checks #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphJ, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    `,
      ),
    );
  });

  test('that error is returned if an entity Interface is defined as a regular Object type #1', () => {
    const { errors } = federateSubgraphsFailure([kaaa, kaab, kaac], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    const existingData = {
      kind: Kind.INTERFACE_TYPE_DEFINITION,
      name: INTERFACE,
      subgraphNames: new Set<SubgraphName>([kaaa.name, kaab.name]),
    } as InterfaceDefinitionData;
    expect(errors).toStrictEqual([
      incompatibleParentTypeMergeError({
        existingData,
        incomingNodeType: OBJECT,
        incomingSubgraphName: kaac.name,
      }),
    ]);
  });

  test('that error is returned if an entity Interface is defined as a regular Object type #2', () => {
    const { errors } = federateSubgraphsFailure([kaac, kaab, kaaa], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    const existingData = {
      kind: Kind.OBJECT_TYPE_DEFINITION,
      name: INTERFACE,
      subgraphNames: new Set<SubgraphName>([kaac.name]),
    } as ObjectDefinitionData;
    expect(errors).toStrictEqual([
      incompatibleParentTypeMergeError({
        existingData,
        incomingSubgraphName: kaab.name,
      }),
      incompatibleParentTypeMergeError({
        existingData,
        incomingNodeType: INTERFACE,
        incomingSubgraphName: kaaa.name,
      }),
    ]);
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

const kaaa: Subgraph = {
  name: 'kaaa',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id", resolvable: false) {
      id: ID!
    }
    
    type Query {
      a: ID
    }
  `),
};

const kaab: Subgraph = {
  name: 'kaab',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id", resolvable: false) @interfaceObject {
      id: ID!
    }
  `),
};

const kaac: Subgraph = {
  name: 'kaac',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id", resolvable: false) {
      id: ID!
    }
  `),
};
