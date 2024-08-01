import {
  EntityAncestorData,
  federateSubgraphs,
  generateResolvabilityErrorReasons,
  generateSelectionSetSegments,
  GraphFieldData,
  renderSelectionSet,
  Subgraph,
  unresolvablePathError,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOnePersistedBaseSchema,
  versionOnePersistedDirectiveDefinitions,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';
import { newRootFieldData, UnresolvableFieldData } from '../src';

describe('Field resolvability tests', () => {
  test('that shared queries that return a nested type that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that unshared queries that return a nested type that cannot be resolved in a single subgraph returns an error', () => {
    const fieldPath = 'query.query.nest.nest.nest';
    const rootFieldData = newRootFieldData('Query', 'query', new Set<string>(['subgraph-b']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-c']),
      typeName: 'Nested4',
    };
    const { errors } = federateSubgraphs([subgraphB, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that unresolvable fields return an error #1', () => {
    const fieldPath = 'query.friend';
    const rootFieldData = newRootFieldData('Query', 'friend', new Set<string>(['subgraph-d']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-f']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphs([subgraphD, subgraphF]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
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
      fieldName: 'nestedObject',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'nestedObject',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-v']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphs([subgraphV, subgraphW]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
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
      fieldName: 'nestedObject',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'nestedObject',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-v']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphs([subgraphW, subgraphV]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that unresolvable fields that are the first fields to be added still return an error', () => {
    const fieldPath = 'query.friend';
    const rootFieldData = newRootFieldData('Query', 'friend', new Set<string>(['subgraph-d']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-f']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphs([subgraphF, subgraphD]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that multiple unresolved fields return an error for each', () => {
    const fieldPath = 'query.friend';
    const rootFieldData = newRootFieldData('Query', 'friend', new Set<string>(['subgraph-d']));
    const fieldDataOne: UnresolvableFieldData = {
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-f']),
      typeName: 'Friend',
    };
    const fieldDataTwo: UnresolvableFieldData = {
      fieldName: 'hobbies',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'hobbies',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-g']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphs([subgraphD, subgraphF, subgraphG]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        fieldDataOne,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData: fieldDataOne }),
      ),
    );
    expect(errors![1]).toStrictEqual(
      unresolvablePathError(
        fieldDataTwo,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData: fieldDataTwo }),
      ),
    );
  });

  test('that shared queries that return a type that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Friend {
        age: Int!
        name: String!
      }
      
      type Query {
        friend: Friend
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that shared queries that return an interface that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphI]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const rootFieldData = newRootFieldData('Query', 'humans', new Set<string>(['subgraph-i']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-j']),
      typeName: 'Friend',
    };
    const { errors } = federateSubgraphs([subgraphI, subgraphJ]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that queries that return nested interfaces whose constituent types are unresolvable return an error', () => {
    const fieldPath = 'query.humans.... on Friend.pets.... on Cat';
    const rootFieldData = newRootFieldData('Query', 'humans', new Set<string>(['subgraph-k']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-l']),
      typeName: 'Cat',
    };
    const { errors } = federateSubgraphs([subgraphK, subgraphL]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that shared queries that return a union that is only resolvable over multiple subgraphs are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphN]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const rootFieldData = newRootFieldData('Query', 'humans', new Set<string>(['subgraph-o']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'age',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'age',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-p']),
      typeName: 'Enemy',
    };
    const { errors } = federateSubgraphs([subgraphO, subgraphP]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that an entity ancestor provides access to an otherwise unreachable field', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphR]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionOnePersistedBaseSchema +
          `
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
            age: Int!
        }
    `,
      ),
    );
  });

  test('that a nested self-referential type does not create an infinite validation loop', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphS, subgraphD]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that unreachable interface implementations do not return an error', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphT, subgraphU]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([subgraphX, subgraphY, subgraphZ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([subgraphAA, subgraphAB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        `
        schema {
          query: Query
          mutation: Mutation
        }` +
          versionOnePersistedDirectiveDefinitions +
          `
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
    const rootFieldData = newRootFieldData('Query', 'entityOne', new Set<string>(['subgraph-ac']));
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-ad',
      typeName: 'EntityOne',
    };
    const fieldDataOne: UnresolvableFieldData = {
      fieldName: 'entityTwo',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'entityTwo',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ac']),
      typeName: 'EntityOne',
    };
    const fieldDataTwo: UnresolvableFieldData = {
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ac']),
      typeName: 'EntityOne',
    };
    const { errors } = federateSubgraphs([subgraphAC, subgraphAD]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        fieldDataOne,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataOne }),
      ),
    );
    expect(errors![1]).toStrictEqual(
      unresolvablePathError(
        fieldDataTwo,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataTwo }),
      ),
    );
  });

  test('that an error is returned if a nested entity cannot access a subgraph where a field is defined #2', () => {
    const fieldPath = 'query.entityOne.entityTwo.entityOne';
    const rootFieldData = newRootFieldData('Query', 'entityOne', new Set<string>(['subgraph-ba']));
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-bb',
      typeName: 'EntityOne',
    };
    const fieldDataOne: UnresolvableFieldData = {
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath + '.object.nestedObject'), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ba']),
      typeName: 'NestedObject',
    };
    const fieldDataTwo: UnresolvableFieldData = {
      fieldName: 'entityTwo',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: false,
        name: 'entityTwo',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-ba']),
      typeName: 'EntityOne',
    };
    const { errors } = federateSubgraphs([subgraphBA, subgraphBB]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        fieldDataOne,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataOne }),
      ),
    );
    expect(errors![1]).toStrictEqual(
      unresolvablePathError(
        fieldDataTwo,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData: fieldDataTwo }),
      ),
    );
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
      fieldName: 'name',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'name',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-af']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphs([subgraphAE, subgraphAF]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  // TODO
  test.skip('that entity keys can be resolved over multiple subgraphs', () => {
    const { errors } = federateSubgraphs([subgraphAG, subgraphAH, subgraphAI, subgraphAJ]);
    expect(errors).toBeUndefined();
  });

  test('that entity resolve chains (leapfrogging) are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAK, subgraphAL, subgraphAM]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that cyclical references are valid', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAN]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([subgraphAP, subgraphAQ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([subgraphAR]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([subgraphAS, subgraphAT]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that inaccessible concrete types that implement an interface are not assessed by the resolvability graph', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAU, subgraphAV]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
      
        scalar openfed__Scope
      `,
      ),
    );
  });

  test('that interface objects do not create false positives #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAW, subgraphAX]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that interface objects do not create false positives #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAX, subgraphAW]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that interface objects can contribute implicit keys #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAY, subgraphAX, subgraphAW]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that interface objects can contribute implicit keys #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAW, subgraphAX, subgraphAY]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that interface objects can contribute implicit keys #1.3', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAY, subgraphAW, subgraphAX]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that inaccessible fields are not considered for resolvability', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphAZ, subgraphAO]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
          type Entity {
            age: Int!
            id: ID!
            name: String! @inaccessible
          }
          
          type Query {
            entities: [Entity!]!
          }
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that shared entity fields do not trigger false positives', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphBC, subgraphBD, subgraphBE]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that shared entity fields frm a root field do not produce false positives', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphBF, subgraphBG]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that interface objects satisfied by implicit keys do not produce false positives', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphBH, subgraphBI]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
          
          scalar openfed__Scope
    `,
      ),
    );
  });

  test('that an error is returned if an interface object cannot be reached', () => {
    const fieldPath = 'query.entity';
    const entityAncestorData: EntityAncestorData = {
      fieldSetsByTargetSubgraphName: new Map<string, Set<string>>(),
      subgraphName: 'subgraph-bh',
      typeName: 'Entity',
    };
    const rootFieldData = newRootFieldData('Query', 'entity', new Set<string>(['subgraph-bh']));
    const unresolvableFieldData: UnresolvableFieldData = {
      fieldName: 'isNew',
      selectionSet: renderSelectionSet(generateSelectionSetSegments(fieldPath), {
        isLeaf: true,
        name: 'isNew',
      } as GraphFieldData),
      subgraphNames: new Set<string>(['subgraph-bi']),
      typeName: 'Entity',
    };
    const { errors } = federateSubgraphs([subgraphBH, subgraphBJ]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ entityAncestorData, rootFieldData, unresolvableFieldData }),
      ),
    );
  });

  test('that a shared entity field cycle is resolvable', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphBK, subgraphBL]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
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
      
          scalar openfed__Scope
    `,
      ),
    );
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
     age: Int!
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
  name: 'subgraph-bi',
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
