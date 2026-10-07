import { describe, expect, test } from 'vitest';
import {
  CACHE_TAG,
  type CacheTagConfiguration,
  type ContractTagOptions,
  emptyCacheTagFormatErrorMessage,
  FIRST_ORDINAL,
  FORMAT,
  fromContextCacheTagReferenceErrorMessage,
  inaccessibleCacheTagReferenceErrorMessage,
  inconsistentCacheTagFormatsWarning,
  invalidArgumentValueErrorMessage,
  invalidCacheTagArgumentTypeErrorMessage,
  invalidCacheTagBraceErrorMessage,
  invalidCacheTagPlaceholderErrorMessage,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  NON_NULLABLE_STRING,
  nonRootFieldCacheTagErrorMessage,
  partiallyDefinedCacheTagReferenceErrorMessage,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  type SubgraphName,
  type TypeName,
  unavailableCacheTagReferencesError,
  undefinedCacheTagArgumentErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unsupportedCacheTagLocationWarning,
  unsupportedFieldCacheTagNamespaceErrorMessage,
} from '../../../src';
import {
  createSubgraph,
  createSubgraphWithDefaultName,
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  federateSubgraphsWithContractsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { CACHE_TAG_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from '../utils/utils';

/* directive @cacheTag(format: String!) repeatable on FIELD_DEFINITION | OBJECT
 *
 * Only a Query root field is supported.
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

    test('that an identical format repeated upon a field is configured once', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            type Query {
              products: [Product!]!
                @cacheTag(format: "products")
                @cacheTag(format: "catalogue")
                @cacheTag(format: "products")
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

    // This directive is ignored here for now, so its format is not validated.
    test('that a malformed format upon a Mutation root field is ignored with a warning', () => {
      const { configurationDataByTypeName, warnings } = normalizeSubgraphSuccess(
        createSubgraph(
          'a',
          `
          type Query { product(id: ID!): Product }
          type Mutation { addProduct(id: ID!): Product @cacheTag(format: "products-{$key.id") }
          type Product @key(fields: "id") { id: ID! }
        `,
        ),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
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

    test('that an "$args" placeholder with whitespace around its periods is valid', () => {
      expect(
        getCacheTagConfigurations(
          createSubgraphWithDefaultName(`
            input Filter { category: String! }
            type Query {
              products(searchKey: String!, filter: Filter!): [Product!]!
                @cacheTag(format: "products-{$args . searchKey}-{$args.filter\\n.\\tcategory}")
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
          format: 'products-{$args . searchKey}-{$args.filter\n.\tcategory}',
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

    test('that an "$args" path that traverses a Scalar is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(id: ID!): [Product!]! @cacheTag(format: "products-{$args.id.value}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          undefinedCacheTagArgumentErrorMessage('id.value'),
        ]),
      );
    });

    test('that an "$args" path referencing an undefined Input Object field is rejected', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          input Filter { category: String! }
          type Query {
            products(filter: Filter!): [Product!]! @cacheTag(format: "products-{$args.filter.brand}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', FIRST_ORDINAL, [
          undefinedCacheTagArgumentErrorMessage('filter.brand'),
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

    test('that an invalid instance following a valid one is reported by its own ordinal', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            products(id: ID!): [Product!]! @cacheTag(format: "products") @cacheTag(format: "products-{$args.ids}")
          }
          type Product @key(fields: "id") { id: ID! }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_TAG, 'Query.products', '2nd', [undefinedCacheTagArgumentErrorMessage('ids')]),
      );
    });
  });

  describe('federation tests', () => {
    test('that each subgraph retains its own CacheTagConfigurations for a shared Query field', () => {
      const { subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
        [
          createSubgraph(
            'a',
            `
            type Query {
              products(id: ID!): [Product!]! @shareable @cacheTag(format: "products-{$args.id}")
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
          createSubgraph(
            'b',
            `
            type Query {
              products(id: ID!): [Product!]! @shareable @cacheTag(format: "catalogue")
            }
            type Product @key(fields: "id") { id: ID! name: String }
          `,
          ),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(
        subgraphConfigBySubgraphName.get('a')?.configurationDataByTypeName.get('Query')?.entityCaching
          ?.cacheTagConfigurations,
      ).toStrictEqual([
        { fieldName: 'products', format: 'products-{$args.id}', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
      expect(
        subgraphConfigBySubgraphName.get('b')?.configurationDataByTypeName.get('Query')?.entityCaching
          ?.cacheTagConfigurations,
      ).toStrictEqual([
        { fieldName: 'products', format: 'catalogue', typeName: 'Query' },
      ] satisfies Array<CacheTagConfiguration>);
    });

    test('that differing formats upon a shared Query field produce a warning', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createProductsSubgraph('a', '@shareable @cacheTag(format: "products") @cacheTag(format: "catalogue")'),
          createProductsSubgraph('b', '@shareable @cacheTag(format: "products")'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([
        inconsistentCacheTagFormatsWarning({
          coords: 'Query.products',
          formatsBySubgraphName: new Map<SubgraphName, Set<string>>([
            ['a', new Set(['products', 'catalogue'])],
            ['b', new Set(['products'])],
          ]),
        }),
      ]);
    });

    // Each contract is a separate federated graph, so it warns only if it retains the field.
    test('that a contract produces the warning only if it retains the shared Query field', () => {
      const { federationResultByContractName, warnings } = federateSubgraphsWithContractsSuccess(
        [
          createSubgraph(
            'a',
            `
            type Query {
              products(id: ID!): [Product!]! @shareable @tag(name: "internal") @cacheTag(format: "products")
              product(id: ID!): Product
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
          createProductsSubgraph('b', '@shareable @tag(name: "internal") @cacheTag(format: "catalogue")'),
        ],
        new Map<string, ContractTagOptions>([
          [
            'excludesProducts',
            { tagNamesToExclude: new Set<string>(['internal']), tagNamesToInclude: new Set<string>() },
          ],
          ['retainsProducts', { tagNamesToExclude: new Set<string>(['other']), tagNamesToInclude: new Set<string>() }],
        ]),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const expectedWarnings = [
        inconsistentCacheTagFormatsWarning({
          coords: 'Query.products',
          formatsBySubgraphName: new Map<SubgraphName, Set<string>>([
            ['a', new Set(['products'])],
            ['b', new Set(['catalogue'])],
          ]),
        }),
      ];
      expect(warnings).toStrictEqual(expectedWarnings);
      expect(federationResultByContractName.get('retainsProducts')?.warnings).toStrictEqual(expectedWarnings);
      expect(federationResultByContractName.get('excludesProducts')?.warnings).toStrictEqual([]);
    });

    test('that an inaccessible shared Query field produces no warning', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createSubgraph(
            'a',
            `
            type Query {
              products(id: ID!): [Product!]! @shareable @inaccessible @cacheTag(format: "products")
              product(id: ID!): Product
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
          createProductsSubgraph('b', '@shareable @inaccessible @cacheTag(format: "catalogue")'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([]);
    });

    test('that a shared Query field tagged in only one subgraph produces a warning', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createProductsSubgraph('a', '@shareable @cacheTag(format: "products")'),
          createProductsSubgraph('b', '@shareable'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([
        inconsistentCacheTagFormatsWarning({
          coords: 'Query.products',
          formatsBySubgraphName: new Map<SubgraphName, Set<string>>([
            ['a', new Set(['products'])],
            ['b', new Set()],
          ]),
        }),
      ]);
    });

    test('that identical formats upon a shared Query field in any order produce no warning', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createProductsSubgraph('a', '@shareable @cacheTag(format: "products") @cacheTag(format: "catalogue")'),
          createProductsSubgraph('b', '@shareable @cacheTag(format: "catalogue") @cacheTag(format: "products")'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([]);
    });

    // Only the overriding subgraph resolves the field, so the formats of the overridden subgraph are ignored.
    test('that the formats of a subgraph whose Query field is overridden produce no warning', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createSubgraph(
            'a',
            `
            type Query {
              product(id: ID!): Product
              products(id: ID!): [Product!]! @cacheTag(format: "catalogue")
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
          createProductsSubgraph('b', '@override(from: "a") @cacheTag(format: "products")'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([]);
    });

    // A Federation v1 subgraph may declare a Query field "@external", in which case it does not resolve that field.
    test('that a subgraph whose Query field is external produces no warning', () => {
      const v1Subgraph = (directives: string) =>
        createSubgraph(
          'b',
          `
          extend type Query { products(id: ID!): [Product!]! ${directives} other: ID }
          type Product @key(fields: "id") { id: ID! }
        `,
        );
      const { warnings: resolvingWarnings } = federateSubgraphsSuccess(
        [createProductsSubgraph('a', '@shareable @cacheTag(format: "products")'), v1Subgraph('')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(resolvingWarnings).toContainEqual(
        inconsistentCacheTagFormatsWarning({
          coords: 'Query.products',
          formatsBySubgraphName: new Map<SubgraphName, Set<string>>([
            ['a', new Set(['products'])],
            ['b', new Set()],
          ]),
        }),
      );
      const { warnings: expectedWarnings } = federateSubgraphsSuccess(
        [createProductsSubgraph('a', '@shareable'), v1Subgraph('@external')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const { warnings } = federateSubgraphsSuccess(
        [createProductsSubgraph('a', '@shareable @cacheTag(format: "products")'), v1Subgraph('@external')],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual(expectedWarnings);
    });
  });

  // A reference must be a value that a client request passes to the subgraph.
  describe('unavailable reference tests', () => {
    test('that a reference to an inaccessible argument is rejected once', () => {
      const { errors } = federateSubgraphsFailure(
        [
          createProductsSubgraph(
            'a',
            '@cacheTag(format: "products-{$args.region}") @cacheTag(format: "{$args.region}-all")',
            'id: ID!, region: String @inaccessible',
          ),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          inaccessibleCacheTagReferenceErrorMessage({
            coords: 'Query.products(region: ...)',
            reference: 'region',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    test('that a reference to an inaccessible Input Object field is rejected', () => {
      const { errors } = federateSubgraphsFailure(
        [
          createProductsSubgraph(
            'a',
            '@cacheTag(format: "products-{$args.filter.category}")',
            'filter: Filter',
            'input Filter { category: String @inaccessible brand: String }',
          ),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          inaccessibleCacheTagReferenceErrorMessage({
            coords: 'Filter.category',
            reference: 'filter.category',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    test('that a reference to a @fromContext argument is rejected', () => {
      const { errors } = federateSubgraphsFailure(
        [
          createSubgraph(
            'a',
            `
            type Query @context(name: "q") {
              products(id: ID!, ctx: String @fromContext(field: "$q { x }")): [Product!]!
                @cacheTag(format: "products-{$args.ctx}")
              x: String
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          fromContextCacheTagReferenceErrorMessage({
            coords: 'Query.products(ctx: ...)',
            reference: 'ctx',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    test('that a reference to an argument defined by every subgraph that defines the field is valid', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createProductsSubgraph(
            'a',
            '@shareable @cacheTag(format: "products-{$args.region}")',
            'id: ID!, region: String',
          ),
          createProductsSubgraph(
            'b',
            '@shareable @cacheTag(format: "products-{$args.region}")',
            'id: ID!, region: String',
          ),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([]);
    });

    test('that a reference to an argument omitted by a subgraph that defines the field is rejected', () => {
      const { errors } = federateSubgraphsFailure(
        [
          createProductsSubgraph(
            'a',
            '@shareable @cacheTag(format: "products-{$args.region}")',
            'id: ID!, region: String',
          ),
          createProductsSubgraph('b', '@shareable @cacheTag(format: "products-{$args.id}")'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          partiallyDefinedCacheTagReferenceErrorMessage({
            coords: 'Query.products(region: ...)',
            parentCoords: 'Query.products',
            reference: 'region',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    test('that a reference to an Input Object field omitted by a subgraph that defines the Input Object is rejected', () => {
      const { errors } = federateSubgraphsFailure(
        [
          createProductsSubgraph(
            'a',
            '@shareable @cacheTag(format: "products-{$args.filter.brand}")',
            'filter: Filter',
            'input Filter { category: String brand: String }',
          ),
          createProductsSubgraph('b', '@shareable', 'filter: Filter', 'input Filter { category: String }'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          partiallyDefinedCacheTagReferenceErrorMessage({
            coords: 'Filter.brand',
            parentCoords: 'Filter',
            reference: 'filter.brand',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    // Only the overriding subgraph resolves the field, so the formats of the overridden subgraph are not assessed.
    test('that a reference within the formats of a subgraph whose Query field is overridden is not assessed', () => {
      const { warnings } = federateSubgraphsSuccess(
        [
          createSubgraph(
            'a',
            `
            type Query {
              product(id: ID!): Product
              products(id: ID!, region: String): [Product!]! @cacheTag(format: "products-{$args.region}")
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
          createProductsSubgraph('b', '@override(from: "a")'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toStrictEqual([]);
    });

    test('that a contract that excludes a referenced argument is rejected', () => {
      const { federationResultByContractName } = federateSubgraphsWithContractsSuccess(
        [
          createProductsSubgraph(
            'a',
            '@cacheTag(format: "products-{$args.region}")',
            'id: ID!, region: String @tag(name: "internal")',
          ),
        ],
        new Map<string, ContractTagOptions>([
          [
            'excludesRegion',
            { tagNamesToExclude: new Set<string>(['internal']), tagNamesToInclude: new Set<string>() },
          ],
          ['retainsRegion', { tagNamesToExclude: new Set<string>(['other']), tagNamesToInclude: new Set<string>() }],
        ]),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(federationResultByContractName.get('retainsRegion')?.success).toBe(true);
      expect(federationResultByContractName.get('excludesRegion')?.errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          inaccessibleCacheTagReferenceErrorMessage({
            coords: 'Query.products(region: ...)',
            reference: 'region',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    test('that a contract that excludes a referenced required argument is rejected', () => {
      const { federationResultByContractName } = federateSubgraphsWithContractsSuccess(
        [
          createProductsSubgraph(
            'a',
            '@cacheTag(format: "products-{$args.region}")',
            'id: ID!, region: String! @tag(name: "internal")',
          ),
        ],
        new Map<string, ContractTagOptions>([
          [
            'excludesRegion',
            { tagNamesToExclude: new Set<string>(['internal']), tagNamesToInclude: new Set<string>() },
          ],
          ['retainsRegion', { tagNamesToExclude: new Set<string>(['other']), tagNamesToInclude: new Set<string>() }],
        ]),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(federationResultByContractName.get('retainsRegion')?.success).toBe(true);
      expect(federationResultByContractName.get('excludesRegion')?.errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          inaccessibleCacheTagReferenceErrorMessage({
            coords: 'Query.products(region: ...)',
            reference: 'region',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    test('that a contract that excludes a referenced Input Object field is rejected', () => {
      const { federationResultByContractName } = federateSubgraphsWithContractsSuccess(
        [
          createProductsSubgraph(
            'a',
            '@cacheTag(format: "products-{$args.filter.category}")',
            'filter: Filter',
            'input Filter { category: String @tag(name: "internal") brand: String }',
          ),
        ],
        new Map<string, ContractTagOptions>([
          [
            'excludesCategory',
            { tagNamesToExclude: new Set<string>(['internal']), tagNamesToInclude: new Set<string>() },
          ],
          ['retainsCategory', { tagNamesToExclude: new Set<string>(['other']), tagNamesToInclude: new Set<string>() }],
        ]),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(federationResultByContractName.get('retainsCategory')?.success).toBe(true);
      expect(federationResultByContractName.get('excludesCategory')?.errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          inaccessibleCacheTagReferenceErrorMessage({
            coords: 'Filter.category',
            reference: 'filter.category',
            subgraphName: 'a',
          }),
        ]),
      ]);
    });

    /* A conflicting definition, or a required input value that a client cannot provide, is reported by its own error,
     * so the directive must not change the errors that the same schema produces without it.
     */
    test('that a referenced Input Object that conflicts with an Enum produces only the merge error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [
          createSubgraph('b', 'enum Filter { A } type Query { other(f: Filter): ID }'),
          createProductsSubgraph('a', cacheTag, 'filter: Filter', 'input Filter { category: String }'),
        ],
        '@cacheTag(format: "{$args.filter.category}")',
      );
    });

    test('that a referenced argument whose type conflicts between subgraphs produces only the merge error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [
          createProductsSubgraph('b', '@shareable', 'filter: String'),
          createProductsSubgraph('a', `@shareable ${cacheTag}`, 'filter: Filter', 'input Filter { category: String }'),
        ],
        '@cacheTag(format: "{$args.filter.category}")',
      );
    });

    test('that a referenced argument whose Input Object type conflicts between subgraphs produces only the merge error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [
          createProductsSubgraph('b', '@shareable', 'filter: OtherFilter', 'input OtherFilter { brand: String }'),
          createProductsSubgraph('a', `@shareable ${cacheTag}`, 'filter: Filter', 'input Filter { category: String }'),
        ],
        '@cacheTag(format: "{$args.filter.category}")',
      );
    });

    test('that a referenced required argument omitted by a subgraph produces only its own error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [
          createProductsSubgraph('a', `@shareable ${cacheTag}`, 'id: ID!, region: String!'),
          createProductsSubgraph('b', '@shareable'),
        ],
        '@cacheTag(format: "{$args.region}")',
      );
    });

    test('that a referenced required Input Object field omitted by a subgraph produces only its own error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [
          createProductsSubgraph(
            'a',
            `@shareable ${cacheTag}`,
            'filter: Filter',
            'input Filter { category: String brand: String! }',
          ),
          createProductsSubgraph('b', '@shareable', 'filter: Filter', 'input Filter { category: String }'),
        ],
        '@cacheTag(format: "{$args.filter.brand}")',
      );
    });

    test('that a referenced required @fromContext argument produces only its own error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [
          createSubgraph(
            'a',
            `
            type Query @context(name: "q") {
              products(id: ID!, ctx: String! @fromContext(field: "$q { x }")): [Product!]! ${cacheTag}
              x: String
            }
            type Product @key(fields: "id") { id: ID! }
          `,
          ),
        ],
        '@cacheTag(format: "{$args.ctx}")',
      );
    });

    test('that a referenced required inaccessible argument produces only its own error', () => {
      expectErrorsUnchangedByCacheTag(
        (cacheTag) => [createProductsSubgraph('a', cacheTag, 'id: ID!, region: String! @inaccessible')],
        '@cacheTag(format: "{$args.region}")',
      );
    });

    /* The argument is optional and inaccessible in "a" but required in "b".
     * Federated in this order, the required-inaccessible error is not raised, so the reference is reported instead.
     */
    test('that a reference to an inaccessible argument that another subgraph requires is rejected', () => {
      const { errors } = federateSubgraphsFailure(
        [
          createProductsSubgraph(
            'a',
            '@shareable @cacheTag(format: "products-{$args.region}")',
            'id: ID!, region: String @inaccessible',
          ),
          createProductsSubgraph('b', '@shareable', 'id: ID!, region: String!'),
        ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors).toStrictEqual([
        unavailableCacheTagReferencesError('Query.products', [
          inaccessibleCacheTagReferenceErrorMessage({
            coords: 'Query.products(region: ...)',
            reference: 'region',
            subgraphName: 'a',
          }),
        ]),
      ]);
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

// Returns a subgraph that defines the Query field "products" with the given directives, arguments, and definitions.
function createProductsSubgraph(
  name: SubgraphName,
  directives: string,
  argumentDefinitions = 'id: ID!',
  definitions = '',
): Subgraph {
  return createSubgraph(
    name,
    `
    type Query {
      products(${argumentDefinitions}): [Product!]! ${directives}
    }
    type Product @key(fields: "id") { id: ID! }
    ${definitions}
  `,
  );
}

// Asserts that adding the directive to the subgraphs does not change the errors that federation produces.
function expectErrorsUnchangedByCacheTag(createSubgraphs: (cacheTag: string) => Array<Subgraph>, cacheTag: string) {
  const { errors: expectedErrors } = federateSubgraphsFailure(createSubgraphs(''), ROUTER_COMPATIBILITY_VERSION_ONE);
  const { errors } = federateSubgraphsFailure(createSubgraphs(cacheTag), ROUTER_COMPATIBILITY_VERSION_ONE);
  expect(errors).toStrictEqual(expectedErrors);
}

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
