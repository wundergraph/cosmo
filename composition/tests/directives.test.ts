import { federateSubgraphs, normalizeSubgraphFromString, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  documentNodeToNormalizedString,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOnePersistedBaseSchema,
} from './utils/utils';

describe('Directive tests', () => {
  describe('Normalization tests', () => {
    test('that @specifiedBy is supported', () => {
      const { errors } = normalizeSubgraphFromString(subgraphAString);
      expect(errors).toBeUndefined();
    });

    test('that directives declared after schema definitions and extensions are still valid #1', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        schema @directiveOne(argOne: "value") {
          query: Queries
        }
        
        type Queries {
          dummy: String!
        }
      
        extend schema @directiveTwo(argOne: "value")
        
        directive @directiveOne(argOne: String!) on SCHEMA
        
        directive @directiveTwo(argOne: String!) on SCHEMA
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          `
        schema @directiveOne(argOne: "value") @directiveTwo(argOne: "value") {
          query: Queries
        }
        
        directive @directiveOne(argOne: String!) on SCHEMA
        directive @directiveTwo(argOne: String!) on SCHEMA` +
            baseDirectiveDefinitions +
            `
        type Queries {
          dummy: String!
        }
        
        scalar openfed__FieldSet
      `,
        ),
      );
    });

    test('that directives declared after schema definitions and extensions are still valid #2', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        extend schema @directiveOne(argOne: "value")
        
        extend schema @directiveTwo(argOne: "value")
        
        directive @directiveOne(argOne: String!) on SCHEMA
        
        directive @directiveTwo(argOne: String!) on SCHEMA
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          `
        directive @directiveOne(argOne: String!) on SCHEMA
        directive @directiveTwo(argOne: String!) on SCHEMA` +
            baseDirectiveDefinitions +
            `scalar openfed__FieldSet`,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    test('that @specifiedBy is supported', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionOnePersistedBaseSchema +
            `
          type Query {
            json: JSON!
            field: String!
          }
          
          scalar JSON
        `,
        ),
      );
    });
  });

  test('that schema directives are supported', () => {
    const { errors } = federateSubgraphs([
      {
        name: 'test',
        url: '',
        definitions: parse(`
# @contact isn't being printed to the generated-schema.graphql file
# See https://github.com/apollographql/federation/issues/1847
extend schema
  @contact(
    name: "Manage X Team"
    url: "https://company.enterprise.com"
    description: "tag @oncall-manage-x for urgent issues."
  )
  @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: [
      "@key"
      "@extends"
      "@shareable"
      "@inaccessible"
      "@override"
      "@external"
      "@provides"
      "@requires"
      "@tag"
      "@composeDirective"
      "@interfaceObject"
    ]
  )
directive @contact(
  "Contact title of the subgraph owner"
  name: String!
  "URL where the subgraph's owner can be reached"
  url: String
  "Other relevant notes can be included here; supports markdown links"
  description: String
) on SCHEMA


type Query {
  couponsByUserId(merchantId: ID!): [Coupon!]
}

type Coupon @key(fields: "id") {
  id: ID!
  code: String
  description: String
}
      `),
      },
    ]);
    expect(errors).toBeUndefined();
  });
});

const subgraphAString = `
  type Query {
    json: JSON!
  }
  
  scalar JSON @specifiedBy(url: "https://wundergraph.com")
`;

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(subgraphAString),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
  type Query {
    field: String!
  }`),
};
