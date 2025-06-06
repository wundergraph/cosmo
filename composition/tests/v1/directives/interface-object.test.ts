import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  invalidInterfaceObjectImplementationDefinitionsError,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { parse } from 'graphql';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { versionTwoRouterDefinitions } from '../utils/utils';

describe('@interfaceObject tests', () => {
  test('that an error is returned if implementations are defined alongside an entity declared with @interfaceObject', () => {
    const result = federateSubgraphsFailure([faa, fab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidInterfaceObjectImplementationDefinitionsError('Interface', faa.name, ['EntityOne', 'EntityTwo']),
    );
  });

  test('that an Object can inherit fields from an Interface Object #1.1', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [fbb, fbc],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type EntityA implements InterfaceA {
        id: ID!
        name: String!
        object: ObjectA!
      }
      
      type EntityB implements InterfaceB {
        entity: EntityC!
        id: ID!
        name: String!
      }
      
      type EntityC {
        id: ID!
        name: String!
      }
      
      interface InterfaceA {
        id: ID!
        object: ObjectA!
      }
      
      interface InterfaceB {
        entity: EntityC!
        id: ID!
      }

      type ObjectA {
        name: String!
      }
      
      type Query {
        a: EntityA!
        b: EntityB!
        interfaceAs: [InterfaceA!]!
        interfaceBs: [InterfaceB!]!
      }
      
      scalar openfed__Scope
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'InterfaceA',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityA']),
            fieldNames: new Set<string>(['id', 'object']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceA',
          },
        ],
        [
          'InterfaceB',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityB']),
            fieldNames: new Set<string>(['id', 'entity']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceB',
          },
        ],
        [
          'EntityC',
          {
            fieldNames: new Set<string>(['id', 'name']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityC',
          },
        ],
        [
          'ObjectA',
          {
            fieldNames: new Set<string>(['name']),
            isRootNode: false,
            typeName: 'ObjectA',
          },
        ],
        [
          'Query',
          {
            fieldNames: new Set<string>(['interfaceAs', 'interfaceBs']),
            isRootNode: true,
            typeName: 'Query',
          },
        ],
        [
          'EntityA',
          {
            fieldNames: new Set<string>(['id', 'object']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityA',
          },
        ],
        [
          'EntityB',
          {
            fieldNames: new Set<string>(['id', 'entity']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityB',
          },
        ],
      ]),
    );
  });

  test('that an Object can inherit fields from an Interface Object #1.1', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [fbc, fbb],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type EntityA implements InterfaceA {
        id: ID!
        name: String!
        object: ObjectA!
      }
      
      type EntityB implements InterfaceB {
        entity: EntityC!
        id: ID!
        name: String!
      }
      
      type EntityC {
        id: ID!
        name: String!
      }
      
      interface InterfaceA {
        id: ID!
        object: ObjectA!
      }
      
      interface InterfaceB {
        entity: EntityC!
        id: ID!
      }

      type ObjectA {
        name: String!
      }
      
      type Query {
        a: EntityA!
        b: EntityB!
        interfaceAs: [InterfaceA!]!
        interfaceBs: [InterfaceB!]!
      }
      
      scalar openfed__Scope
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'InterfaceA',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityA']),
            fieldNames: new Set<string>(['id', 'object']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceA',
          },
        ],
        [
          'InterfaceB',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityB']),
            fieldNames: new Set<string>(['id', 'entity']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceB',
          },
        ],
        [
          'EntityC',
          {
            fieldNames: new Set<string>(['id', 'name']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityC',
          },
        ],
        [
          'ObjectA',
          {
            fieldNames: new Set<string>(['name']),
            isRootNode: false,
            typeName: 'ObjectA',
          },
        ],
        [
          'Query',
          {
            fieldNames: new Set<string>(['interfaceAs', 'interfaceBs']),
            isRootNode: true,
            typeName: 'Query',
          },
        ],
        [
          'EntityA',
          {
            fieldNames: new Set<string>(['id', 'object']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityA',
          },
        ],
        [
          'EntityB',
          {
            fieldNames: new Set<string>(['id', 'entity']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityB',
          },
        ],
      ]),
    );
  });

  test('that an Object can inherit fields from multiple Interface Objects #1.1', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [fba, fbc],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type EntityA implements InterfaceA & InterfaceB {
        entity: EntityC!
        id: ID!
        name: String!
        object: ObjectA!
      }
      
      type EntityB implements InterfaceB {
        entity: EntityC!
        id: ID!
        name: String!
      }
      
      type EntityC {
        id: ID!
        name: String!
      }
      
      interface InterfaceA {
        id: ID!
        object: ObjectA!
      }
      
      interface InterfaceB {
        entity: EntityC!
        id: ID!
      }

      type ObjectA {
        name: String!
      }
      
      type Query {
        a: EntityA!
        b: EntityB!
        interfaceAs: [InterfaceA!]!
        interfaceBs: [InterfaceB!]!
      }
      
      scalar openfed__Scope
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'InterfaceA',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityA']),
            fieldNames: new Set<string>(['id', 'object']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceA',
          },
        ],
        [
          'InterfaceB',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityA', 'EntityB']),
            fieldNames: new Set<string>(['id', 'entity']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceB',
          },
        ],
        [
          'EntityC',
          {
            fieldNames: new Set<string>(['id', 'name']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityC',
          },
        ],
        [
          'ObjectA',
          {
            fieldNames: new Set<string>(['name']),
            isRootNode: false,
            typeName: 'ObjectA',
          },
        ],
        [
          'Query',
          {
            fieldNames: new Set<string>(['interfaceAs', 'interfaceBs']),
            isRootNode: true,
            typeName: 'Query',
          },
        ],
        [
          'EntityA',
          {
            fieldNames: new Set<string>(['id', 'object', 'entity']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityA',
          },
        ],
        [
          'EntityB',
          {
            fieldNames: new Set<string>(['id', 'entity']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityB',
          },
        ],
      ]),
    );
  });

  test('that an Object can inherit fields from multiple Interface Objects #1.2', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [fbc, fba],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type EntityA implements InterfaceA & InterfaceB {
        entity: EntityC!
        id: ID!
        name: String!
        object: ObjectA!
      }
      
      type EntityB implements InterfaceB {
        entity: EntityC!
        id: ID!
        name: String!
      }
      
      type EntityC {
        id: ID!
        name: String!
      }
      
      interface InterfaceA {
        id: ID!
        object: ObjectA!
      }
      
      interface InterfaceB {
        entity: EntityC!
        id: ID!
      }

      type ObjectA {
        name: String!
      }
      
      type Query {
        a: EntityA!
        b: EntityB!
        interfaceAs: [InterfaceA!]!
        interfaceBs: [InterfaceB!]!
      }
      
      scalar openfed__Scope
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'InterfaceA',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityA']),
            fieldNames: new Set<string>(['id', 'object']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceA',
          },
        ],
        [
          'InterfaceB',
          {
            entityInterfaceConcreteTypeNames: new Set<string>(['EntityA', 'EntityB']),
            fieldNames: new Set<string>(['id', 'entity']),
            isInterfaceObject: true,
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'InterfaceB',
          },
        ],
        [
          'EntityC',
          {
            fieldNames: new Set<string>(['id', 'name']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityC',
          },
        ],
        [
          'ObjectA',
          {
            fieldNames: new Set<string>(['name']),
            isRootNode: false,
            typeName: 'ObjectA',
          },
        ],
        [
          'Query',
          {
            fieldNames: new Set<string>(['interfaceAs', 'interfaceBs']),
            isRootNode: true,
            typeName: 'Query',
          },
        ],
        [
          'EntityA',
          {
            fieldNames: new Set<string>(['id', 'object', 'entity']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityA',
          },
        ],
        [
          'EntityB',
          {
            fieldNames: new Set<string>(['id', 'entity']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id' }],
            typeName: 'EntityB',
          },
        ],
      ]),
    );
  });
});

