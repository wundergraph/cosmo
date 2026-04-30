import { describe, expect, test } from 'vitest';
import {
  createSubgraph,
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  invalidCustomDirectiveError,
  invalidLinkDirectiveImportObjectError,
  invalidLinkDirectiveUrlError,
  invalidRepeatedComposedDirectiveWarning,
  invalidSubValueLinkDirectiveImportError,
  invalidVersionLinkDirectiveUrlError,
  noFeatureNameLinkDirectiveUrlError,
  noLeadingAtComposeDirectiveNameError,
  noNameFieldLinkDirectiveImportObjectError,
  nonEqualComposeDirectiveMajorVersionError,
  nonEqualCoreFeatureComposeDirectiveError,
  noPathLinkDirectiveUrlError,
  noVersionLinkDirectiveUrlError,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  undefinedRequiredArgumentsError,
  unimportedComposeDirectiveNameError,
  unknownFieldLinkDirectiveImportObjectError,
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

    test('that an error is returned if a feature URL does not defines an invalid URL', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "test")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([invalidLinkDirectiveUrlError('test')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL does not define a path component #1', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([noPathLinkDirectiveUrlError('https://a')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL does not define a path component #2', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([noPathLinkDirectiveUrlError('https://a/')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL does not define a feature name component #1', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a//v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([noFeatureNameLinkDirectiveUrlError('https://a//v1.0')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL does not define a feature name component #2', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([noFeatureNameLinkDirectiveUrlError('https://a/v1.0')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL does not define version string', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/a/")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([noVersionLinkDirectiveUrlError('https://a/a/')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL ends with an invalid version #1', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/a")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([invalidVersionLinkDirectiveUrlError({ url: 'https://a/a', versionString: 'a' })]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL ends with an invalid version #2', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/a/v1")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidVersionLinkDirectiveUrlError({ url: 'https://a/a/v1', versionString: 'v1' }),
      ]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a feature URL ends with an invalid version #3', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/a/v1.0.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidVersionLinkDirectiveUrlError({ url: 'https://a/a/v1.0.0', versionString: 'v1.0.0' }),
      ]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a directive is imported with an invalid import object', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: [{ a: "a" }], url: "https://a/a/v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(2);
      expect(errors).toStrictEqual([
        unknownFieldLinkDirectiveImportObjectError({ fieldName: 'a', value: '{a: "a"}' }),
        noNameFieldLinkDirectiveImportObjectError('{a: "a"}'),
      ]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a directive is renamed to a non-directive', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: [{ name: "@a", as: "b" }], url: "https://a/a/v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([invalidLinkDirectiveImportObjectError({ name: '@a', rename: 'b' })]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a non-directive is renamed to a directive', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: [{ name: "a", as: "@b" }], url: "https://a/a/v1.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([invalidLinkDirectiveImportObjectError({ name: 'a', rename: '@b' })]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if an import sub-value is not a string nor object', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a", { name: "@b", as: "@z" }, 1, true, "@c"], url: "https://a/a/v1.0.0")
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(2);
      expect(errors).toStrictEqual([
        invalidSubValueLinkDirectiveImportError(2),
        invalidSubValueLinkDirectiveImportError(3),
      ]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a non-directive is composed', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @link(import: ["@a"], url: "https://a/a/v1.0")
        @composeDirective(name: "a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([noLeadingAtComposeDirectiveNameError('a')]);
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if a directive is composed without an import', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
        schema 
        @composeDirective(name: "@a") {
          query: Query
        }
        
        directive @a on FIELD_DEFINITION
        
        type Query {
          a: ID @a
        }
        `,
      );
      const { errors, warnings } = normalizeSubgraphFailure(aaaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([unimportedComposeDirectiveNameError('@a')]);
      expect(warnings).toHaveLength(0);
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

    test('that different core features can import the same named directive if only one is composed #1', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
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
      const aaaab = createSubgraph(
        'aaaab',
        `
      schema
      @link(import: ["@a"], url: "https://a/b/v1.0") {
        query: Query
      }
      
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
          """a"""
          directive @a(a: String!) on FIELD_DEFINITION
          
          type Query {
            a: ID @a(a: "a")
          }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that different core features can import the same named directive if only one is composed #2', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
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
      const aaaab = createSubgraph(
        'aaaab',
        `
      schema
      @link(import: ["@a"], url: "https://a/b/v1.0") {
        query: Query
      }
      
      directive @a(a: String!) on FIELD_DEFINITION
      
      type Query @shareable {
        a: ID @a(a: "b")
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
          """a"""
          directive @a(a: String!) on FIELD_DEFINITION
          
          type Query {
            a: ID @a(a: "a")
          }
        `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings).toStrictEqual([
        invalidRepeatedComposedDirectiveWarning({
          directiveCoords: 'Query.a',
          directiveName: 'a',
          printedDirective: '@a(a: "a")',
        }),
      ]);
    });

    test('that different core features can import the same named directive if only one is composed #3', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      schema
      @link(import: ["@a"], url: "https://a/a/v1.0")
      @composeDirective(name: "@a") {
        query: Query
      }
      
      """
      a
      """
      directive @a(a: String!) repeatable on FIELD_DEFINITION
      
      type Query @shareable {
        a: ID @a(a: "a")
      }
  `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
      schema
      @link(import: ["@a"], url: "https://a/b/v1.0") {
        query: Query
      }
      
      directive @a(a: String!) on FIELD_DEFINITION
      
      type Query @shareable {
        a: ID @a(a: "b")
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
          """a"""
          directive @a(a: String!) repeatable on FIELD_DEFINITION
          
          type Query {
            a: ID @a(a: "a") @a(a: "b")
          }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

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

    test('that @composeDirective propagates the definition but no usages of a directive if there are no references to the directive within the composing subgraphs', () => {
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
        directive @a on FIELD | FIELD_DEFINITION
        
        type Query {
          a: ID
        }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that @composeDirective propagates the highest version of the directive only', () => {
      const aaaaa = createSubgraph(
        'aaaaa',
        `
      extend schema
        @link(import: ["@a"], url: "https://a/a/v1.10")
        @composeDirective(name: "@a")
        
        directive @a(a: Int!) repeatable on FIELD | FIELD_DEFINITION
        
        type Query @shareable {
          a: ID @a(a: 1)
        }
    `,
      );
      const aaaab = createSubgraph(
        'aaaab',
        `
        extend schema
          @link(import: ["@a"], url: "https://a/a/v1.9")
          @composeDirective(name: "@a")
          
        directive @a(a: Int) on FIELD | FIELD_DEFINITION
        
        type Query @shareable {
          a: ID @a(a: 2)
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
        directive @a(a: Int!) repeatable on FIELD | FIELD_DEFINITION
        
        type Query {
          a: ID @a(a: 1) @a(a: 2)
        }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});
