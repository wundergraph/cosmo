import {
  EntityAncestorCollection,
  EntityAncestorData,
  federateSubgraphs,
  generateResolvabilityErrorReasons,
  generateSelectionSetSegments,
  generateSharedResolvabilityErrorReasons,
  GraphFieldData,
  newRootFieldData,
  OBJECT,
  parse,
  QUERY,
  renderSelectionSet,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  UnresolvableFieldData,
  unresolvablePathError,
} from '../../src';
import { describe, expect, test } from 'vitest';
import { INACCESSIBLE_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from './utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../utils/utils';

describe('Field resolvability tests', () => {
  test('that shared queries that return a nested type that is only resolvable over multiple subgraphs are valid', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Nested {
        nest: Nested2
      }

      type Nested2 {
        nest: Nested3
      }

      type Nested3 {
        nest: Nested4
      }

      type Nested4 {
        age: Int
        name: String
      }
      
      type Query {
        query: Nested
      }
    `,
      ),
    );
  });

  test('that unshared queries that return a nested type that cannot be resolved in a single subgraph returns an error', () => {
    const fieldPath = 'query.query.nest.nest.nest';
    const rootFieldData = newRootFieldData(QUERY, 'query', new Set<string>(['subgraph-b']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-c']),
      typeName: 'Nested4',
    };
    const { errors } = federateSubgraphsFailure([subgraphB, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that unresolvable fields return an error #1', () => {
    const fieldPath = 'query.friend';
    const rootFieldData = newRootFieldData(QUERY, 'friend', new Set<string>(['subgraph-d']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-f']),
      typeName: 'Friend',
    };
    const result = federateSubgraphsFailure([subgraphD, subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that unresolvable fields return an error #2.1', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-w',
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData('Query', 'entity', new Set<string>(['subgraph-w']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'nestedObject',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'nestedObject',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-v']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([subgraphV, subgraphW], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that unresolvable fields return an error #2.2', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-w',
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData('Query', 'entity', new Set<string>(['subgraph-w']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'nestedObject',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'nestedObject',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-v']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([subgraphW, subgraphV], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that unresolvable fields that are the first fields to be added still return an error', () => {
    const fieldPath = 'query.friend';
    const rootFieldData = newRootFieldData(QUERY, 'friend', new Set<string>(['subgraph-d']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-f']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphsFailure([subgraphF, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that multiple unresolved fields return an error for each', () => {
    const fieldPath = 'query.friend';
    const rootFieldData = newRootFieldData(QUERY, 'friend', new Set<string>(['subgraph-d']));
    const fieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-f']),
      typeName: 'Friend',
    };
    const fieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'hobbies',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'hobbies',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-g']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphsFailure([subgraphD, subgraphF, subgraphG], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        fieldDataOne,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData: fieldDataOne }),
      ),
    );
    expect(errors[1]).toStrictEqual(
      unresolvablePathError(
        fieldDataTwo,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData: fieldDataTwo }),
      ),
    );
  });

  test('that shared queries that return a type that is only resolvable over multiple subgraphs are valid', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphD, subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Friend {
        age: Int!
        name: String!
      }
      
      type Query {
        friend: Friend
      }
    `,
      ),
    );
  });

  test('that shared queries that return an interface that is only resolvable over multiple subgraphs are valid', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphH, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Friend implements Human {
        age: Int!
        name: String!
      }
      
      interface Human {
        age: Int!
        name: String!
      }

      type Query {
        humans: [Human]
      }
    `,
      ),
    );
  });

  test('that queries that return interfaces whose constituent types are unresolvable return an error', () => {
    const fieldPath = 'query.humans.... on Friend';
    const rootFieldData = newRootFieldData(QUERY, 'humans', new Set<string>(['subgraph-i']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-j']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphsFailure([subgraphI, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that queries that return nested interfaces whose constituent types are unresolvable return an error', () => {
    const fieldPath = 'query.humans.... on Friend.pets.... on Cat';
    const rootFieldData = newRootFieldData(QUERY, 'humans', new Set<string>(['subgraph-k']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-l']),
      typeName: 'Cat',
    };
    const { errors } = federateSubgraphsFailure([subgraphK, subgraphL], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that shared queries that return a union that is only resolvable over multiple subgraphs are valid', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphM, subgraphN], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Enemy {
        name: String!
      }
      
      type Friend {
        name: String!
      }
      
      union Human = Enemy | Friend
      
      type Query {
        humans: [Human]
      }
    `,
      ),
    );
  });

  test('that queries that return unions whose constituent types are unresolvable return an error', () => {
    const fieldPath = 'query.humans.... on Enemy';
    const rootFieldData = newRootFieldData(QUERY, 'humans', new Set<string>(['subgraph-o']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-p']),
      typeName: 'Enemy',
    };
    const { errors } = federateSubgraphsFailure([subgraphO, subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that an entity ancestor provides access to an otherwise unreachable field', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphQ, subgraphR], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type NestedObject {
            age: Int!
            name: String!
        }
        
        type Object {
            nestedObject: NestedObject!
        }
        
        type Query {
          entity: SometimesEntity!
        }
        
        type SometimesEntity {
            id: ID!
            object: Object!
        }
    `,
      ),
    );
  });

  test('that a nested self-referential type does not create an infinite validation loop', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphS, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type Friend {
          name: String!
        }
        
        type NestedObject {
          object: Object!
        }
        
        type Object {
          nestedObject: NestedObject!
        }
        
        type Query {
          friend: Friend
          object: Object!
        }
    `,
      ),
    );
  });

  test('that unreachable interface implementations do not return an error', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphT, subgraphU], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        interface Interface {
          field: String!
        }

        type Object implements Interface {
          field: String!
        }

        type OtherObject implements Interface {
          field: String!
        }

        type Query {
          query: Interface!
        }
    `,
      ),
    );
  });

  test('that extensions do not affect resolvability', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphX, subgraphY, subgraphZ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type Entity {
          age: Int!
          entityTwo: EntityTwo!
          id: Int!
          name: String!
        }
        
        type EntityThree {
          age: Int!
          id: Int!
          name: String!
        }
        
        type EntityTwo {
          age: Int!
          entityThree: EntityThree!
          id: Int!
          name: String!
        }

        type Query {
          entity: Entity!
        }
      `,
      ),
    );
  });

  test('that a root field cycle does not affect resolvability', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAA, subgraphAB],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        `
        schema {
          query: Query
          mutation: Mutation
        }
        
        type Mutation {
          mutation: Mutation!
        }

        type Query {
          dummy: String!
          query: Query!
        }
      `,
      ),
    );
  });

  test('that an error is returned if a nested entity cannot access a subgraph where a field is defined #1', () => {
    const fieldPath = 'query.entityOne.entityTwo.entityOne';
    const rootFieldData = newRootFieldData(QUERY, 'entityOne', new Set<string>(['subgraph-ac']));
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-ad',
      typeName: 'EntityOne',
    };
    const fieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'entityTwo',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'entityTwo',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ac']),
      typeName: 'EntityOne',
    };
    const fieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ac']),
      typeName: 'EntityOne',
    };
    const { errors } = federateSubgraphsFailure([subgraphAC, subgraphAD], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    expect(errors).toStrictEqual([
      unresolvablePathError(
        fieldDataOne,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataOne }),
      ),
      unresolvablePathError(
        fieldDataTwo,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataTwo }),
      ),
    ]);
  });

  test('that an error is returned if a nested entity cannot access a subgraph where a field is defined #2', () => {
    const fieldPath = 'query.entityOne.entityTwo.entityOne';
    const rootFieldData = newRootFieldData(QUERY, 'entityOne', new Set<string>(['subgraph-ba']));
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-bb',
      typeName: 'EntityOne',
    };
    const fieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath + '.object.nestedObject'), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ba']),
      typeName: 'NestedObject',
    };
    const fieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'entityTwo',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'entityTwo',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ba']),
      typeName: 'EntityOne',
    };
    const { errors } = federateSubgraphsFailure([subgraphBA, subgraphBB], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    expect(errors).toStrictEqual([
      unresolvablePathError(
        fieldDataOne,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataOne }),
      ),
      unresolvablePathError(
        fieldDataTwo,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataTwo }),
      ),
    ]);
  });

  test('that an error is returned if a field cannot be accessed by an entity subgraph jump', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-ae',
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData('Query', 'entity', new Set<string>(['subgraph-ae']));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-af']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([subgraphAE, subgraphAF], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  // TODO
  test.skip('that entity keys can be resolved over multiple subgraphs', () => {
    const result = federateSubgraphs({ subgraphs: [subgraphAG, subgraphAH, subgraphAI, subgraphAJ] });
    expect(result.success).toBe(true);
  });

  test('that entity resolve chains (leapfrogging) are valid', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAK, subgraphAL, subgraphAM],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type EntityOne {
          entityTwo: EntityTwo
          idTwo: ID!
          name: String!
          object: Object!
        }
        
        type EntityThree {
          entityOne: EntityOne!
          id: ID!
        }
        
        type EntityTwo {
          entityThree: EntityThree!
          id: ID!
        }
        
        type Object {
          id: ID!
        }
        
        type Query {
          entityOne: EntityOne!
        }
    `,
      ),
    );
  });

  test('that cyclical references are valid', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphAN], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type A {
            b: B!
            test: String!
          }
          
          type B {
           b: C!
           test: String!
          }
          
          type C {
            a: A!
            test: B!
          }

          type Query {
            a: A!
          }
    `,
      ),
    );
  });

  test('that revisited fields do not produce false positives #1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAP, subgraphAQ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type EntityOne {
          age: Int!
          entityTwo: EntityTwo!
          id: ID!
          object: Object!
        }
        
        type EntityTwo {
          entityOne: EntityOne!
          id: ID!
          name: String!
        }
        
        type Object {
          name: String!
        }
        
        type Query {
          entityOne: EntityOne!
        }
    `,
      ),
    );
  });

  test('that revisited fields do not produce false positives #2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([subgraphAR], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type NestedObjectOne {
          name: String!
          object: ObjectOne!
        }
        
        type NestedObjectTwo {
          name: String!
          object: ObjectOne!
        }
        
        type ObjectOne {
          name: String!
          nestedObjectOne: NestedObjectOne!
          nestedObjectTwo: NestedObjectTwo!
        }
        
        type Query {
          objectOne: ObjectOne!
        }
    `,
      ),
    );
  });

  test('that revisited fields do not produce false positives #3', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAS, subgraphAT],
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
          objectThree: ObjectThree!
          objectTwo: ObjectTwo!
        }
        
        type ObjectOne {
          entity: Entity!
          name: String!
        }
        
        type ObjectThree {
          entity: Entity!
          name: String!
        }
        
        type ObjectTwo {
          age: Int!
          entity: Entity!
          name: String!
        }
        
        type Query {
          objectOne: ObjectOne!
        }
    `,
      ),
    );
  });

  test('that inaccessible concrete types that implement an interface are not assessed by the resolvability graph', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAU, subgraphAV],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        type Entity implements Interface {
          age: Int!
          id: ID!
          name: String!
        }
      
        interface Interface {
          id: ID!
        }
        
        type ObjectOne implements Interface @inaccessible {
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

  test('that interface objects do not create false positives #1.1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAW, subgraphAX],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne implements Interface {
            age: Int!
            id: ID!
            name: String!
          }
          
          type EntityTwo implements Interface {
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
            entities: [Interface!]!
            entityOne: [EntityOne!]!
            entityTwo: [EntityTwo!]!
          }
    `,
      ),
    );
  });

  test('that interface objects do not create false positives #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAX, subgraphAW],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne implements Interface {
            age: Int!
            id: ID!
            name: String!
          }
          
          type EntityTwo implements Interface {
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
            entities: [Interface!]!
            entityOne: [EntityOne!]!
            entityTwo: [EntityTwo!]!
          }
    `,
      ),
    );
  });

  test('that interface objects can contribute implicit keys #1.1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAY, subgraphAX, subgraphAW],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne implements Interface {
            age: Int!
            id: ID!
            isEntity: Boolean!
            name: String!
          }
          
          type EntityTwo implements Interface {
            age: Int!
            id: ID!
            isEntity: Boolean!
            name: String!
          }
          
          interface Interface {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            entities: [Interface!]!
            entityOne: [EntityOne!]!
            entityTwo: [EntityTwo!]!
          }
    `,
      ),
    );
  });

  test('that interface objects can contribute implicit keys #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAW, subgraphAX, subgraphAY],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne implements Interface {
            age: Int!
            id: ID!
            isEntity: Boolean!
            name: String!
          }
          
          type EntityTwo implements Interface {
            age: Int!
            id: ID!
            isEntity: Boolean!
            name: String!
          }
          
          interface Interface {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            entities: [Interface!]!
            entityOne: [EntityOne!]!
            entityTwo: [EntityTwo!]!
          }
    `,
      ),
    );
  });

  test('that interface objects can contribute implicit keys #1.3', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAY, subgraphAW, subgraphAX],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne implements Interface {
            age: Int!
            id: ID!
            isEntity: Boolean!
            name: String!
          }
          
          type EntityTwo implements Interface {
            age: Int!
            id: ID!
            isEntity: Boolean!
            name: String!
          }
          
          interface Interface {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            entities: [Interface!]!
            entityOne: [EntityOne!]!
            entityTwo: [EntityTwo!]!
          }
    `,
      ),
    );
  });

  test('that inaccessible fields are not considered for resolvability', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphAZ, subgraphAO],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
          type Entity {
            age: Int!
            id: ID!
            name: String! @inaccessible
          }
          
          type Query {
            entities: [Entity!]!
          }
    `,
      ),
    );
  });

  test('that shared entity fields do not trigger false positives', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphBC, subgraphBD, subgraphBE],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne {
            age: Int!
            id: ID!
            name: String!
            object: Object!
          }
          
          type Object {
            age: Int!
            id: ID!
            name: String!
          }

          type Query {
            entityOne: EntityOne!
          }
    `,
      ),
    );
  });

  test('that shared entity fields from a root field do not produce false positives', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphBF, subgraphBG],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type Entity {
            age: Int!
            id: ID!
            idTwo: ID!
            name: String!
          }

          type Query {
            entity: Entity!
          }
    `,
      ),
    );
  });

  test('that interface objects satisfied by implicit keys do not produce false positives', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphBH, subgraphBI],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type Entity implements Interface {
            id: ID!
            isNew: Boolean!
            name: String!
            object: Object!
          }
          
          interface Interface {
            id: ID!
            isNew: Boolean!
            object: Object!
          }
          
          type Object {
            id: ID!
          }

          type Query {
            entity: Entity!
          }
    `,
      ),
    );
  });

  test('that an error is returned if an interface object cannot be reached', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: subgraphBH.name,
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entity', new Set<string>([subgraphBH.name]));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'isNew',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'isNew',
      } as GraphFieldData),
      subgraphNames: new Set<string>([subgraphBJ.name]),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([subgraphBH, subgraphBJ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that a shared entity field cycle is resolvable', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphBK, subgraphBL],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
          type EntityOne {
            age: Int!
            entityTwo: EntityTwo!
            id: ID!
            name: String!
          }
      
          type EntityThree {
            age: Int!
            entityTwo: EntityTwo!
            id: ID!
            idTwo: ID!
            name: String!
          }
      
          type EntityTwo {
            age: Int!
            entityThree: EntityThree!
            id: ID!
            idTwo: ID!
            name: String!
          }
          
          type Query {
            entity: EntityOne!
          }
    `,
      ),
    );
  });

  test('that an unconditionally external field cannot be used as an implicit key #1.1', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([[subgraphBN.name, new Set<string>(['id'])]]),
      subgraphName: subgraphBM.name,
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entity', new Set<string>([subgraphBM.name]));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([subgraphBN.name]),
      typeName: 'Entity',
    };
    const result = federateSubgraphsFailure([subgraphBM, subgraphBN], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that an unconditionally external field cannot be used as an implicit key #1.2', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([[subgraphBN.name, new Set<string>(['id'])]]),
      subgraphName: subgraphBM.name,
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entity', new Set<string>([subgraphBM.name]));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([subgraphBN.name]),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([subgraphBN, subgraphBM], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  // @TODO
  test('that an entity can be a key target without ever being a key source', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphBO, subgraphBP],
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
            entities: [Entity!]!
          }
        `,
      ),
    );
  });

  test('that resolvability validation can be disabled', () => {
    const resultOne = federateSubgraphs({
      subgraphs: [subgraphBQ, subgraphBR],
      version: ROUTER_COMPATIBILITY_VERSION_ONE,
    });
    expect(resultOne.success).toBe(false);
    const resultTwo = federateSubgraphs({
      disableResolvabilityValidation: true,
      subgraphs: [subgraphBQ, subgraphBR],
      version: ROUTER_COMPATIBILITY_VERSION_ONE,
    });
    expect(resultTwo.success).toBe(true);
  });

  test('that sibling fields that return the same named type do not interfere with resolvability #1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([aaaa, aaab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      interface Interface {
        id: ID!
      }
  
      type ObjectA {
        interface: Interface
      }
  
      type ObjectB implements Interface {
        id: ID!
        name: String!
        objectC: ObjectC
      }
  
      type ObjectC {
        objectD: ObjectD
      }
  
      type ObjectD {
        objectEs: [ObjectE!]
        objectEs2: [ObjectE!]
      }
  
      type ObjectE {
        objectFs: [ObjectF!]
      }
  
      type ObjectF {
        id: ID!
        objectGs: [ObjectG!]
      }
  
      type ObjectG {
        id: ID!
      }
      
      type Output {
        objectA: ObjectA!
      }
  
      type Query {
        objectA: Output!
      }
      `,
      ),
    );
  });

  test('that sibling fields that return the same named type do not interfere with resolvability #2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([baaa, baab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type ObjectA {
          a: ID
          id: ID!
          objectB: ObjectB!
        }
        
        type ObjectB {
          objectC: ObjectC!
          objectCs: [ObjectC!]!
        }
        
        type ObjectC {
          objectDs: [ObjectD!]
        }
        
        type ObjectD {
          a: ID
          b: ID
        }
        
        type Query {
          objectA: ObjectA
        }
        `,
      ),
    );
  });

  test('that sibling fields that return the same named type do not interfere with resolvability #3', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([caaa, caab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type ObjectA {
          a: ID
          id: ID!
          objectB: ObjectB!
          objectBs: [ObjectB!]!
        }
        
        type ObjectB {
          objectC: ObjectC!
        }
        
        type ObjectC {
          a: ID!
          b: ID!
        }
        
        type Query {
          objectA: ObjectA
        }
        `,
      ),
    );
  });

  test('that sibling fields that return the same named type do not interfere with resolvability #4', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([daaa, daab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        interface Interface {
          id: ID!
          objectB: ObjectB!
        }
        
        type ObjectA implements Interface {
          id: ID!
          name: String!
          objectB: ObjectB!
        }
        
        type ObjectB {
          objectC: ObjectC!
        }
        
        type ObjectC {
          objectD: ObjectD
          objectDs: [ObjectD!]
        }
        
        type ObjectD {
          objectEs: [ObjectE!]
        }
        
        type ObjectE {
          a: ID
          b: ID
        }
        
        type Query {
          interface: Interface
        }
        `,
      ),
    );
  });

  test('that fields are accessible through a shared root field', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([eaaa, eaab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type Entity {
          id: ID!
          name: String!
          object: Object!
        }
        
        type Object {
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        `,
      ),
    );
  });

  test('that an error is returned if a field is inaccessible through a shared root field', () => {
    const fieldPath = 'query.entities.objectTwo';
    const entityAncestors: EntityAncestorCollection = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([[eaaa.name, new Set<string>(['id'])]]),
      subgraphNames: [eaaa.name, eaac.name],
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entities', new Set<string>([eaaa.name, eaac.name]));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'id',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'id',
      } as GraphFieldData),
      subgraphNames: new Set<string>([eaaa.name]),
      typeName: OBJECT,
    };
    const { errors } = federateSubgraphsFailure([eaaa, eaac], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateSharedResolvabilityErrorReasons({ entityAncestors, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that a shared root field can be combined with entity jumps to resolve a field', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([eaaa, eaac, eaad], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
        type Entity {
          id: ID!
          name: String!
          object: Object!
          objectTwo: Object!
        }
        
        type Object {
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
    `,
      ),
    );
  });

  test('that an error is returned if a field is inaccessible through a shared root field nor an entity #1', () => {
    const entityAncestors: EntityAncestorCollection = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([
        [eaaa.name, new Set<string>(['id'])],
        [eaae.name, new Set<string>(['name'])],
      ]),
      subgraphNames: [eaac.name, eaae.name],
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entities', new Set<string>([eaac.name, eaae.name]));
    const unresolvableFieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.entities.object'), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([eaaf.name]),
      typeName: OBJECT,
    };
    const unresolvableFieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.entities.objectTwo'), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([eaaf.name]),
      typeName: OBJECT,
    };
    const { errors } = federateSubgraphsFailure([eaac, eaae, eaaf], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    expect(errors).toStrictEqual([
      unresolvablePathError(
        unresolvableFieldDataOne,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataOne,
        }),
      ),
      unresolvablePathError(
        unresolvableFieldDataTwo,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataTwo,
        }),
      ),
    ]);
  });

  test('that an error is returned if a field is inaccessible through a shared root field nor an entity #2', () => {
    const entityAncestors: EntityAncestorCollection = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([
        [eaaa.name, new Set<string>(['id'])],
        [eaae.name, new Set<string>(['name'])],
        [eaag.name, new Set<string>(['age'])],
      ]),
      subgraphNames: [eaac.name, eaae.name, eaag.name],
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entities', new Set<string>([eaac.name, eaae.name]));
    const unresolvableFieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.entities.object'), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([eaag.name]),
      typeName: OBJECT,
    };
    const unresolvableFieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.entities.objectTwo'), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([eaag.name]),
      typeName: OBJECT,
    };
    const unresolvableFieldDataThree: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.entities'), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>([eaag.name]),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([eaac, eaae, eaag], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(3);
    expect(errors).toStrictEqual([
      unresolvablePathError(
        unresolvableFieldDataOne,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataOne,
        }),
      ),
      unresolvablePathError(
        unresolvableFieldDataTwo,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataTwo,
        }),
      ),
      unresolvablePathError(
        unresolvableFieldDataThree,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataThree,
        }),
      ),
    ]);
  });

  test('that an error is returned if fields returning the same named type are unresolvable', () => {
    const fieldPath = 'query.object.nestedObjectTwo';
    const rootFieldData = newRootFieldData(QUERY, 'object', new Set<string>([faaa.name, faab.name]));
    const unresolvableFieldData: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'id',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'id',
      } as GraphFieldData),
      subgraphNames: new Set<string>([faaa.name]),
      typeName: 'NestedObject',
    };
    const { errors } = federateSubgraphsFailure([faaa, faab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('a cyclical shared root field is resolvable', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([gaaa, gaab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Object {
        object: Object!
      }
      
      type Query {
        object: Object!
      }
    `,
      ),
    );
  });

  test('that errors are returned for unresolvable fields involving a shared root query field and unreachable nested entities', () => {
    const { errors } = federateSubgraphsFailure([haaa, haab, haac], ROUTER_COMPATIBILITY_VERSION_ONE);
    const entityAncestors: EntityAncestorCollection = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([
        [haaa.name, new Set<string>(['idB'])],
        [haab.name, new Set<string>(['idB'])],
        [haac.name, new Set<string>(['idA'])],
      ]),
      subgraphNames: [haaa.name, haab.name],
      typeName: 'EntityA',
    };
    const rootFieldData = newRootFieldData(QUERY, 'a', new Set<string>([haaa.name, haab.name]));

    const unresolvableFieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'createdAt',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.a.b.edges.node.c.a'), {
        isLeaf: true,
        name: 'createdAt',
      } as GraphFieldData),
      subgraphNames: new Set<string>([haaa.name]),
      typeName: 'EntityA',
    };
    const unresolvableFieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'active',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.a.b.edges.node.c.a'), {
        isLeaf: true,
        name: 'active',
      } as GraphFieldData),
      subgraphNames: new Set<string>([haaa.name]),
      typeName: 'EntityA',
    };
    const unresolvableFieldDataThree: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'b',
      selectionSet: renderSelectionSet(generateSelectionSetSegments('query.a.b.edges.node.c.a'), {
        isLeaf: false,
        name: 'b',
      } as GraphFieldData),
      subgraphNames: new Set<string>([haab.name]),
      typeName: 'EntityA',
    };
    expect(errors).toHaveLength(3);
    expect(errors).toStrictEqual([
      unresolvablePathError(
        unresolvableFieldDataOne,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataOne,
        }),
      ),
      unresolvablePathError(
        unresolvableFieldDataTwo,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataTwo,
        }),
      ),
      unresolvablePathError(
        unresolvableFieldDataThree,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataThree,
        }),
      ),
    ]);
  });

  test('that an error is returned if a field is unreachable due a true @external entity key field', () => {
    const entityAncestors: EntityAncestorCollection = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>([[iaab.name, new Set<string>(['id'])]]),
      subgraphNames: [iaaa.name, iaab.name],
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData(QUERY, 'entities', new Set<string>([iaaa.name]));
    const fieldPath = 'query.entities';
    const unresolvableFieldDataOne: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>([iaaa.name]),
      fieldName: 'id',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'id',
      } as GraphFieldData),
      subgraphNames: new Set<string>([iaab.name]),
      typeName: 'Entity',
    };
    const unresolvableFieldDataTwo: UnresolvableFieldData = {
      externalSubgraphNames: new Set<string>(),
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>([iaab.name]),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphsFailure([iaaa, iaab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(2);
    expect(errors).toStrictEqual([
      unresolvablePathError(
        unresolvableFieldDataOne,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataOne,
        }),
      ),
      unresolvablePathError(
        unresolvableFieldDataTwo,
        generateSharedResolvabilityErrorReasons({
          entityAncestors,
          rootFieldData,
          unresolvableFieldData: unresolvableFieldDataTwo,
        }),
      ),
    ]);
  });

  test('that an @external key can still be a valid target', () => {
    const { success } = federateSubgraphsSuccess([jaaa, jaab], ROUTER_COMPATIBILITY_VERSION_ONE);
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      query: Nested @shareable
    }

    type Nested @shareable {
      nest: Nested2
    }

    type Nested2 @shareable {
      nest: Nested3
    }

    type Nested3 @shareable {
      nest: Nested4
    }

    type Nested4 {
      name: String
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      query: Nested @shareable
    }

    type Nested @shareable {
      nest: Nested2
    }

    type Nested2 @shareable {
      nest: Nested3
    }

    type Nested3 @shareable {
      nest: Nested4
    }

    type Nested4 {
      age: Int
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Nested @shareable {
      nest: Nested2
    }

    type Nested2 @shareable {
      nest: Nested3
    }

    type Nested3 @shareable {
      nest: Nested4
    }

    type Nested4 {
      name: String
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      friend: Friend @shareable
    }

    type Friend {
      name: String!
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      friend: Friend @shareable
    }

    type Friend {
      age: Int!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Friend {
      age: Int!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Friend {
      hobbies: [String!]!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    interface Human {
      name: String!
    }
    
    type Friend implements Human {
      name: String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    interface Human {
      age: Int!
    }
    
    type Friend implements Human {
      age: Int!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    interface Human {
      name: String!
    }
    
    type Friend implements Human {
      name: String!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    interface Human {
      name: String!
      pets: [Pet]
    }
    
    interface Pet {
      name: String!
    }
    
    type Cat implements Pet {
      name: String!
    }
    
    type Friend implements Human {
      name: String!
      pets: [Pet]
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    interface Human {
      name: String!
      pets: [Pet]
    }
    
    interface Pet {
      age: Int!
    }
    
    type Cat implements Pet {
      age: Int!
    }
    
    type Friend implements Human {
      name: String!
      pets: [Pet]
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    union Human = Friend
    
    type Friend {
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    union Human = Enemy
    
    type Enemy {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Query {
      humans: [Human]
    }
    
    union Human = Friend | Enemy
    
    type Friend {
      name: String!
    }
    
    type Enemy {
      name: String!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    union Human = Enemy
    
    type Enemy {
      age: Int!
    }
  `),
};

const subgraphQ = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Query {
      entity: SometimesEntity!
    }
    
    type SometimesEntity {
        id: ID!
        object: Object!
    }
    
    type Object {
        nestedObject: NestedObject!
    }
    
    type NestedObject {
        name: String!
    }
  `),
};

const subgraphR = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type SometimesEntity @key(fields: "id") {
        id: ID!
        object: Object!
    }
    
    type Object {
        nestedObject: NestedObject!
    }
    
    type NestedObject {
        age: Int!
    }
  `),
};

const subgraphS = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Query {
        object: Object!
    }
    
    type Object {
        nestedObject: NestedObject!
    }
    
    type NestedObject {
        object: Object!
    }
  `),
};

const subgraphT = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Query {
     query: Interface!
    }
    
    interface Interface {
     field: String!
    }
    
    type Object implements Interface {
     field: String!
    }
  `),
};