const faa: Subgraph = {
  name: 'faa',
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

const fab: Subgraph = {
  name: 'fab',
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

const fba: Subgraph = {
  name: 'fba',
  url: '',
  definitions: parse(`
    interface InterfaceA @key(fields: "id") {
      id: ID!
    }
    
    interface InterfaceB @key(fields: "id") {
      id: ID!
    }
    
    type EntityA implements InterfaceA & InterfaceB @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityB implements InterfaceB @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type Query {
      a: EntityA!
      b: EntityB!
    }
  `),
};

const fbb: Subgraph = {
  name: 'fbb',
  url: '',
  definitions: parse(`
    interface InterfaceA @key(fields: "id") {
      id: ID!
    }
    
    interface InterfaceB @key(fields: "id") {
      id: ID!
    }
    
    type EntityA implements InterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityB implements InterfaceB @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type Query {
      a: EntityA!
      b: EntityB!
    }
  `),
};

const fbc: Subgraph = {
  name: 'fbc',
  url: '',
  definitions: parse(`
    type InterfaceA @key(fields: "id") @interfaceObject {
      id: ID!
      object: ObjectA!
    }
    
    type InterfaceB @key(fields: "id") @interfaceObject {
      id: ID!
      entity: EntityC!
    }
    
    type EntityC @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type ObjectA {
      name: String!
    }
    
    type Query {
      interfaceAs: [InterfaceA!]!
      interfaceBs: [InterfaceB!]!
    }
  `),
};
