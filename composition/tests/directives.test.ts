import { federateSubgraphs, normalizeSubgraphFromString, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneSchemaQueryAndPersistedDirectiveDefinitions,
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
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneSchemaQueryAndPersistedDirectiveDefinitions +
            `
        scalar JSON
        
        type Query {
          field: String!
          json: JSON!
        }
      `,
        ),
      );
    });
  });

  test('that directives', () => {
    const { errors, federationResult } = federateSubgraphs([
      { name: 'a', url: '', definitions: parse(`directive @test on OBJECT type Query { dummy: String! }`) },
      { name: 'b', url: '', definitions: parse(`directive @test(a: String!) on OBJECT`) },
    ]);
    expect(errors).toBeUndefined();
  });

  test('that schema directives are supported', () => {
    const { errors } = federateSubgraphs([
      {
        name: 'test',
        url: '',
        definitions: parse(`
          extend schema @schemaDirective(name: "name", url: "url", description: "description")
          
          directive @schemaDirective(
            "Description for the name argument"
            name: String!
            "Description for the url argument"
            url: String
            "Description for the description argument"
            description: String
          ) on SCHEMA
          
          type Query {
            dummy: String!
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