const subgraphU = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    interface Interface {
     field: String!
    }
    
    type OtherObject implements Interface {
     field: String!
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    type Entity {
      id: Int!
      nestedObject: NestedObject!
    }

    type NestedObject {
      name: String!
      age: Int!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: Int!
    }
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    extend type Entity {
      name: String!
    }

    type Entity @key(fields: "id") {
      id: Int!
      entityTwo: EntityTwo!
    }
    
    extend type EntityTwo {
      name: String!
    }
    
    type EntityTwo @key(fields: "id") {
      id: Int!
      age: Int!
    }
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    type EntityTwo @key(fields: "id") {
      id: Int!
      entityThree: EntityThree!
    }
    
    type EntityThree {
      name: String!
    }
    
    extend type EntityThree @key(fields: "id") {
      id: Int!
    }
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: Int!
    }
    
    type Entity {
      age: Int!
    }
    
    extend type EntityThree {
      age: Int!
    }
    
    type EntityThree @key(fields: "id") {
      id: Int!
    }
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    type Mutation {
      mutation: Mutation!
    }
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    type Query {
      query: Query!
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    type Query {
      entityOne: EntityOne!
    }
    
    type EntityOne {
      id: ID! @shareable
      entityTwo: EntityTwo!
      name: String!
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "id") {
      id: ID!
      age: Int!
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      entityOne: EntityOne!
    }
  `),
};

const subgraphAE: Subgraph = {
  name: 'subgraph-ae',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphAF: Subgraph = {
  name: 'subgraph-af',
  url: '',
  definitions: parse(`
    type Entity {
      id: ID! @shareable
      name: String!
    }
  `),
};

const subgraphAG: Subgraph = {
  name: 'subgraph-ag',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable
    }
    
    type Entity @shareable {
      one: ID!
      two: ID!
    }
  `),
};

