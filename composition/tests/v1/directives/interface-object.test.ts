import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  FieldData,
  FieldName,
  ImplementationErrors,
  INTERFACE,
  InvalidFieldImplementation,
  invalidFieldShareabilityError,
  invalidInterfaceImplementationError,
  invalidInterfaceObjectImplementationDefinitionsError,
  ObjectDefinitionData,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  SubgraphName,
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

  test('that an Interface Object can implement another entity Interface', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fca, fcb], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type EntityA implements EntityInterfaceA {
        id: ID!
      }
      
      type EntityB implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        newField: String!
      }
      
      type EntityC implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        newField: String!
      }
      
      interface EntityInterfaceA {
        id: ID!
      }
      
      interface EntityInterfaceB implements EntityInterfaceA {
        id: ID!
        newField: String!
      }
      
      type Query {
        dummy: String!
      }
      
      scalar openfed__Scope
      `,
      ),
    );
  });

  test('that an Interface Object cannot propagate fields to other entity Interfaces', () => {
    const { errors } = federateSubgraphsFailure([fca, fcb, fcc], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidInterfaceImplementationError(
        'EntityInterfaceB',
        INTERFACE,
        new Map<string, ImplementationErrors>([
          [
            'EntityInterfaceA',
            {
              invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
              unimplementedFields: ['name'],
            },
          ],
        ]),
      ),
    );
  });

  test('that a propagating an Interface Object field through multiple Interface Objects causes @shareable errors', () => {
    const { errors } = federateSubgraphsFailure([fca, fcc, fcd], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          fieldDataByName: new Map<FieldName, FieldData>([
            [
              'name',
              {
                isShareableBySubgraphName: new Map<SubgraphName, boolean>([
                  [fcc.name, false],
                  [fcd.name, false],
                ]),
                subgraphNames: new Set<SubgraphName>([fcc.name, fcd.name]),
              } as FieldData,
            ],
          ]),
          name: 'EntityB',
        } as ObjectDefinitionData,
        new Set<FieldName>(['name']),
      ),
    );
    expect(errors[1]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          fieldDataByName: new Map<FieldName, FieldData>([
            [
              'name',
              {
                isShareableBySubgraphName: new Map<SubgraphName, boolean>([
                  [fcc.name, false],
                  [fcd.name, false],
                ]),
                subgraphNames: new Set<SubgraphName>([fcc.name, fcd.name]),
              } as FieldData,
            ],
          ]),
          name: 'EntityC',
        } as ObjectDefinitionData,
        new Set<FieldName>(['name']),
      ),
    );
  });

  test('that @shareable Interface Object fields can be propagated through multiple Interface Objects', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fca, fce, fcf], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type EntityA implements EntityInterfaceA {
        id: ID!
        name: String!
      }
      
      type EntityB implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        name: String!
      }
      
      type EntityC implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        name: String!
      }
      
      interface EntityInterfaceA {
        id: ID!
        name: String!
      }
      
      interface EntityInterfaceB implements EntityInterfaceA {
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

const fca: Subgraph = {
  name: 'fca',
  url: '',
  definitions: parse(`
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    interface EntityInterfaceB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityA implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityB implements EntityInterfaceB & EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityC implements EntityInterfaceB & EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const fcb: Subgraph = {
  name: 'fcb',
  url: '',
  definitions: parse(`
    extend interface EntityInterfaceA @key(fields: "id", resolvable: false) {
      id: ID!
    }
    
    type EntityInterfaceB implements EntityInterfaceA @key(fields: "id") @interfaceObject{
      id: ID!
      newField: String!
    }
    
    type EntityA implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
  `),
};

const fcc: Subgraph = {
  name: 'fcc',
  url: '',
  definitions: parse(`
    type EntityInterfaceA @key(fields: "id") @interfaceObject {
      id: ID!
      name: String!
    }
  `),
};

const fcd: Subgraph = {
  name: 'fcd',
  url: '',
  definitions: parse(`
    type EntityInterfaceB @key(fields: "id") @interfaceObject{
      id: ID!
      name: String!
    }
  `),
};

const fce: Subgraph = {
  name: 'fce',
  url: '',
  definitions: parse(`
    type EntityInterfaceA @key(fields: "id") @interfaceObject {
      id: ID!
      name: String! @shareable
    }
  `),
};

const fcf: Subgraph = {
  name: 'fcf',
  url: '',
  definitions: parse(`
    type EntityInterfaceB @key(fields: "id") @interfaceObject{
      id: ID!
      name: String! @shareable
    }
  `),
};
