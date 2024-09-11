import { describe, expect, test } from 'vitest';
import {
  allExternalFieldInstancesError,
  EXTERNAL,
  externalInterfaceFieldsError,
  externalInterfaceFieldsWarning,
  federateSubgraphs,
  invalidDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
  N_A,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  parse,
  Subgraph,
} from '../src';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('@external directive tests', () => {
  describe('Normalization tests', () => {
    // TODO external validation  (fieldset)
    test('that @external declared on the object level applies to its defined fields #1.1', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
          nonExternalFieldOne: Boolean!
        }
        
        extend type Object @external {
          externalFieldTwo: Int!
          externalFieldThree: Float
        }
        
        extend type Object @external {
          """
            This is the description for Object.externalFieldFour
          """
          externalFieldFour: String!
        }
        
        extend type Object {
          nonExternalFieldTwo(argOne: Int, """This is a description for Object.nonExternalFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonExternalFieldThree: Boolean
        }
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Object {
              """
              This is the description for Object.externalFieldFour
              """
              externalFieldFour: String! @external
              externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
              externalFieldThree: Float @external
              externalFieldTwo: Int! @external
              nonExternalFieldOne: Boolean!
              nonExternalFieldThree: Boolean
              nonExternalFieldTwo(argOne: Int"""This is a description for Object.nonExternalFieldTwo.argTwo"""argTwo: Boolean!): Float!
            }

            scalar openfed__FieldSet
          `,
        ),
      );
    });

    test('that @external declared on the object level applies to all its defined fields #1.2', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        extend type Object @external {
          """
            This is the description for Object.externalFieldFour
          """
          externalFieldFour: String!
        }
        
        extend type Object {
          nonExternalFieldTwo(argOne: Int, """This is a description for Object.nonExternalFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonExternalFieldThree: Boolean
        }
        
        extend type Object @external {
          externalFieldTwo: Int!
          externalFieldThree: Float
        }
        
        type Object {
          externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
          nonExternalFieldOne: Boolean!
        }
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Object {
              """
              This is the description for Object.externalFieldFour
              """
              externalFieldFour: String! @external
              externalFieldOne(argOne: String!, argTwo: Boolean!): String @external
              externalFieldThree: Float @external
              externalFieldTwo: Int! @external
              nonExternalFieldOne: Boolean!
              nonExternalFieldThree: Boolean
              nonExternalFieldTwo(argOne: Int"""This is a description for Object.nonExternalFieldTwo.argTwo"""argTwo: Boolean!): Float!
            }

            scalar openfed__FieldSet
          `,
        ),
      );
    });

    test('that @external declared on both the parent and field level is not repeated', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphF.definitions);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
            type Entity @key(fields: "id") {
              field: String! @external
              id: ID! @external
            }

            scalar openfed__FieldSet
          `,
        ),
      );
    });

    test('that an error is returned if @external is repeated on the same level', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphG.definitions);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidDirectiveError(EXTERNAL, 'Entity.field', [
          invalidRepeatedDirectiveErrorMessage(EXTERNAL, 'Entity.field'),
        ]),
      ]);
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const { errors } = normalizeSubgraph(
        parse(`
          type Query @shareable {
            dummy: String!
          }

          interface Interface {
            name: String! @external
          }
        `),
      );
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['name']));
    });

    test('that an error is returned if a V2 interface field is declared @external', () => {
      const { errors } = normalizeSubgraph(
        parse(`
          type Query @shareable {
            dummy: String!
          }

          interface Interface {
            id: ID!
          }

          extend interface Interface {
            age: Int! @external
            name: String! @external
          }
        `),
      );
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(externalInterfaceFieldsError('Interface', ['age', 'name']));
    });

    test('that a warning is returned if a V1 interface fields are declared @external', () => {
      const { errors, warnings } = normalizeSubgraph(
        parse(`
          interface Interface {
            age: Int! @external
            id: ID!
            name: String! @external
          }`),
      );
      expect(errors).toBeUndefined();
      expect(warnings).toBeDefined();
      expect(warnings).toHaveLength(1);
      expect(warnings![0]).toStrictEqual(externalInterfaceFieldsWarning(N_A, 'Interface', ['age', 'name']));
    });

    test('that a warning is returned if a V1 interface extension field is declared @external', () => {
      const { errors, warnings } = normalizeSubgraph(
        parse(`
          interface Interface {
            name: String!
          }

          extend interface Interface {
            age: Int! @external
            id: ID! @external
          }
        `),
      );
      expect(errors).toBeUndefined();
      expect(warnings).toBeDefined();
      expect(warnings).toHaveLength(1);
      expect(warnings![0]).toStrictEqual(externalInterfaceFieldsWarning(N_A, 'Interface', ['age', 'id']));
    });
  });

  describe('Federation tests', () => {
    test('that @external does not contribute to shareability checks #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.3', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphA, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.4', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.5', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #2.6', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphB, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            type EntityTwo implements Interface {
              age: Int!
              field: String!
              id: ID!
              isEntity: Boolean!
              name: String!
            }

            interface Interface {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
              entityTwo: EntityTwo!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #3.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              field: String!
              id: ID!
            }

            type Query {
              anotherField: Entity!
              field: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @external does not contribute to shareability checks #3.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
            type Entity {
              field: String!
              id: ID!
            }

            type Query {
              anotherField: Entity!
              field: Entity!
            }

            scalar openfed__Scope
          `,
        ),
      );
    });

    test('that an error is returned if all instances of a field are declared @external #1', () => {
      const { errors } = federateSubgraphs([subgraphH, subgraphI]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        allExternalFieldInstancesError(
          'Entity',
          new Map<string, Array<string>>([['name', ['subgraph-h', 'subgraph-i']]]),
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphK]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #2.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphL, subgraphM]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
            }
          `,
        ),
      );
    });

    test('that composition is successful if at least one field is not declared @external #2.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphL]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity {
              id: ID!
              name: String!
            }

            type Query {
              entity: Entity!
            }
          `,
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
      entity: Entity!
      entityTwo: EntityTwo!
    }
    
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      isEntity: Boolean!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external @shareable
      field: String!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      field: String!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      isEntity: Boolean!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      field: Entity!
    }
    
    type Entity @extends @key(fields: "id") {
      id: ID!
      field: String! @external
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query @shareable {
      anotherField: Entity!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      field: String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @external {
      id: ID!
      field: String! @external
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      field: String! @external @external
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

    type Entity @key(fields: "id") {
      id: ID!
      name: String! @external
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID! @external
      name: String! @external
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @extends @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID! @external
      name: String! @external
    }
  `),
};