const subgraphAH: Subgraph = {
  name: 'subgraph-ah',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable
    }
    
    type Entity {
      three: ID! @shareable
    }
  `),
};

const subgraphAI: Subgraph = {
  name: 'subgraph-ai',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "one") {
      one: ID!
      name: String!
    }
  `),
};

const subgraphAJ: Subgraph = {
  name: 'subgraph-aj',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "two three") {
      two: ID!
      three: ID!
      age: Int!
    }
  `),
};

const subgraphAK: Subgraph = {
  name: 'subgraph-ak',
  url: '',
  definitions: parse(`
    type Query {
      entityOne: EntityOne!
    }
  
    type EntityOne @key(fields: "object { id }") {
      object: Object!
      idTwo: ID! @shareable
      entityTwo: EntityTwo
    }
    
    type Object {
      id: ID! @shareable
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphAL: Subgraph = {
  name: 'subgraph-al',
  url: '',
  definitions: parse(`
    type EntityTwo @key(fields: "id") {
      id: ID!
      entityThree: EntityThree!
    }
    
    type EntityThree @key(fields: "id") {
      id: ID!
      entityOne: EntityOne!
    }
    
    type EntityOne @key(fields: "object { id }") {
      object: Object!
    }
    
    type Object {
      id: ID! @shareable
    }
  `),
};

const subgraphAM: Subgraph = {
  name: 'subgraph-am',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "idTwo") {
      idTwo: ID!
      name: String!
    }
  `),
};

const subgraphAN: Subgraph = {
  name: 'subgraph-an',
  url: '',
  definitions: parse(`
    type Query  {
      a: A!
    }
    
    type A {
      b: B!
      test: String!
    }
    
    type B {
     b: C!
     test: String!
    }
    
    type C {
      a: A!
      test: B!
    }
  `),
};

const subgraphAO: Subgraph = {
  name: 'subgraph-ao',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
     id: ID!
     age: Int!
    }
  `),
};

