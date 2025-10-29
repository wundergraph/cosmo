import { describe, expect, test } from 'vitest';
import {
  allChildDefinitionsAreInaccessibleError,
  FIELD,
  FieldData,
  ImplementationErrors,
  inaccessibleRequiredInputValueError,
  InputValueData,
  INTERFACE,
  InvalidFieldImplementation,
  invalidFieldShareabilityError,
  invalidInterfaceImplementationError,
  OBJECT,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  UNION,
} from '../../../src';
import { INACCESSIBLE_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { Kind } from 'graphql';

describe('@inaccessible tests', () => {
  test('that inaccessible fields are included in client schema but not the router schema', () => {
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphA, subgraphB],
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
        entity: Entity!
      }
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { errors } = federateSubgraphsFailure([subgraphA, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphA, subgraphD],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphB, subgraphH],
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
        name: String @inaccessible
      }
      
      type Query {
        entity: Entity!
      }
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { errors } = normalizeSubgraphFailure(subgraphE, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([subgraphF, subgraphG], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([subgraphA, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(OBJECT, OBJECT, FIELD));
  });

  test('that an error is returned if all fields defined on an extended object are declared @inaccessible', () => {
    const { errors } = federateSubgraphsFailure([subgraphA, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(OBJECT, OBJECT, FIELD));
  });

  test('that an error is returned if all fields defined on an interface are declared @inaccessible', () => {
    const { errors } = federateSubgraphsFailure([subgraphA, subgraphK], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(INTERFACE, INTERFACE, FIELD));
  });

  test('that an error is returned if all fields defined on an extended interface are declared @inaccessible', () => {
    const { errors } = federateSubgraphsFailure([subgraphA, subgraphL], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(INTERFACE, INTERFACE, FIELD));
  });

  test('that an inaccessible interface without accessible references is removed from the client schema', () => {
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphM, subgraphN],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphO, subgraphP],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphP, subgraphQ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphR, subgraphS],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated across subgraphs #1.2', () => {
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphS, subgraphR],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that @inaccessible fields do not affect resolvability #1.1', () => {
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphT, subgraphU],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphU, subgraphT],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { errors } = federateSubgraphsFailure([subgraphV, subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
      [subgraphW, subgraphP],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
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
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
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
    const { errors } = federateSubgraphsFailure([subgraphX, subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(UNION, 'Union', 'union member type'));
  });

  test('that an @inaccessible only needs to be declared on a single field #1.1', () => {
    const { success } = federateSubgraphsSuccess([subgraphY, subgraphZ, subgraphAA], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.2', () => {
    const { success } = federateSubgraphsSuccess([subgraphY, subgraphAA, subgraphZ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.3', () => {
    const { success } = federateSubgraphsSuccess([subgraphZ, subgraphY, subgraphAA], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.4', () => {
    const { success } = federateSubgraphsSuccess([subgraphZ, subgraphAA, subgraphY], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.5', () => {
    const { success } = federateSubgraphsSuccess([subgraphAA, subgraphY, subgraphZ], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(success).toBe(true);
  });

  test('that an @inaccessible only needs to be declared on a single field #1.6', () => {
    const { success } = federateSubgraphsSuccess([subgraphAA, subgraphZ, subgraphY], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(success).toBe(true);
  });

  test('that an error is returned if a required argument is declared @inaccessible in isolation #1', () => {
    const { errors } = federateSubgraphsFailure([faa], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([fab, fac], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([fac, fab], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([fag], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([fah, fai], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { errors } = federateSubgraphsFailure([fai, fah], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
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
    const { federatedGraphSchema } = federateSubgraphsSuccess([fac, fad], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        type Entity {
          id: ID!
          name(input: String! @inaccessible): String! @inaccessible
        }
        
        type Query {
          entities: [Entity!]!
        }
    `,
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the field is also declared @inaccessible #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fad, fac], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        type Entity {
          id: ID!
          name(input: String! @inaccessible): String! @inaccessible
        }
        
        type Query {
          entities: [Entity!]!
        }
    `,
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the parent Object is also declared @inaccessible #1.1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fae, faf], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        type Entity @inaccessible {
          id: ID!
          name(input: String! @inaccessible): String!
        }
        
        type Query {
          dummy: String!
        }
    `,
      ),
    );
  });

  test('that a field argument can be declared @inaccessible if the parent Object is also declared @inaccessible #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([faf, fae], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        type Entity @inaccessible {
          id: ID!
          name(input: String! @inaccessible): String!
        }
        
        type Query {
          dummy: String!
        }
    `,
      ),
    );
  });

  test('that an Input field can be declared @inaccessible if the parent Input Object is also declared @inaccessible #1.1', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([faj, fak], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        input Input @inaccessible {
          id: ID!
          name: String! @inaccessible
        }
        
        type Query {
          dummy: String!
        }
    `,
      ),
    );
  });

  test('that an Input field can be declared @inaccessible if the parent Input Object is also declared @inaccessible #1.2', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess([fak, faj], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          `
        input Input @inaccessible {
          id: ID!
          name: String! @inaccessible
        }
        
        type Query {
          dummy: String!
        }
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
