import { describe, expect, test } from 'vitest';
import {
  FieldData,
  invalidFieldShareabilityError,
  NormalizationSuccess,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  ObjectDefinitionData,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { versionTwoDirectiveDefinitions, versionTwoRouterDefinitions } from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('@shareable directive tests', () => {
  describe('Normalization tests', () => {
    test('that @shareable declared on the object level applies to all its defined fields #1.1', () => {
      const result = normalizeSubgraphFromString(
        `
        type Object {
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          nonShareableFieldOne: Boolean!
        }
        
        extend type Object @shareable {
          shareableFieldTwo: Int!
          shareableFieldThree: Float
        }
        
        extend type Object @shareable {
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String!
        }
        
        extend type Object {
          nonShareableFieldTwo(argOne: Int, """This is a description for Object.nonShareableFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonShareableFieldThree: Boolean
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          versionTwoDirectiveDefinitions +
            `
         type Object {
          nonShareableFieldOne: Boolean!
          nonShareableFieldThree: Boolean
          nonShareableFieldTwo(argOne: Int"""This is a description for Object.nonShareableFieldTwo.argTwo"""argTwo: Boolean!): Float!
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String! @shareable
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          shareableFieldThree: Float @shareable
          shareableFieldTwo: Int! @shareable
        }
        
        scalar openfed__FieldSet
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that @shareable declared on the object level applies to all its defined fields #1.2', () => {
      const result = normalizeSubgraphFromString(
        `
        extend type Object @shareable {
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String!
        }
        
        extend type Object {
          nonShareableFieldTwo(argOne: Int, """This is a description for Object.nonShareableFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonShareableFieldThree: Boolean
        }
        
        extend type Object @shareable {
          shareableFieldTwo: Int!
          shareableFieldThree: Float
        }
        
        type Object {
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          nonShareableFieldOne: Boolean!
        }
      `,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          versionTwoDirectiveDefinitions +
            `
         type Object {
          nonShareableFieldOne: Boolean!
          nonShareableFieldThree: Boolean
          nonShareableFieldTwo(argOne: Int"""This is a description for Object.nonShareableFieldTwo.argTwo"""argTwo: Boolean!): Float!
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String! @shareable
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          shareableFieldThree: Float @shareable
          shareableFieldTwo: Int! @shareable
        }
        
        scalar openfed__FieldSet
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that @shareable declared on both the parent and field level is not repeated', () => {
      const result = normalizeSubgraph(
        subgraphD.definitions,
        subgraphD.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          versionTwoDirectiveDefinitions +
            `
           type Entity @key(fields: "id") {
            field: String! @shareable
            id: ID! @shareable
           }
           
           scalar openfed__FieldSet
           
           scalar openfed__Scope
          `,
        ),
      );
    });

    test('that @shareable can be repeated', () => {
      const result = normalizeSubgraph(
        subgraphE.definitions,
        subgraphE.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toStrictEqual(
        normalizeString(
          versionTwoDirectiveDefinitions +
            `
          type Entity @key(fields: "id") {
            field: String! @shareable
            id: ID!
            name: String! @shareable
          }
          
          scalar openfed__FieldSet
          
          scalar openfed__Scope
        `,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    test('that @shareable functions with extensions correctly #1.1', () => {
      const result = federateSubgraphsSuccess([subgraphA, subgraphB, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Entity implements Interface {
          field: String!
          id: ID!
        }
        
        interface Interface {
          field: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
        ),
      );
    });

    test('that @shareable functions with extensions correctly #1.2', () => {
      const result = federateSubgraphsSuccess([subgraphA, subgraphC, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Entity implements Interface {
          field: String!
          id: ID!
        }
        
        interface Interface {
          field: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
        ),
      );
    });

    test('that @shareable functions with extensions correctly #1.3', () => {
      const result = federateSubgraphsSuccess([subgraphB, subgraphA, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Entity implements Interface {
          field: String!
          id: ID!
        }
        
        interface Interface {
          field: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
        ),
      );
    });

    test('that @shareable functions with extensions correctly #1.4', () => {
      const result = federateSubgraphsSuccess([subgraphB, subgraphC, subgraphA], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Entity implements Interface {
          field: String!
          id: ID!
        }
        
        interface Interface {
          field: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
        ),
      );
    });

    test('that @shareable functions with extensions correctly #1.5', () => {
      const result = federateSubgraphsSuccess([subgraphC, subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Entity implements Interface {
          field: String!
          id: ID!
        }
        
        interface Interface {
          field: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
        ),
      );
    });

    test('that @shareable functions with extensions correctly #1.6', () => {
      const result = federateSubgraphsSuccess([subgraphC, subgraphB, subgraphA], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Entity implements Interface {
          field: String!
          id: ID!
        }
        
        interface Interface {
          field: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
        ),
      );
    });
  });

  test('that an error is returned if a V2 implicit key field is not declared @shareable #1.1', () => {
    const result = federateSubgraphsFailure([subgraphF, subgraphG], ROUTER_COMPATIBILITY_VERSION_ONE);
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
                  ['subgraph-f', true],
                  ['subgraph-g', false],
                ]),
              } as FieldData,
            ],
          ]),
        } as ObjectDefinitionData,
        new Set<string>(['id', 'name', 'field']),
      ),
    );
  });

  test('that an error is returned if a V2 implicit key field is not declared @shareable #1.2', () => {
    const result = federateSubgraphsFailure([subgraphG, subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE);
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
                  ['subgraph-f', true],
                  ['subgraph-g', false],
                ]),
              } as FieldData,
            ],
          ]),
        } as ObjectDefinitionData,
        new Set<string>(['id', 'name', 'field']),
      ),
    );
  });

  test('that an @external key field does not contribute to @shareable errors #1.1', () => {
    const result = federateSubgraphsSuccess([subgraphG, subgraphH], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity {
          field: String!
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
      ),
    );
  });

  test('that an @external key field does not contribute to @shareable errors #1.2', () => {
    const result = federateSubgraphsSuccess([subgraphH, subgraphG], ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Entity {
          field: String!
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
        }
        
        scalar openfed__Scope`,
      ),
    );
  });

  test('that an @external key field does not contribute to @shareable errors #1.3', () => {
    const result = federateSubgraphsFailure([subgraphG, subgraphH, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
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
                  ['subgraph-g', false],
                  ['subgraph-h', true],
                  ['subgraph-i', false],
                ]),
              } as FieldData,
            ],
          ]),
        } as ObjectDefinitionData,
        new Set<string>(['id', 'name', 'field']),
      ),
    );
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      field: String! @shareable
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Interface {
      field: String!
    }
    
    extend type Entity implements Interface @key(fields: "id") {
      id: ID!
      field: String! @external
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    interface Interface {
      field: String!
    }
    
    extend type Entity implements Interface @key(fields: "id") @shareable {
      id: ID!
      field: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @shareable {
      id: ID!
      field: String! @shareable
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      field: String! @shareable @shareable
    }
    
    extend type Entity @shareable {
      name: String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @extends @key(fields: "id name") {
      id: ID! @external
      name: String! @external
      field: String! @shareable
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      field: String! @shareable
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }
    
    type Entity @key(fields: "id name") {
      id: ID!
      name: String! @external
      field: String! @shareable
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      field: String! @shareable
    }
  `),
};