const subgraphAP: Subgraph = {
  name: 'subgraph-ap',
  url: '',
  definitions: parse(`
    type Query {
      entityOne: EntityOne!
    }
    
    type EntityOne @key(fields: "id") {
      id: ID!
      entityTwo: EntityTwo!
      object: Object!
    }
    
    type Object {
      name: String!
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphAQ: Subgraph = {
  name: 'subgraph-aq',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "id") {
      id: ID!
      age: Int!
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      entityOne: EntityOne!
    }
  `),
};

const subgraphAR: Subgraph = {
  name: 'subgraph-ar',
  url: '',
  definitions: parse(`
    type Query {
     objectOne: ObjectOne!
    }
    
    type ObjectOne {
     nestedObjectOne: NestedObjectOne!
     nestedObjectTwo: NestedObjectTwo!
     name: String!
    }
    
    type NestedObjectOne {
     name: String!
     object: ObjectOne!
    }
    
    type NestedObjectTwo {
     name: String!
     object: ObjectOne!
    }
  `),
};

const subgraphAS: Subgraph = {
  name: 'subgraph-as',
  url: '',
  definitions: parse(`
    type Query {
      objectOne: ObjectOne!
    }
    
    type ObjectOne {
      name: String!
      entity: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      objectTwo: ObjectTwo! @shareable
    }
    
    type ObjectTwo {
      name: String!
      entity: Entity!
    }
  `),
};

