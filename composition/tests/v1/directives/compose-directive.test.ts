import { describe, expect, test } from 'vitest';
import {
  createSubgraph,
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  invalidCustomDirectiveError,
  nonEqualComposeDirectiveMajorVersionError,
  nonEqualCoreFeatureComposeDirectiveError,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  undefinedRequiredArgumentsError,
} from '../../../src';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';

describe('@composeDirective tests', () => {
  describe('Normalization tests', () => {
    test('that a valid custom directive can be provided successfully', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { schema } = normalizeSubgraphSuccess(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
        schema 
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        directive @composeDirective(name: String!) repeatable on SCHEMA
        
        directive @link(as: String, for: link__Purpose, import: [link__Import], url: String!) repeatable on SCHEMA
        
        type Query {
          a: ID @a
        }
        
        scalar link__Import
        
        enum link__Purpose {
         EXECUTION
         SECURITY
        }
      `),
      );
    });
  });

  describe('Federation tests', () => {
    test('that a custom directive is propagated in the federated graph successfully (schema)', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")  {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [aaaaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      
      type Query {
        a: ID
      }
    `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      directive @a on FIELD_DEFINITION
      
      type Query {
        a: ID @a
      }
    `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a custom directive is propagated in the federated graph successfully (extend schema)', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")  {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
      type Query {
        a: ID @a
      }
    `,
      );
      const { federatedGraphSchema, warnings } = federateSubgraphsSuccess([aaaaa], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      directive @a on FIELD_DEFINITION
      
      type Query {
        a: ID @a
      }
    `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a custom directive is propagated in the federated graph successfully (extend schema #2)', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD_DEFINITION
        
      type Object {
        a: ID @a
      }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
        type Query {
          a: ID
        }
        `,
      );
      const { federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [aaaaa, aaaab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      directive @a on FIELD_DEFINITION
      
      type Object {
        a: ID @a
      }
      
      type Query {
        a: ID
      }
    `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that equivalent directives defined on the same coordinates are not repeated', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      schema
      @link(import: ["@a"], url: "https://a/a/v1.0")
      @composeDirective(name: "@a") {
        query: Query
      }
      
      directive @a(a: String!) on FIELD_DEFINITION
      
      type Query @shareable {
        a: ID @a(a: "a")
      }
  `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
      schema
      @link(import: ["@a"], url: "https://a/a/v1.0")
      @composeDirective(name: "@a") {
        query: Query
      }
      
      """
      a
      """
      directive @a(a: String!) on FIELD_DEFINITION
      
      type Query @shareable {
        a: ID @a(a: "a")
      }
  `,
      );
      const { federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [aaaaa, aaaab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          directive @a(a: String!) on FIELD_DEFINITION
          
          type Query {
            a: ID @a(a: "a")
          }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test.todo('that different core features can import the same named directive if only one is composed');

    test('that an error is returned if a directive is composed with different core features', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD_DEFINITION
        
      type Query @shareable{
        a: ID @a
      }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/b/v1.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD_DEFINITION
        
      type Query @shareable{
        a: ID @a
      }
        `,
      );
      const { errors, warnings } = federateSubgraphsFailure([aaaaa, aaaab], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([nonEqualCoreFeatureComposeDirectiveError('@a')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a composed directive does not conform to the highest minor version definition', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.1")
        @composeDirective(name: "@a")
        
        directive @a(a: ID!) on FIELD_DEFINITION
        
      type Query @shareable{
        a: ID @a(a: "a")
      }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD_DEFINITION
        
      type Query @shareable{
        a: ID @a
      }
        `,
      );
      const { errors, warnings } = federateSubgraphsFailure([aaaaa, aaaab], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidCustomDirectiveError({
          directiveCoords: 'Query.a',
          directiveName: 'a',
          errors: [undefinedRequiredArgumentsError(['a'])],
          ordinal: '2nd',
        }),
      ]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a composed directive defines different major versions across subgraphs', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v2.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD_DEFINITION
        
      type Query @shareable{
        a: ID @a
      }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD_DEFINITION
        
      type Query @shareable{
        a: ID @a
      }
        `,
      );
      const { errors, warnings } = federateSubgraphsFailure([aaaaa, aaaab], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([nonEqualComposeDirectiveMajorVersionError('@a')]);
      expect(warnings).toHaveLength(0);
    });

    test('that @composeDirective does not treat an executable location differently', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v2.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD | FIELD_DEFINITION
        
        type Query @shareable {
          a: ID @a
        }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
        directive @a on FIELD | FIELD_DEFINITION
        
        type Query @shareable {
          a: ID @a
        }
        `,
      );
      const { federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [aaaaa, aaaab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        directive @a on FIELD | FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that @composeDirective does not propagate any directives if there are no references to the directive within that subgraph', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "@a")
        
        directive @a on FIELD | FIELD_DEFINITION
        
        type Query @shareable {
          a: ID
        }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
        directive @a on FIELD | FIELD_DEFINITION
        
        type Query @shareable {
          a: ID @a
        }
        `,
      );
      const { federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [aaaaa, aaaab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Query {
          a: ID
        }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});
