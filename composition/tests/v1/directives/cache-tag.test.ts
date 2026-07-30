import { describe, expect, test } from 'vitest';
import {
  CACHE_TAG,
  type CacheTagConfiguration,
  emptyCacheTagFormatErrorMessage,
  FIRST_ORDINAL,
  invalidCacheTagArgumentTypeErrorMessage,
  invalidCacheTagPlaceholderErrorMessage,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidQueryRootFieldErrorMessage,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  type TypeName,
  unbalancedCacheTagFormatErrorMessage,
  undefinedCacheTagArgumentErrorMessage,
  unsupportedFieldCacheTagNamespaceErrorMessage,
} from '../../../src';
import { createSubgraphWithDefaultName, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

/* @cacheTag is modelled on the Apollo Federation v2.12 directive:
 *   directive @cacheTag(format: String!) repeatable on FIELD_DEFINITION | OBJECT
 * Only FIELD_DEFINITION is supported here, and only upon a Query root field, where the sole supported
 * placeholder is "{$args.<argumentName>}", which interpolates an argument of the field itself. A field of
 * an Input Object argument is referenced by a period-delimited path, e.g. "{$args.filter.category}".
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
          unbalancedCacheTagFormatErrorMessage('products-{$args.searchKey'),
        ]),
      );
    });
  });

  describe('field definition tests', () => {
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

    /* A tag identifies a cached response, which only a Query root field produces, so any other field
     * definition is rejected rather than silently ignored.
     */
    test('that the directive upon a Mutation field is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { product(id: ID!): Product }
          type Mutation { addProduct: Product @cacheTag(format: "products") }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Mutation.addProduct', FIRST_ORDINAL, [invalidQueryRootFieldErrorMessage()]),
      );
    });

    test('that the directive upon a Subscription field is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { product(id: ID!): Product }
          type Subscription { productUpdated: Product @cacheTag(format: "products") }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Subscription.productUpdated', FIRST_ORDINAL, [
          invalidQueryRootFieldErrorMessage(),
        ]),
      );
    });

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
        invalidDirectiveError(CACHE_TAG, 'Product.reviews', FIRST_ORDINAL, [invalidQueryRootFieldErrorMessage()]),
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
        invalidDirectiveError(CACHE_TAG, 'Product.reviews', FIRST_ORDINAL, [invalidQueryRootFieldErrorMessage()]),
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
  });

  describe('location tests', () => {
    /* Apollo permits @cacheTag on FIELD_DEFINITION and OBJECT; only FIELD_DEFINITION is supported here, so
     * an Object usage is rejected as an invalid location rather than silently ignored.
     */
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

    test('that the directive is rejected on an Object', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @cacheTag(format: "product") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Product', FIRST_ORDINAL, [
          invalidDirectiveLocationErrorMessage(CACHE_TAG, 'OBJECT'),
        ]),
      );
    });
  });
});

// Returns the CacheTagConfigurations for a type. Entity-caching config is nested under `.entityCaching`.
function getCacheTagConfigurations(subgraph: Subgraph, typeName: TypeName): Array<CacheTagConfiguration> | undefined {
  const { configurationDataByTypeName } = normalizeSubgraphSuccess(subgraph, ROUTER_COMPATIBILITY_VERSION_ONE);
  const configurationData = configurationDataByTypeName.get(typeName);
  expect(configurationData).toBeDefined();
  return configurationData!.entityCaching?.cacheTagConfigurations;
}