const subgraphAT: Subgraph = {
  name: 'subgraph-at',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
      objectTwo: ObjectTwo! @shareable
      objectThree: ObjectThree!
    }
    
    type ObjectTwo {
      age: Int!
    }
    
    type ObjectThree {
      name: String!
      entity: Entity!
    }
  `),
};

const subgraphAU: Subgraph = {
  name: 'subgraph-au',
  url: '',
  definitions: parse(`
    type Query {
     interface: Interface!
    }
    
    interface Interface {
     id: ID!
    }
    
    type ObjectOne implements Interface {
     id: ID!
     name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
     id: ID!
     name: String!
    }
  `),
};

const subgraphAV: Subgraph = {
  name: 'subgraph-av',
  url: '',
  definitions: parse(`
    type ObjectOne @inaccessible {
      age: Int!
    }
    
    type Entity @key(fields: "id") {
     id: ID!
     age: Int!
    }
  `),
};

const subgraphAW: Subgraph = {
  name: 'subgraph-aw',
  url: '',
  definitions: parse(`
    type Query {
     entities: [Interface!]!
    }
    
    type Interface @interfaceObject @key(fields: "id") {
     id: ID!
     age: Int! @shareable
    }
  `),
};

const subgraphAX: Subgraph = {
  name: 'subgraph-ax',
  url: '',
  definitions: parse(`
    type Query {
     entityOne: [EntityOne!]!
     entityTwo: [EntityTwo!]!
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

const subgraphAY: Subgraph = {
  name: 'subgraph-ay',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "age") {
     age: Int!
     isEntity: Boolean!
    }
    
    type EntityTwo @key(fields: "age") {
     age: Int!
     isEntity: Boolean!
    }
  `),
};

const subgraphAZ: Subgraph = {
  name: 'subgraph-az',
  url: '',
  definitions: parse(`
    type Query {
     entities: [Entity!]!
    }
    
    type Entity @key(fields: "id") {
     id: ID!
     name: String! @inaccessible
    }
  `),
};

const subgraphBA: Subgraph = {
  name: 'subgraph-ba',
  url: '',
  definitions: parse(`
    type Query {
      entityOne: EntityOne!
    }
    
    type EntityOne {
      id: ID! @shareable
      entityTwo: EntityTwo!
      object: Object @shareable
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      name: String!
    }
    
    type Object {
      nestedObject: NestedObject! @shareable
    }
    
    type NestedObject {
      name: String!
    }
  `),
};

const subgraphBB: Subgraph = {
  name: 'subgraph-bb',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "id") {
      id: ID!
      object: Object! @shareable
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      entityOne: EntityOne!
    }
    
    type Object {
      nestedObject: NestedObject! @shareable
    }
    
    type NestedObject {
      age: Int!
    }
  `),
};

