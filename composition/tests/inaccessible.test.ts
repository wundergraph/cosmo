import { describe, expect, test } from 'vitest';
import {
  allChildDefinitionsAreInaccessibleError,
  federateSubgraphs,
  FieldData,
  ImplementationErrors,
  inaccessibleRequiredArgumentError,
  InvalidFieldImplementation,
  invalidFieldShareabilityError,
  invalidInterfaceImplementationError,
  normalizeSubgraph,
  ObjectDefinitionData,
  Subgraph,
} from '../src';
import { parse } from 'graphql';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoClientDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';
import { FIELD, UNION } from '../src/utils/string-constants';

describe('@inaccessible tests', () => {
  test('that inaccessible fields are included in client schema but not the router schema', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
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
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema!)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Entity {
        age: Int!
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

  test('that inaccessible fields are still subject to @shareable errors', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidFieldShareabilityError(
        {
          name: 'Entity',
          fieldDataByFieldName: new Map<string, FieldData>([
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
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphD]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema!)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
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
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that composition is successful if a field is declared @inaccessible in the interface but not in the implementation,', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphH]);
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
        name: String @inaccessible
      }
      
      type Query {
        entity: Entity!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
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
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that an error is returned if an interface field is @inaccessible but the implementation field is not defined,', () => {
    const { errors } = normalizeSubgraph(subgraphE.definitions);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidInterfaceImplementationError(
        'Entity',
        'object',
        new Map<string, ImplementationErrors>([
          [
            'Interface',
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
    const { errors } = federateSubgraphs([subgraphF, subgraphG]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      invalidInterfaceImplementationError(
        'Entity',
        'object',
        new Map<string, ImplementationErrors>([
          [
            'Interface',
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
    const { errors } = federateSubgraphs([subgraphA, subgraphI]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allChildDefinitionsAreInaccessibleError('object', 'Object', FIELD));
  });

  test('that an error is returned if all fields defined on an extended object are declared @inaccessible', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphJ]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allChildDefinitionsAreInaccessibleError('object', 'Object', FIELD));
  });

  test('that an error is returned if all fields defined on an interface are declared @inaccessible', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphK]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allChildDefinitionsAreInaccessibleError('interface', 'Interface', FIELD));
  });

  test('that an error is returned if all fields defined on an extended interface are declared @inaccessible', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphL]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allChildDefinitionsAreInaccessibleError('interface', 'Interface', FIELD));
  });

  test('that an inaccessible interface without accessible references is removed from the client schema', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphN]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Object {
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

  test('that an inaccessible object is removed from a union', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphO, subgraphP]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type ObjectTwo {
        name: String!
      }
      
      type Query {
        dummy: String!
        union: Union!
      }
      
      union Union = ObjectTwo
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated to children and arguments', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphP, subgraphQ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type ObjectThree {
        name: String!
      }
      
      type Query {
        dummy: String!
        objectThree: ObjectThree!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated across subgraphs #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphR, subgraphS]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Query {
        dummy: String!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that the @inaccessible state is propagated across subgraphs #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphS, subgraphR]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Query {
        dummy: String!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that @inaccessible fields do not affect resolvability #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphT, subgraphU]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Object {
        scalar(scalar: Scalar!): Scalar!
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
  });

  test('that @inaccessible fields do not affect resolvability #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphU, subgraphT]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Object {
        scalar(scalar: Scalar!): Scalar!
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
  });

  test('that an error is returned if a required field argument is declared @inaccessible in isolation', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphV, subgraphP]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      inaccessibleRequiredArgumentError('scalar', 'Object.scalar(scalar: ...)', 'Object.scalar'),
    );
  });

  test('that a required field argument can be declared @inaccessible if its field or parent is declared @inaccessible', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphW, subgraphP]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        versionTwoClientDefinitions +
          `
      type Object {
        name: String!
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
  });

  test('that an error is returned if all members of a union are inaccessible', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphX, subgraphP]);
    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(allChildDefinitionsAreInaccessibleError(UNION, 'Union', 'union member type'));
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
    type Object @inaccessible{
      name: String!
    }
    
    union Union = Object
  `),
};
