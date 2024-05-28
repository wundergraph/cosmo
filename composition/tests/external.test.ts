import { describe, expect, test } from 'vitest';
import {
  EXTERNAL,
  federateSubgraphs,
  invalidDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  Subgraph,
} from '../src';
import { parse } from 'graphql';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoDirectiveDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('@external directive tests', () => {
  describe('Normalization tests', () => {
    // TODO external validation  (fieldset/interfaces)
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
        
        type Object @external @extends {
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
        type Object @external @extends {
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