const subgraphBC: Subgraph = {
  name: 'subgraph-bc',
  url: '',
  definitions: parse(`
    type Query {
      entityOne: EntityOne!
    }
    
    type EntityOne @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphBD: Subgraph = {
  name: 'subgraph-bd',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "id") {
      id: ID!
      object: Object! @shareable
    }
    
    type Object {
      name: String!
    }
  `),
};

const subgraphBE: Subgraph = {
  name: 'subgraph-be',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "id") {
      id: ID!
      object: Object! @shareable
      age: Int!
    }
    
    type Object @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphBF: Subgraph = {
  name: 'subgraph-bf',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphBG: Subgraph = {
  name: 'subgraph-bg',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable
    }
    
    type Entity @key(fields: "id idTwo") {
      id: ID!
      idTwo: ID!
      age: Int!
    }
  `),
};

const subgraphBH: Subgraph = {
  name: 'subgraph-bh',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable
    }
    
    interface Interface @key(fields: "id object { id }") {
      id: ID!
      object: Object!
    }
    
    type Entity implements Interface @key(fields: "id object { id }") {
      id: ID!
      name: String!
      object: Object!
    }
    
    type Object {
      id: ID!
    }
  `),
};

const subgraphBI: Subgraph = {
  name: 'subgraph-bi',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id") @interfaceObject {
      id: ID!
      isNew: Boolean!
    }
  `),
};

const subgraphBJ: Subgraph = {
  name: 'subgraph-bj',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id", resolvable: false) @interfaceObject {
      id: ID!
      isNew: Boolean!
    }
  `),
};

