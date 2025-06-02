import { describe, expect, test } from 'vitest';
import {
  allChildDefinitionsAreInaccessibleError,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  FIELD,
  FieldData,
  ImplementationErrors,
  inaccessibleRequiredInputValueError,
  InputValueData,
  INTERFACE,
  InvalidFieldImplementation,
  invalidFieldShareabilityError,
  invalidInterfaceImplementationError,
  NormalizationResultFailure,
  normalizeSubgraph,
  OBJECT,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  UNION,
} from '../../../src';
import { schemaQueryDefinition, versionTwoRouterDefinitions } from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { Kind } from 'graphql';

describe('@inaccessible tests', () => {
  test('that inaccessible fields are included in client schema but not the router schema', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphB],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String! @inaccessible
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema!)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
      }
      
      type Query {
        entity: Entity!
      }
    `,
      ),
    );
  });

  test('that inaccessible fields are still subject to @shareable errors', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphC],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          name: 'Entity',
          fieldDataByName: new Map<string, FieldData>([
            [
              'name',
              {
                isShareableBySubgraphName: new Map<string, boolean>([
                  ['subgraph-a', true],
                  ['subgraph-c', false],
                ]),
              } as FieldData,
            ],
          ]),
        } as ObjectDefinitionData,
        new Set<string>(['name']),
      ),
    );
  });

  test('that composition is successful if a field is declared @inaccessible in both the interface definition and its implementation,', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphD],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Entity implements Interface {
        id: ID!
        name: String! @inaccessible
      }
      
      interface Interface {
        id: ID!
        name: String! @inaccessible
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema!)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity implements Interface {
        id: ID!
      }
      
      interface Interface {
        id: ID!
      }
      
      type Query {
        entity: Entity!
      }
    `,
      ),
    );
  });

  test('that composition is successful if a field is declared @inaccessible in the interface but not in the implementation,', () => {
    const result = federateSubgraphs(
      [subgraphB, subgraphH],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
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
        id: ID!
        name: String @inaccessible
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity implements Interface {
        age: Int!
        id: ID!
        name: String!
      }
      
      interface Interface {
        id: ID!
      }
      
      type Query {
        entity: Entity!
      }
    `,
      ),
    );
  });

  test('that an error is returned if an interface field is @inaccessible but the implementation field is not defined,', () => {
    const result = normalizeSubgraph(
      subgraphE.definitions,
      subgraphE.name,
      undefined,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidInterfaceImplementationError(
        'Entity',
        OBJECT,
        new Map<string, ImplementationErrors>([
          [
            INTERFACE,
            {
              invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
              unimplementedFields: ['name'],
            },
          ],
        ]),
      ),
    );
  });

  test('that an error is returned if an interface field is @inaccessible but the implementation field is not defined #2,', () => {
    const result = federateSubgraphs(
      [subgraphF, subgraphG],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidInterfaceImplementationError(
        'Entity',
        OBJECT,
        new Map<string, ImplementationErrors>([
          [
            INTERFACE,
            {
              invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
              unimplementedFields: ['name'],
            },
          ],
        ]),
      ),
    );
  });

  test('that an error is returned if all fields defined on an object are declared @inaccessible', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphI],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(OBJECT, OBJECT, FIELD));
  });

  test('that an error is returned if all fields defined on an extended object are declared @inaccessible', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphJ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(OBJECT, OBJECT, FIELD));
  });

  test('that an error is returned if all fields defined on an interface are declared @inaccessible', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphK],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(INTERFACE, INTERFACE, FIELD));
  });

  test('that an error is returned if all fields defined on an extended interface are declared @inaccessible', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphL],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(INTERFACE, INTERFACE, FIELD));
  });

  test('that an inaccessible interface without accessible references is removed from the client schema', () => {
    const result = federateSubgraphs(
      [subgraphM, subgraphN],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      interface Interface @inaccessible {
        name: String!
      }
      
      type Object implements Interface {
        name: String!
      }
      
      type Query {
        dummy: String!
        interface: Interface! @inaccessible
      }
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that an inaccessible object is removed from a union', () => {
    const result = federateSubgraphs(
      [subgraphO, subgraphP],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type ObjectOne @inaccessible {
        name: String!
      }
      
      type ObjectTwo {
        age: Int! @inaccessible
        name: String!
      }
      
      type Query {
        dummy: String!
        objectOne: ObjectOne @inaccessible
        union: Union!
      }
      
      union Union = ObjectOne | ObjectTwo
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type ObjectTwo {
        name: String!
      }
      
      type Query {
        dummy: String!
        union: Union!
      }
      
      union Union = ObjectTwo
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated to children and arguments', () => {
    const result = federateSubgraphs(
      [subgraphP, subgraphQ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type ObjectOne @inaccessible {
        scalar: Scalar!
      }
      
      type ObjectThree {
        name: String!
      }
      
      type ObjectTwo @inaccessible {
        field(s: Scalar!): String!
      }
      
      type Query {
        dummy: String!
        objectOne: ObjectOne! @inaccessible
        objectThree: ObjectThree!
        objectTwo: ObjectTwo! @inaccessible
      }
      
      scalar Scalar @inaccessible
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type ObjectThree {
        name: String!
      }
      
      type Query {
        dummy: String!
        objectThree: ObjectThree!
      }
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated across subgraphs #1.1', () => {
    const result = federateSubgraphs(
      [subgraphR, subgraphS],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object @inaccessible {
        scalar(scalar: Scalar!): Scalar!
        scalarTwo(scalar: Scalar!): Scalar!
      }
      
      type Query {
        dummy: String!
        object: Object! @inaccessible
      }
      
      scalar Scalar @inaccessible
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated across subgraphs #1.2', () => {
    const result = federateSubgraphsSuccess([subgraphS, subgraphR], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object @inaccessible {
        scalar(scalar: Scalar!): Scalar!
        scalarTwo(scalar: Scalar!): Scalar!
      }
      
      type Query {
        dummy: String!
        object: Object! @inaccessible
      }
      
      scalar Scalar @inaccessible
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that @inaccessible fields do not affect resolvability #1.1', () => {
    const result = federateSubgraphs(
      [subgraphT, subgraphU],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object {
        scalar(scalar: Scalar!): Scalar!
        scalarTwo(scalar: Scalar!): Scalar! @inaccessible
      }
      
      type Query {
        dummy: String!
        object: Object!
      }
      
      scalar Scalar
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        scalar(scalar: Scalar!): Scalar!
      }
      
      type Query {
        dummy: String!
        object: Object!
      }
      
      scalar Scalar
    `,
      ),
    );
  });

  test('that @inaccessible fields do not affect resolvability #1.2', () => {
    const result = federateSubgraphs(
      [subgraphU, subgraphT],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object {
        scalar(scalar: Scalar!): Scalar!
        scalarTwo(scalar: Scalar!): Scalar! @inaccessible
      }
      
      type Query {
        dummy: String!
        object: Object!
      }
      
      scalar Scalar
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        scalar(scalar: Scalar!): Scalar!
      }
      
      type Query {
        dummy: String!
        object: Object!
      }
      
      scalar Scalar
    `,
      ),
    );
  });

  test('that an error is returned if a required field argument is declared @inaccessible in isolation', () => {
    const result = federateSubgraphsFailure([subgraphV, subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Object.scalar(scalar: ...)',
          kind: Kind.ARGUMENT,
          name: 'scalar',
        } as InputValueData,
        'Object.scalar',
      ),
    );
  });

  test('that a required field argument can be declared @inaccessible if its field or parent is declared @inaccessible', () => {
    const result = federateSubgraphsSuccess([subgraphW, subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object {
        name: String!
        scalar(scalar: Scalar! @inaccessible): Scalar! @inaccessible
      }
      
      type ObjectTwo @inaccessible {
        scalar(scalar: Scalar! @inaccessible): Scalar!
      }
      
      type Query {
        dummy: String!
        object: Object!
        objectTwo: ObjectTwo @inaccessible
      }
      
      scalar Scalar
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name: String!
      }
      
      type Query {
        dummy: String!
        object: Object!
      }
      
      scalar Scalar
    `,
      ),
    );
  });

  test('that an error is returned if all members of a union are inaccessible', () => {
    const result = federateSubgraphs(
      [subgraphX, subgraphP],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      allChildDefinitionsAreInaccessibleError(UNION, 'Union', 'union member type'),
    );
  });

  test('that an @inaccessible only needs to be declared on a single field #1.1', () => {
    const result = federateSubgraphs([subgraphY, subgraphZ, subgraphAA]);
    expect(result.success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.2', () => {
    const result = federateSubgraphs([subgraphY, subgraphAA, subgraphZ]);
    expect(result.success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.3', () => {
    const result = federateSubgraphs([subgraphZ, subgraphY, subgraphAA]);
    expect(result.success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.3', () => {
    const result = federateSubgraphs([subgraphZ, subgraphAA, subgraphY]);
    expect(result.success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.3', () => {
    const result = federateSubgraphs([subgraphAA, subgraphY, subgraphZ]);
    expect(result.success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.3', () => {
    const result = federateSubgraphs([subgraphAA, subgraphZ, subgraphY]);
    expect(result.success).toBe(true);
  });

  test('that an error is returned if a required argument is declared @inaccessible in isolation #1', () => {
    const result = federateSubgraphsFailure([faa], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Object.name(input: ...)',
          kind: Kind.ARGUMENT,
          name: 'input',
        } as InputValueData,
        'Object.name',
      ),
    );
  });

  test('that an error is returned if a required argument is declared @inaccessible in isolation #2.1', () => {
    const result = federateSubgraphsFailure([fab, fac], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Entity.name(input: ...)',
          kind: Kind.ARGUMENT,
          name: 'input',
        } as InputValueData,
        'Entity.name',
      ),
    );
  });

  test('that an error is returned if a required argument is declared @inaccessible in isolation #2.2', () => {
    const result = federateSubgraphsFailure([fac, fab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Entity.name(input: ...)',
          kind: Kind.ARGUMENT,
          name: 'input',
        } as InputValueData,
        'Entity.name',
      ),
    );
  });

  test('that an error is returned if a required Input field is declared @inaccessible in isolation #1', () => {
    const result = federateSubgraphsFailure([fag], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Input.name',
          kind: Kind.INPUT_VALUE_DEFINITION,
          name: 'name',
        } as InputValueData,
        'Input',
      ),
    );
  });

  test('that an error is returned if a required Input field is declared @inaccessible in isolation #2.1', () => {
    const result = federateSubgraphsFailure([fah, fai], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Input.name',
          kind: Kind.INPUT_VALUE_DEFINITION,
          name: 'name',
        } as InputValueData,
        'Input',
      ),
    );
  });

  test('that an error is returned if a required Input field is declared @inaccessible in isolation #2.2', () => {
    const result = federateSubgraphsFailure([fai, fah], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      inaccessibleRequiredInputValueError(
        {
          federatedCoords: 'Input.name',
          kind: Kind.INPUT_VALUE_DEFINITION,
          name: 'name',
        } as InputValueData,
        'Input',
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the field is also declared @inaccessible #1.1', () => {
    const result = federateSubgraphsSuccess([fac, fad], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity {
          id: ID!
          name(input: String! @inaccessible): String! @inaccessible
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the field is also declared @inaccessible #1.2', () => {
    const result = federateSubgraphsSuccess([fad, fac], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity {
          id: ID!
          name(input: String! @inaccessible): String! @inaccessible
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the parent Object is also declared @inaccessible #1.1', () => {
    const result = federateSubgraphsSuccess([fae, faf], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity @inaccessible {
          id: ID!
          name(input: String! @inaccessible): String!
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the parent Object is also declared @inaccessible #1.2', () => {
    const result = federateSubgraphsSuccess([faf, fae], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity @inaccessible {
          id: ID!
          name(input: String! @inaccessible): String!
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that an Input field can be declared @inaccessible if the parent Input Object is also declared @inaccessible #1.1', () => {
    const result = federateSubgraphsSuccess([faj, fak], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        input Input @inaccessible {
          id: ID!
          name: String! @inaccessible
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that an Input field can be declared @inaccessible if the parent Input Object is also declared @inaccessible #1.2', () => {
    const result = federateSubgraphsSuccess([fak, faj], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        input Input @inaccessible {
          id: ID!
          name: String! @inaccessible
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

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @shareable
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String! @inaccessible
    }
    
    type Entity implements Interface @key(fields: "id") @shareable {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String! @inaccessible
    }
    
    type Entity implements Interface @key(fields: "id") @shareable {
      id: ID!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    interface Interface {
      id: ID!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String @inaccessible
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    interface Interface {
      id: ID!
      name: String @inaccessible
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Object {
      name: String! @inaccessible
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Object {
      name: String! @inaccessible
    }
    
    extend type Object {
      age: Int! @inaccessible
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String! @inaccessible
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String! @inaccessible
    }
    
    extend interface Interface {
      age: Int! @inaccessible
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    interface Interface @inaccessible {
      name: String!
    }
    
    type Object implements Interface {
      name: String!
    }
    
    type Query {
      interface: Interface! @inaccessible
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type ObjectOne @inaccessible {
      name: String!
    }
    
    type ObjectTwo {
      age: Int! @inaccessible
      name: String!
    }
    
    type Query {
      objectOne: ObjectOne @inaccessible
      union: Union!
    }
    
    union Union = ObjectOne | ObjectTwo
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type ObjectOne @inaccessible {
      scalar: Scalar!
    }
    
    type ObjectTwo @inaccessible {
      field(s: Scalar!): String!
    }
    
    type ObjectThree {
      name: String!
    }
    
    type Query {
      objectOne: ObjectOne! @inaccessible
      objectTwo: ObjectTwo! @inaccessible
      objectThree: ObjectThree!
    }
    
    scalar Scalar @inaccessible
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Object @inaccessible {
      scalar(scalar: Scalar!): Scalar!
    }
    
    type Query {
      dummy: String!
      object: Object! @inaccessible
    }
    
    scalar Scalar @inaccessible
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Object {
      scalarTwo(scalar: Scalar!): Scalar!
    }
    
    scalar Scalar
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Object {
      scalar(scalar: Scalar!): Scalar!
    }
    
    type Query {
      dummy: String!
      object: Object!
    }
    
    scalar Scalar
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    type Object {
      scalarTwo(scalar: Scalar!): Scalar! @inaccessible
    }
    
    scalar Scalar
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    type Object {
      scalar(scalar: Scalar! @inaccessible): Scalar!
    }
    
    type Query {
      object: Object!
    }
    
    scalar Scalar
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
      scalar(scalar: Scalar! @inaccessible): Scalar! @inaccessible
    }
    
    type ObjectTwo @inaccessible {
      scalar(scalar: Scalar! @inaccessible): Scalar!
    }
    
    type Query {
      object: Object!
      objectTwo: ObjectTwo @inaccessible
    }
    
    scalar Scalar
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    type Object @inaccessible {
      name: String!
    }
    
    union Union = Object
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    type Query @shareable {
      object: Object!
    }
    
    type Object @shareable {
      id: ID!
      inaccessibleField: String! @inaccessible
    }
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    type Query @shareable {
      object: Object!
    }
    
    type Object @shareable {
      age: Int!
      inaccessibleField: String! @inaccessible
    }
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    type Query @shareable {
      object: Object!
    }
    
    type Object @shareable {
      name: String!
      inaccessibleField: String!
    }
  `),
};

const faa: Subgraph = {
  name: 'faa',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object {
      id: ID!
      name(input: String! @inaccessible): String!
    }
  `),
};

const fab: Subgraph = {
  name: 'fab',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      name(input: String!): String!
    }
  `),
};

const fac: Subgraph = {
  name: 'fac',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(input: String! @inaccessible): String!
    }
  `),
};

const fad: Subgraph = {
  name: 'fad',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(input: String!): String! @inaccessible
    }
  `),
};

const fae: Subgraph = {
  name: 'fae',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(input: String! @inaccessible): String!
    }
  `),
};

const faf: Subgraph = {
  name: 'faf',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @shareable @inaccessible {
      id: ID!
      name(input: String!): String!
    }
  `),
};

const fag: Subgraph = {
  name: 'fag',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    input Input {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const fah: Subgraph = {
  name: 'fah',
  url: '',
  definitions: parse(`
    type Query {
      field(input: Input!): String!
    }
    
    input Input {
      id: ID!
      name: String!
    }
  `),
};

const fai: Subgraph = {
  name: 'fai',
  url: '',
  definitions: parse(`
    input Input {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const faj: Subgraph = {
  name: 'faj',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    input Input {
      id: ID!
      name: String! @inaccessible
    }
  `),
};

const fak: Subgraph = {
  name: 'fak',
  url: '',
  definitions: parse(`
    input Input @inaccessible {
      id: ID!
      name: String!
    }
  `),
};
