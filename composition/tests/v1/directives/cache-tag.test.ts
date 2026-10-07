import { describe, expect, test } from 'vitest';
import {
  CACHE_TAG,
  type CacheTagConfiguration,
  emptyCacheTagFormatErrorMessage,
  FIRST_ORDINAL,
  FORMAT,
  invalidArgumentValueErrorMessage,
  invalidCacheTagArgumentTypeErrorMessage,
  invalidCacheTagPlaceholderErrorMessage,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  NON_NULLABLE_STRING,
  nonRootFieldCacheTagErrorMessage,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  type TypeName,
  invalidCacheTagBraceErrorMessage,
  undefinedCacheTagArgumentErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unsupportedCacheTagLocationWarning,
  unsupportedFieldCacheTagNamespaceErrorMessage,
} from '../../../src';
import {
  createSubgraph,
  createSubgraphWithDefaultName,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { CACHE_TAG_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from '../utils/utils';

/* @cacheTag is modeled on the Apollo Federation v2.12 directive:
 *   directive @cacheTag(format: String!) repeatable on FIELD_DEFINITION | OBJECT
 *
 * Only a Query root field is supported here.
 */
describe('@cacheTag tests', () => {
  describe('format validation tests', () => {
    test('that a malformed placeholder is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(searchKey: String!): [Product!]! @cacheTag(format: "{args.searchKey}-{$args}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      // Neither a missing "$" sigil nor a missing argument name forms a placeholder.
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidCacheTagPlaceholderErrorMessage('args.searchKey'),
          invalidCacheTagPlaceholderErrorMessage('$args'),
        ]),
      );
    });

    test('that a placeholder with an empty path segment is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(searchKey: String!): [Product!]! @cacheTag(format: "products-{$args.searchKey.}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidCacheTagPlaceholderErrorMessage('$args.searchKey.'),
        ]),
      );
    });

    test('that an unclosed placeholder is rejected rather than treated as literal text', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(searchKey: String!): [Product!]! @cacheTag(format: "products-{$args.searchKey")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidCacheTagBraceErrorMessage('products-{$args.searchKey'),
        ]),
      );
    });
  });

  describe('field definition tests', () => {
    test('that the directive is retained in the normalized schema without a warning', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(
        createSubgraph(
          'a',
          `
          type Query {
            a: ID @cacheTag(format: "test")
          }
        `,
        ),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}

          ${CACHE_TAG_DIRECTIVE}

          type Query {
            a: ID @cacheTag(format: "test")
          }
        `),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a static format on a root Query field produces a CacheTagConfiguration', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            type Query {
              products(searchKey: String!): [Product!]! @cacheTag(format: "products")
            }
            type Product @key(fields: "id") {
              id: ID!
            }
          `),
          'Query',
        ),
        // The configuration is attached to the parent type and identifies the field it tags.
      ).toStrictEqual([
        { fieldName: 'products', format: 'products', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
    });

    test('that the directive is repeatable upon a field definition', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            type Query {
              products: [Product!]! @cacheTag(format: "products") @cacheTag(format: "catalogue")
              product(id: ID!): Product @cacheTag(format: "product")
            }
            type Product @key(fields: "id") {
              id: ID!
            }
          `),
          'Query',
        ),
      ).toStrictEqual([
        { fieldName: 'products', format: 'products', typeName: 'Query' },
        { fieldName: 'products', format: 'catalogue', typeName: 'Query' },
        { fieldName: 'product', format: 'product', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
    });

    test('that a renamed Query root type is recognised', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            schema { query: Queries }
            type Queries {
              products: [Product!]! @cacheTag(format: "products")
            }
            type Product @key(fields: "id") {
              id: ID!
            }
          `),
          // Root types are renamed to their default names, by which the ConfigurationData is keyed.
          'Query',
        ),
      ).toStrictEqual([
        { fieldName: 'products', format: 'products', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
    });

    /* Apollo permits @cacheTag upon any root field, so a Mutation or Subscription root field composes.
     * Only a Query root field produces a cached response, so the directive is ignored with a warning.
     */
    test('that the directive upon a Mutation root field is ignored with a warning', () => {
      const { configurationDataByTypeName, warnings } = normalizeSubgraphSuccess(
        createSubgraph(
          'a',
          `
          type Query { product(id: ID!): Product }
          type Mutation { addProduct: Product @cacheTag(format: "products") @cacheTag(format: "catalogue") }
          type Product @key(fields: "id") { id: ID! }
        `,
        ),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      // A repeated directive upon the same field is reported once.
      expect(warnings).toStrictEqual([
        unsupportedCacheTagLocationWarning({ coords: 'Mutation.addProduct', subgraphName: 'a' }),
      ]);
      expect(configurationDataByTypeName.get('Mutation')?.entityCaching).toBeUndefined();
    });

    test('that the directive upon a Subscription root field is ignored with a warning', () => {
      const { configurationDataByTypeName, warnings } = normalizeSubgraphSuccess(
        createSubgraph(
          'a',
          `
          type Query { product(id: ID!): Product }
          type Subscription { productUpdated: Product @cacheTag(format: "products") }
          type Product @key(fields: "id") { id: ID! }
        `,
        ),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([
        unsupportedCacheTagLocationWarning({ coords: 'Subscription.productUpdated', subgraphName: 'a' }),
      ]);
      expect(configurationDataByTypeName.get('Subscription')?.entityCaching).toBeUndefined();
    });

    // Apollo rejects @cacheTag upon a non-root field (CACHE_TAG_APPLIED_TO_NON_ROOT_FIELD).
    test('that the directive upon a field of a non-root Object is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") {
            id: ID!
            reviews: [String!]! @cacheTag(format: "reviews")
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Product.reviews', FIRST_ORDINAL, [nonRootFieldCacheTagErrorMessage()]),
      );
    });

    test('that a repeated directive upon an invalid field is reported once', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") {
            id: ID!
            reviews: [String!]! @cacheTag(format: "reviews") @cacheTag(format: "ratings")
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Product.reviews', FIRST_ORDINAL, [nonRootFieldCacheTagErrorMessage()]),
      );
    });

    // An Interface field is never a root field; Apollo rejects it as an unexpected directive target.
    test('that the directive upon an Interface field is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { node: Node }
          interface Node { id: ID! @cacheTag(format: "node") }
          type Product implements Node { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Node.id', FIRST_ORDINAL, [nonRootFieldCacheTagErrorMessage()]),
      );
    });

    test('that an "$args" placeholder referencing an argument is valid', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            enum Region { EU US }
            type Query {
              products(searchKey: String!, region: Region): [Product!]!
                @cacheTag(format: "products-{$args.searchKey}-{ $args.region }")
            }
            type Product @key(fields: "id") {
              id: ID!
            }
          `),
          'Query',
        ),
      ).toStrictEqual([
        // An Enum argument is a valid reference, and the format is stored verbatim.
        { fieldName: 'products', format: 'products-{$args.searchKey}-{ $args.region }', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
    });

    test('that an "$args" placeholder referencing a custom Scalar argument is valid', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            scalar DateTime
            type Query {
              products(after: DateTime): [Product!]! @cacheTag(format: "products-{$args.after}")
            }
            type Product @key(fields: "id") {
              id: ID!
            }
          `),
          'Query',
        ),
      ).toStrictEqual([
        { fieldName: 'products', format: 'products-{$args.after}', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
    });

    test('that an "$args" placeholder referencing an Input Object field is valid', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            input Filter { category: String! nested: NestedFilter }
            input NestedFilter { depth: Int! }
            type Query {
              products(filter: Filter!): [Product!]!
                @cacheTag(format: "products-{$args.filter.category}-{$args.filter.nested.depth}")
            }
            type Product @key(fields: "id") {
              id: ID!
            }
          `),
          'Query',
        ),
      ).toStrictEqual([
        {
          fieldName: 'products',
          format: 'products-{$args.filter.category}-{$args.filter.nested.depth}',
          typeName: 'Query',
        },
      ] satisfies Array<CacheTagConfiguration>);
    });

    test('that an "$args" placeholder referencing an undefined argument is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(searchKey: String!): [Product!]! @cacheTag(format: "products-{$args.searchKeys}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          undefinedCacheTagArgumentErrorMessage('searchKeys'),
        ]),
      );
    });

    test('that an "$args" placeholder referencing a non-leaf argument is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          input Filter { category: String! }
          type Query {
            products(filter: Filter!): [Product!]! @cacheTag(format: "products-{$args.filter}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      // The argument itself is an Input Object, so it cannot be interpolated into a tag.
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidCacheTagArgumentTypeErrorMessage({ reference: 'filter', typeString: 'Filter!' }),
        ]),
      );
    });

    test('that an "$args" placeholder referencing a list argument is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(ids: [ID!]!): [Product!]! @cacheTag(format: "products-{$args.ids}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidCacheTagArgumentTypeErrorMessage({ reference: 'ids', typeString: '[ID!]!' }),
        ]),
      );
    });

    test('that an "$args" path that traverses a list is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          input Filter { category: String! }
          type Query {
            products(filters: [Filter!]!): [Product!]! @cacheTag(format: "products-{$args.filters.category}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      // A list of Input Objects yields no single value, so "filters.category" does not resolve.
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          undefinedCacheTagArgumentErrorMessage('filters.category'),
        ]),
      );
    });

    test('that a namespace other than "$args" is rejected upon a field', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(id: ID!): [Product!]! @cacheTag(format: "products-{$request.id}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          unsupportedFieldCacheTagNamespaceErrorMessage('request'),
        ]),
      );
    });

    /* A key is a property of an entity rather than of the response a field-level tag identifies, so "$key"
     * is rejected upon a Query root field even where the returned entity does declare that key field.
     */
    test('that a "$key" placeholder is rejected upon a field that returns an entity', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            product(id: ID!): Product @cacheTag(format: "product-{$key.id}")
          }
          type Product @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.product', FIRST_ORDINAL, [
          unsupportedFieldCacheTagNamespaceErrorMessage('key'),
        ]),
      );
    });

    test('that a malformed format upon a field definition is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products: [Product!]! @cacheTag(format: "")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [emptyCacheTagFormatErrorMessage()]),
      );
    });

    // Generic directive validation reports a missing or non-String format, so no second error is added.
    test('that a missing format is reported once', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products: [Product!]! @cacheTag
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          undefinedRequiredArgumentsErrorMessage(CACHE_TAG, [FORMAT], []),
        ]),
      );
    });

    test('that a non-String format is reported once', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products: [Product!]! @cacheTag(format: 1)
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('1', `@${CACHE_TAG}`, FORMAT, NON_NULLABLE_STRING),
        ]),
      );
    });

    test('that a null format is reported once', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products: [Product!]! @cacheTag(format: null)
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('null', `@${CACHE_TAG}`, FORMAT, NON_NULLABLE_STRING),
        ]),
      );
    });
  });

  describe('location tests', () => {
    test('that the directive is rejected on an Interface', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { node: Node }
          interface Node @cacheTag(format: "node") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Node', FIRST_ORDINAL, [
          invalidDirectiveLocationErrorMessage(CACHE_TAG, 'INTERFACE'),
        ]),
      );
    });

    /* Apollo permits @cacheTag on FIELD_DEFINITION and OBJECT, but only a Query root field is supported here.
     * An Object usage is accepted, so that Apollo subgraphs compose, and ignored with a warning.
     */
    test('that the directive upon an Object is ignored with a warning', () => {
      const { configurationDataByTypeName, warnings } = normalizeSubgraphSuccess(
        createSubgraph(
          'a',
          `
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @cacheTag(format: "product-{$key.id}") @cacheTag(format: "product") {
            id: ID!
          }
        `,
        ),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      // A repeated directive upon the same Object is reported once.
      expect(warnings).toStrictEqual([unsupportedCacheTagLocationWarning({ coords: 'Product', subgraphName: 'a' })]);
      expect(configurationDataByTypeName.get('Product')!.entityCaching).toBeUndefined();
    });
  });
});

// Returns the CacheTagConfigurations for a type. Entity-caching config is nested under `.entityCaching`.
function getCacheTagConfigurations(subgraph: Subgraph, typeName: TypeName): Array<CacheTagConfiguration> | undefined {
  const { configurationDataByTypeName, warnings } = normalizeSubgraphSuccess(
    subgraph,
    ROUTER_COMPATIBILITY_VERSION_ONE,
  );
  // A supported usage must not produce a warning.
  expect(warnings).toHaveLength(0);
  const configurationData = configurationDataByTypeName.get(typeName);
  expect(configurationData).toBeDefined();
  return configurationData!.entityCaching?.cacheTagConfigurations;
}