const subgraphBK: Subgraph = {
  name: 'subgraph-bk',
  url: '',
  definitions: parse(`
    type Query {
      entity: EntityOne!
    }
    
    type EntityOne @key(fields: "id") {
      id: ID!
      name: String!
      entityTwo: EntityTwo! @shareable
    }
    
    type EntityTwo @key(fields: "id") {
      id: ID!
      name: String!
      entityThree: EntityThree! @shareable
    }
    
    type EntityThree @key(fields: "id") {
      id: ID!
      name: String!
      entityTwo: EntityTwo! @shareable
    }
  `),
};

const subgraphBL: Subgraph = {
  name: 'subgraph-bl',
  url: '',
  definitions: parse(`
    type EntityOne @key(fields: "id") {
      id: ID!
      age: Int!
      entityTwo: EntityTwo! @shareable
    }
    
    type EntityTwo @key(fields: "idTwo") {
      idTwo: ID!
      age: Int!
      entityThree: EntityThree! @shareable
    }
    
    type EntityThree @key(fields: "idTwo") {
      idTwo: ID!
      age: Int!
      entityTwo: EntityTwo! @shareable
    }
  `),
};

const subgraphBM: Subgraph = {
  name: 'subgraph-bm',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity {
      id: ID! @external
      name: String!
    }
  `),
};

const subgraphBN: Subgraph = {
  name: 'subgraph-bn',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphBO: Subgraph = {
  name: 'subgraph-bo',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @external
      name: String!
    }
  `),
};

const subgraphBP: Subgraph = {
  name: 'subgraph-bp',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphBQ: Subgraph = {
  name: 'subgraph-bq',
  url: '',
  definitions: parse(`
    type Object {
      id: ID!
    }
    
    type Query {
      object: Object!
    }
  `),
};

const subgraphBR: Subgraph = {
  name: 'subgraph-br',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
  `),
};

const aaaa: Subgraph = {
  name: 'aaaa',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
    }

    type ObjectB implements Interface @key(fields: "id") {
      id: ID!
      name: String! @requires(fields: "objectC { objectD { objectEs { objectFs { id } } } }")
      objectC: ObjectC @external
    }

    type ObjectC {
      objectD: ObjectD @external
    }

    type ObjectD {
      objectEs: [ObjectE!] @external
    }

    type ObjectE {
      objectFs: [ObjectF!] @external
    }

    type ObjectF {
      id: ID! @external
    }
  `),
};

const aaab: Subgraph = {
  name: 'aaab',
  url: '',
  definitions: parse(`
    interface Interface @key(fields: "id") {
      id: ID!
    }

    type ObjectA {
      interface: Interface
    }

    type ObjectB implements Interface @key(fields: "id") @shareable {
      id: ID!
      objectC: ObjectC
    }

    type ObjectC {
      objectD: ObjectD
    }

    type ObjectD {
      objectEs: [ObjectE!]
      objectEs2: [ObjectE!]
    }

    type ObjectE {
      objectFs: [ObjectF!]
    }

    type ObjectF {
      id: ID!
      objectGs: [ObjectG!]
    }

    type ObjectG {
      id: ID!
    }
    
    type Output {
      objectA: ObjectA!
    }

    type Query {
      objectA: Output!
    }
  `),
};

const baaa: Subgraph = {
  name: 'baaa',
  url: '',
  definitions: parse(`
    type ObjectA @key(fields : "id") {
      a: ID @requires(fields: "objectB { objectC { objectDs { a } } }")
      id: ID!
      objectB: ObjectB! @external
    }
    
    type ObjectB {
      objectC: ObjectC! @external
    }
    
    type ObjectC {
      objectDs: [ObjectD!] @external
    }
    
    type ObjectD {
     a: ID @external
    }
  `),
};

const baab: Subgraph = {
  name: 'baab',
  url: '',
  definitions: parse(`
    type ObjectA @key(fields : "id") {
      id: ID!
      objectB: ObjectB!
    }
    
    type ObjectB {
      objectCs: [ObjectC!]!
      objectC: ObjectC!
    }
    
    type ObjectC {
      objectDs: [ObjectD!]
    }
    
    type ObjectD {
      a: ID
      b: ID
    }
    
    type Query {
      objectA: ObjectA
    }
  `),
};

