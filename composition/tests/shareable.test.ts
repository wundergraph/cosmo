import { describe, expect, test } from 'vitest';
import { federateSubgraphs, normalizeSubgraphFromString, Subgraph } from '../src';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoDirectiveDefinitions,
  versionTwoSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';
import { parse } from 'graphql';

describe('@shareable directive tests', () => {
  describe('Normalization tests', () => {
    test('that @shareable declared on the object level applies to all its defined fields #1.1', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          nonShareableFieldOne: Boolean!
        }
        
        extend type Object @shareable {
          shareableFieldTwo: Int!
          shareableFieldThree: Float
        }
        
        type Object @shareable @extends {
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String!
        }
        
        extend type Object {
          nonShareableFieldTwo(argOne: Int, """This is a description for Object.nonShareableFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonShareableFieldThree: Boolean
        }
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object @shareable @extends {
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
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
  });
  describe('Federation tests', () => {
    test('that @shareable functions with extensions correctly #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphA, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphB, subgraphA]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
