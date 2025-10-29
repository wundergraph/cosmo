import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  EntityInterfaceFederationData,
  EntityInterfaceSubgraphData,
  FieldData,
  FieldName,
  ImplementationErrors,
  INTERFACE,
  InvalidEntityInterface,
  InvalidFieldImplementation,
  invalidFieldShareabilityError,
  invalidInterfaceImplementationError,
  invalidInterfaceObjectImplementationDefinitionsError,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SimpleFieldData,
  Subgraph,
  SubgraphName,
  TypeName,
  undefinedEntityInterfaceImplementationsError,
} from '../../../src';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';

describe('@interfaceObject tests', () => {
  test('that an error is returned if implementations are defined alongside an entity declared with @interfaceObject', () => {
    const { errors } = federateSubgraphsFailure([faa, fab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
        SCHEMA_QUERY_DEFINITION +
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
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
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
        SCHEMA_QUERY_DEFINITION +
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
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
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
        SCHEMA_QUERY_DEFINITION +
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
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
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
        SCHEMA_QUERY_DEFINITION +
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
      `,
      ),
    );
    const fbcConfig = subgraphConfigBySubgraphName.get(fbc.name);
    expect(fbcConfig).toBeDefined();
    expect(fbcConfig!.configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
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
        SCHEMA_QUERY_DEFINITION +
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

  test('that propagating an Interface Object field through multiple Interface Objects causes @shareable errors', () => {
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
        SCHEMA_QUERY_DEFINITION +
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
      `,
      ),
    );
  });

  test('that @external fields to satisfy an entity Interface are propagated from Interface Object to implementations', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fda, fdb], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Entity implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        name: String!
        newField: String!
      }
      
      interface EntityInterfaceA {
        id: ID!
        name: String!
      }
      
      interface EntityInterfaceB implements EntityInterfaceA {
        id: ID!
        name: String!
        newField: String!
      }
      
      type Query {
        interfacesA: [EntityInterfaceA]
        interfacesB: [EntityInterfaceB]
      }
      `,
      ),
    );
  });

  test('that @external fields to satisfy an Interface are propagated from Interface Object to implementations', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fda, fdc], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Entity implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        name: String!
        newField: String!
      }
      
      interface EntityInterfaceA {
        id: ID!
        name: String!
      }
      
      interface EntityInterfaceB implements EntityInterfaceA {
        id: ID!
        name: String!
        newField: String!
      }
      
      type Query {
        interfacesA: [EntityInterfaceA]
        interfacesB: [EntityInterfaceB]
      }
      `,
      ),
    );
  });

  test('that an error is returned if implementations of an entity Interface are not included in the graph or through an Interface Object', () => {
    const { errors } = federateSubgraphsFailure([fea, feb], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      undefinedEntityInterfaceImplementationsError(
        new Map<string, InvalidEntityInterface[]>([
          [
            'EntityInterfaceA',
            [
              {
                subgraphName: feb.name,
                definedConcreteTypeNames: new Set<string>(['EntityA']),
                requiredConcreteTypeNames: new Set<string>(['EntityA', 'EntityB']),
              },
            ],
          ],
        ]),
        new Map<string, EntityInterfaceFederationData>([
          [
            'EntityInterfaceA',
            {
              concreteTypeNames: new Set<string>(['EntityA', 'EntityB']),
              fieldDatasBySubgraphName: new Map<string, Array<SimpleFieldData>>(),
              interfaceFieldNames: new Set<string>(['id', 'name']),
              interfaceObjectFieldNames: new Set<string>(),
              interfaceObjectSubgraphNames: new Set<string>(),
              subgraphDataByTypeName: new Map<string, EntityInterfaceSubgraphData>(),
              typeName: 'EntityInterfaceA',
            },
          ],
        ]),
      ),
    );
  });

  test('that multiple Interface Objects can provide the implementations for an entity Interface', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([ffa, ffb], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type EntityA implements EntityInterfaceA & EntityInterfaceB {
        id: ID!
        name: String!
      }
      
      type EntityB implements EntityInterfaceA {
        id: ID!
        name: String!
      }
      
      type EntityC implements EntityInterfaceA {
        id: ID!
        name: String!
      }
      
      type EntityD implements EntityInterfaceC {
        id: ID!
        name: String!
      }
      
      type EntityE implements EntityInterfaceA & EntityInterfaceC {
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
      
      interface EntityInterfaceC {
        id: ID!
        name: String!
      }
      
      type Query {
        interfacesA: [EntityInterfaceA]
        interfacesB: [EntityInterfaceB]
        interfacesC: [EntityInterfaceC]
      }
      `,
      ),
    );
  });

  test('that an error is returned if implementations of an entity Interface are not included in the graph or through Interface Objects', () => {
    const { errors } = federateSubgraphsFailure([ffa, ffc], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      undefinedEntityInterfaceImplementationsError(
        new Map<string, InvalidEntityInterface[]>([
          [
            'EntityInterfaceA',
            [
              {
                subgraphName: ffc.name,
                definedConcreteTypeNames: new Set<string>(['EntityA', 'EntityC', 'EntityE']),
                requiredConcreteTypeNames: new Set<string>(['EntityA', 'EntityB', 'EntityC', 'EntityE']),
              },
            ],
          ],
        ]),
        new Map<string, EntityInterfaceFederationData>([
          [
            'EntityInterfaceA',
            {
              concreteTypeNames: new Set<string>(['EntityA', 'EntityB', 'EntityC', 'EntityE']),
              fieldDatasBySubgraphName: new Map<string, Array<SimpleFieldData>>(),
              interfaceFieldNames: new Set<string>(['id', 'name']),
              interfaceObjectFieldNames: new Set<string>(),
              interfaceObjectSubgraphNames: new Set<string>(),
              subgraphDataByTypeName: new Map<string, EntityInterfaceSubgraphData>(),
              typeName: 'EntityInterfaceA',
            },
          ],
        ]),
      ),
    );
  });

  test('that an error is returned if implementations of an entity Interface are included without explicit implementation of the entity Interface', () => {
    const { errors } = federateSubgraphsFailure([ffa, ffd], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      undefinedEntityInterfaceImplementationsError(
        new Map<string, InvalidEntityInterface[]>([
          [
            'EntityInterfaceA',
            [
              {
                subgraphName: ffd.name,
                definedConcreteTypeNames: new Set<string>(['EntityA', 'EntityB', 'EntityE']),
                requiredConcreteTypeNames: new Set<string>(['EntityA', 'EntityB', 'EntityC', 'EntityE']),
              },
            ],
          ],
        ]),
        new Map<string, EntityInterfaceFederationData>([
          [
            'EntityInterfaceA',
            {
              concreteTypeNames: new Set<string>(['EntityA', 'EntityB', 'EntityC', 'EntityE']),
              fieldDatasBySubgraphName: new Map<string, Array<SimpleFieldData>>(),
              interfaceFieldNames: new Set<string>(['id', 'name']),
              interfaceObjectFieldNames: new Set<string>(),
              interfaceObjectSubgraphNames: new Set<string>(),
              subgraphDataByTypeName: new Map<string, EntityInterfaceSubgraphData>(),
              typeName: 'EntityInterfaceA',
            },
          ],
        ]),
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

const fda: Subgraph = {
  name: 'fda',
  url: '',
  definitions: parse(`
    type Entity implements EntityInterfaceA & EntityInterfaceB @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type Query {
      interfacesA: [EntityInterfaceA]
      interfacesB: [EntityInterfaceB]
    }
  `),
};

const fdb: Subgraph = {
  name: 'fdb',
  url: '',
  definitions: parse(`
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityInterfaceB implements EntityInterfaceA @key(fields: "id") @interfaceObject {
      id: ID!
      name: String! @external
      newField: String!
    }
  `),
};

const fdc: Subgraph = {
  name: 'fdc',
  url: '',
  definitions: parse(`
    interface EntityInterfaceA {
      id: ID!
      name: String!
    }
    
    type EntityInterfaceB implements EntityInterfaceA @key(fields: "id") @interfaceObject {
      id: ID!
      name: String! @external
      newField: String!
    }
  `),
};

const fea: Subgraph = {
  name: 'fea',
  url: '',
  definitions: parse(`
    type EntityA implements EntityInterfaceA & EntityInterfaceB @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type Query {
      interfacesA: [EntityInterfaceA]
      interfacesB: [EntityInterfaceB]
    }
  `),
};

const feb: Subgraph = {
  name: 'feb',
  url: '',
  definitions: parse(`
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityInterfaceB implements EntityInterfaceA @key(fields: "id") @interfaceObject {
      id: ID!
      name: String! @external
      newField: String!
    }
  `),
};

const ffa: Subgraph = {
  name: 'ffa',
  url: '',
  definitions: parse(`
    type EntityA implements EntityInterfaceA & EntityInterfaceB @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityC implements EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityD implements EntityInterfaceC @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type EntityE implements EntityInterfaceA & EntityInterfaceC @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    interface EntityInterfaceC @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type Query {
      interfacesA: [EntityInterfaceA]
      interfacesB: [EntityInterfaceB]
      interfacesC: [EntityInterfaceC]
    }
  `),
};

const ffb: Subgraph = {
  name: 'ffb',
  url: '',
  definitions: parse(`
    type EntityB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityC implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityInterfaceB @key(fields: "id") @interfaceObject {
      id: ID!
    }
    
    type EntityInterfaceC @key(fields: "id") @interfaceObject {
      id: ID!
    }
  `),
};

const ffc: Subgraph = {
  name: 'ffc',
  url: '',
  definitions: parse(`
    type EntityC implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityInterfaceB @key(fields: "id") @interfaceObject {
      id: ID!
    }
    
    type EntityInterfaceC @key(fields: "id") @interfaceObject {
      id: ID!
    }
  `),
};

const ffd: Subgraph = {
  name: 'ffd',
  url: '',
  definitions: parse(`
    type EntityB implements EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityC @key(fields: "id") {
      id: ID!
    }
    
    interface EntityInterfaceA @key(fields: "id") {
      id: ID!
    }
    
    type EntityInterfaceB @key(fields: "id") @interfaceObject {
      id: ID!
    }
    
    type EntityInterfaceC @key(fields: "id") @interfaceObject {
      id: ID!
    }
  `),
};