const caaa: Subgraph = {
  name: 'caaa',
  url: '',
  definitions: parse(`
    type ObjectA @key(fields : "id") {
      a: ID @requires(fields: "objectB { objectC { a } }")
      id: ID!
      objectB: ObjectB! @external
    }
    
    type ObjectB {
      objectC: ObjectC! @external
    }
    
    type ObjectC {
      a: ID! @external
    }
  `),
};

const caab: Subgraph = {
  name: 'caab',
  url: '',
  definitions: parse(`
    type ObjectA @key(fields : "id") {
      id: ID!
      objectB: ObjectB!
      objectBs: [ObjectB!]!
    }
    
    type ObjectB {
      objectC: ObjectC!
    }
    
    type ObjectC {
      a: ID!
      b: ID!
    }
    
    type Query {
      objectA: ObjectA
    }
  `),
};

const daaa: Subgraph = {
  name: 'daaa',
  url: '',
  definitions: parse(`
    interface Interface {
      objectB: ObjectB!
    }
    
    type ObjectA implements Interface @key(fields : "id") {
      id: ID!
      name: String! @requires(fields: "objectB { objectC { objectDs { objectEs { a } } } }")
      objectB: ObjectB! @external
    }
    
    type ObjectB {
      objectC: ObjectC! @external
    }
    
    type ObjectC {
      objectDs: [ObjectD!] @external
    }
    
    
    type ObjectD {
      objectEs: [ObjectE!] @external
    }
    
    type ObjectE {
      a: ID!
    }
  `),
};

const daab: Subgraph = {
  name: 'daab',
  url: '',
  definitions: parse(`
    interface Interface @key(fields : "id") {
      id: ID!
      objectB: ObjectB!
    }
    
    type ObjectA implements Interface @key(fields : "id") {
      id: ID!
      objectB: ObjectB!
    }
    
    type ObjectB {
      objectC: ObjectC!
    }
    
    type ObjectC {
      objectD: ObjectD
      objectDs: [ObjectD!]
    }
    
    type ObjectD {
      objectEs: [ObjectE!]
    }
    
    type ObjectE @shareable {
      a: ID
      b: ID
    }
    
    type Query {
      interface: Interface
    }
  `),
};

const eaaa: Subgraph = {
  name: 'eaaa',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }
    
    type Object {
      id: ID!
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};

const eaab: Subgraph = {
  name: 'eaab',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "name") {
      name: String!
      object: Object!
    }
    
    type Object {
      name: String!
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};

const eaac: Subgraph = {
  name: 'eaac',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "name") {
      name: String!
      object: Object!
      objectTwo: Object!
    }
    
    type Object {
      name: String!
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};

const eaad: Subgraph = {
  name: 'eaad',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "name") {
      name: String!
      objectTwo: Object!
    }
    
    type Object {
      id: ID!
    }
  `),
};

const eaae: Subgraph = {
  name: 'eaae',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID
      object: Object!
      objectTwo: Object!
    }
    
    type Object {
      id: ID!
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};

const eaaf: Subgraph = {
  name: 'eaaf',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID
      object: Object!
      objectTwo: Object!
    }
    
    type Object {
      age: Int!
    }
  `),
};

const eaag: Subgraph = {
  name: 'eaag',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "age") {
      age: Int!
      object: Object!
      objectTwo: Object!
    }
    
    type Object {
      age: Int!
    }
  `),
};

const faaa: Subgraph = {
  name: 'faaa',
  url: '',
  definitions: parse(`
    type NestedObject {
      id: ID!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type Query {
      object: Object!
    }
  `),
};

const faab: Subgraph = {
  name: 'faab',
  url: '',
  definitions: parse(`
    type NestedObject {
      name: String!
    }
    
    type Object {
      nestedObject: NestedObject!
      nestedObjectTwo: NestedObject!
    }
    
    type Query {
      object: Object!
    }
  `),
};

const gaaa: Subgraph = {
  name: 'gaaa',
  url: '',
  definitions: parse(`
    type Object {
      object: Object!
    }
    
    type Query {
      object: Object!
    }
  `),
};

const gaab: Subgraph = {
  name: 'gaab',
  url: '',
  definitions: parse(`
    type Object {
      object: Object!
    }
    
    type Query {
      object: Object!
    }
  `),
};

const haaa: Subgraph = {
  name: 'haaa',
  url: '',
  definitions: parse(`
    scalar ScalarID @inaccessible
    
    type EntityA @shareable @key(fields: "idB") {
      idA: ID!
      idB: ScalarID! @inaccessible
      createdAt: String!
      active: Boolean!
    }
    
    type Query {
      a: EntityA @shareable
    }
  `),
};

const haab: Subgraph = {
  name: 'haab',
  url: '',
  definitions: parse(`
    scalar ScalarID @inaccessible
    
    type EntityA @shareable @key(fields: "idB") {
      idA: ID!
      idB: ScalarID! @inaccessible
      b: EntityBConnection!
    }
    
    type EntityB @shareable @key(fields: "idB") {
      idA: ID!
      idB: ScalarID! @inaccessible
      a: EntityA
    }
    
    type EntityBConnection {
      edges: [EntityBEdge]
      nodes: [EntityB]
    }
    
    type EntityBEdge {
      node: EntityB
    }
    
    type Query {
      a: EntityA @shareable
    }
  `),
};

const haac: Subgraph = {
  name: 'haac',
  url: '',
  definitions: parse(`
    type EntityA @shareable @key(fields: "idA") {
      idA: ID!
    }
    
    type EntityB @shareable @key(fields: "idA") {
      idA: ID!
      c: EntityC
    }
    
    type EntityC @shareable @key(fields: "id") {
      id: ID!
      a: EntityA
    }
  `),
};

const iaaa: Subgraph = {
  name: 'iaaa',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @external
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};

const iaab: Subgraph = {
  name: 'iaab',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const jaaa: Subgraph = {
  name: 'jaaa',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @external
      name: String!
    }
  `),
};

const jaab: Subgraph = {
  name: 'jaab',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};
