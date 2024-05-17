import {
  federateSubgraphs,
  ImplementationErrors,
  InvalidFieldImplementation,
  invalidImplementedTypeError,
  noFieldDefinitionsError,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  selfImplementationError,
  Subgraph,
  invalidInterfaceImplementationError,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { normalizeString, schemaToSortedNormalizedString, versionTwoRouterDefinitions } from './utils/utils';

describe('Interface tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if an interface does not define any fields', () => {
      const { errors } = normalizeSubgraphFromString(`
        interface Interface
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError('interface', 'Interface'));
    });

    test('that an error is returned if an extended interface does not define any fields', () => {
      const { errors } = normalizeSubgraphFromString(`
        interface Interface
        
        extend interface Interface @tag(name: "test")
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError('interface', 'Interface'));
    });

    test('that errors are returned if implemented interface fields are invalid #1', () => {
      const { errors } = normalizeSubgraphFromString(`
        interface Animal {
          name: String!
          sounds(species: String!): [String!]
        }
          
        interface Pet implements Animal {
          age: Int!
          isDog: Boolean!
          name: String!
          sounds(species: String): [String]!
        }
        
        type Cat implements Pet & Animal {
          isDog: Boolean! @inaccessible
          isPurring: Boolean!
          sounds: [String!]!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Pet',
          'interface',
          new Map<string, ImplementationErrors>([
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      implementedResponseType: '[String]!',
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'String', argumentName: 'species', expectedType: 'String!' },
                      ],
                      isInaccessible: false,
                      originalResponseType: '[String!]',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Cat',
          'object',
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'isDog',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: true,
                      originalResponseType: 'Boolean!',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: '[String]!',
                      unimplementedArguments: new Set<string>(['species']),
                    },
                  ],
                ]),
                unimplementedFields: ['age', 'name'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: '[String!]',
                      unimplementedArguments: new Set<string>(['species']),
                    },
                  ],
                ]),
                unimplementedFields: ['name'],
              },
            ],
          ]),
        ),
      );
    });

    test('that errors are returned if implemented interface fields are invalid #2', () => {
      const { errors } = normalizeSubgraphFromString(`
        interface Animal {
          name: String!
          sound(a: String!, b: Int, c: Float, d: Boolean): String!
        }
          
        interface Pet implements Animal {
          age: Int!
          sound(a: Int, b: String!): String!
        }
        
        extend interface Pet {
          price: Float
          name: String!
        }
        
        type Cat implements Pet & Animal {
          isPurring: Boolean!
          sound(e: Int!): String!
        }
        
        type Cat @extends {
          name: String!
        }  
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Pet',
          'interface',
          new Map<string, ImplementationErrors>([
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sound',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'Int', argumentName: 'a', expectedType: 'String!' },
                        { actualType: 'String!', argumentName: 'b', expectedType: 'Int' },
                      ],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(['c', 'd']),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Cat',
          'object',
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sound',
                    {
                      invalidAdditionalArguments: new Set<string>(['e']),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(['a', 'b']),
                    },
                  ],
                ]),
                unimplementedFields: ['age', 'price'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sound',
                    {
                      invalidAdditionalArguments: new Set<string>(['e']),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String',
                      unimplementedArguments: new Set<string>(['a', 'b', 'c', 'd']),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });

    test('that an error is returned if a type attempts to implement a type that is not an interface', () => {
      const { errors } = normalizeSubgraph(subgraphG.definitions, subgraphG.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidImplementedTypeError(
          'Object',
          new Map<string, string>([
            ['Interface', 'object'],
            ['Scalar', 'scalar'],
          ]),
        ),
      );
    });

    test('that an error is returned if an interface attempts to implement itself', () => {
      const { errors } = normalizeSubgraph(subgraphH.definitions, subgraphH.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(selfImplementationError('Interface'));
    });
  });

  describe('Federation tests', () => {
    test('that interfaces merge by union', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
      interface Character {
        age: Int!
        isFriend: Boolean!
        name: String!
      }

      type Query {
        dummy: String!
      }

      type Rival implements Character {
        age: Int!
        isFriend: Boolean!
        name: String!
      }
      
      type Trainer implements Character {
        age: Int!
        badges: Int!
        isFriend: Boolean!
        name: String!
      }

      scalar openfed__Scope
    `,
        ),
      );
    });

    test('that interfaces and implementations merge by union', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
      interface Character {
        age: Int!
        isFriend: Boolean!
        name: String!
      }
      
      interface Human {
        name: String!
      }

      type Query {
        dummy: String!
      }

      type Trainer implements Character & Human {
        age: Int!
        badges: Int!
        isFriend: Boolean!
        name: String!
      }
      
      scalar openfed__Scope
    `,
        ),
      );
    });

    test('that nested interfaces merge by union', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
      interface Character {
        isFriend: Boolean!
      }

      interface Human implements Character {
        isFriend: Boolean!
        name: String!
      }

      type Query {
        dummy: String!
      }

      type Trainer implements Character & Human {
        isFriend: Boolean!
        name: String!
      }
      
      scalar openfed__Scope
    `,
        ),
      );
    });

    test('that errors are returned if implemented interface fields are invalid #1', () => {
      const { errors } = federateSubgraphs([subgraphE, subgraphF]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Cat',
          'object',
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
                unimplementedFields: ['name'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
                unimplementedFields: ['name'],
              },
            ],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Dog',
          'object',
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'String', argumentName: 'a', expectedType: 'String!' },
                        { actualType: 'Int', argumentName: 'b', expectedType: 'Int!' },
                      ],
                      isInaccessible: false,
                      originalResponseType: 'String',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: ['age'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'String', argumentName: 'a', expectedType: 'String!' },
                        { actualType: 'Int', argumentName: 'b', expectedType: 'Int!' },
                      ],
                      isInaccessible: false,
                      originalResponseType: 'String',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String! @shareable
    }

    interface Character {
      name: String!
    }
    
    interface Character @extends {
      age: Int!
    }

    type Trainer implements Character {
      name: String! @shareable
      age: Int!
      badges: Int!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Character {
      isFriend: Boolean!
    }

    type Rival implements Character {
      name: String!
      age: Int!
      isFriend: Boolean!
    }

    type Trainer implements Character {
      isFriend: Boolean!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String! @shareable
    }

    interface Character {
      isFriend: Boolean!
    }

    interface Human {
      name: String!
    }

    type Trainer implements Character & Human @shareable {
      name: String!
      isFriend: Boolean!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    interface Character {
      isFriend: Boolean!
    }

    interface Human implements Character {
      name: String!
      isFriend: Boolean!
    }

    type Trainer implements Character & Human @shareable {
      name: String!
      isFriend: Boolean!
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    interface Animal {
      sounds(a: String!, b: Int!): [String]
    }
      
    interface Pet implements Animal {
      age: Int!
      sounds(a: String!, b: Int!): [String]!
    }
    
    type Cat implements Pet & Animal {
      age: Int!
      isPurring: Boolean!
      sounds(a: String!, b: Int!): [String!]!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    interface Animal {
      name: String!
      sounds(a: String, b: Int): [String]
    }
      
    interface Pet implements Animal {
      name: String!
      sounds(a: String, b: Int): [String]
    }
    
    type Dog implements Pet & Animal {
      name: String!
      sounds(a: String, b: Int): [String!]
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Object implements Interface & Scalar {
      name: String!
    }
    
    type Interface {
      name: String!
    }
    
    scalar Scalar
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    interface Interface implements Interface {
      name: String!
    }
  `),
};
