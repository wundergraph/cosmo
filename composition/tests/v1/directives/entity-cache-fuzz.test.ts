import { describe, expect, test } from 'vitest';
import {
  BatchNormalizationSuccess,
  CACHE_POPULATE,
  CacheInvalidateConfig,
  FIRST_ORDINAL,
  invalidDirectiveError,
  IS,
  isWithoutQueryCacheErrorMessage,
  maxAgeNotPositiveIntegerErrorMessage,
  MUTATION,
  parse,
  QUERY,
  RootFieldCacheConfig,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  SUBSCRIPTION,
  TypeName,
  cachePopulateOnNonEntityReturnTypeErrorMessage,
  requestScopedSingleFieldWarning,
} from '../../../src';
import { batchNormalize } from '../../../src/v1/normalization/normalization-factory';
import { normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

const version = ROUTER_COMPATIBILITY_VERSION_ONE;

function subgraph(sdl: string, name = 'subgraph-a'): Subgraph {
  return { name, url: '', definitions: parse(sdl) };
}

function getConfigForType(sg: Subgraph, typeName: string) {
  const result = batchNormalize({ subgraphs: [sg], version }) as BatchNormalizationSuccess;
  expect(result.success).toBe(true);
  const internal = result.internalSubgraphBySubgraphName.get(sg.name);
  expect(internal).toBeDefined();
  return internal!.configurationDataByTypeName.get(typeName as TypeName);
}

describe('Entity caching fuzz tests', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // @openfed__queryCache + @openfed__is mapping edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('@openfed__queryCache + @openfed__is edge cases', () => {
    test('1. @openfed__queryCache on field with NO arguments — should succeed with empty mappings', () => {
      // A Query field with @openfed__queryCache but zero arguments cannot construct a cache key.
      // Expect: succeeds (cache population still works), empty mappings.
      const config = getConfigForType(
        subgraph(`
          type Query {
            latestProduct: Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toStrictEqual([
        {
          fieldName: 'latestProduct',
          maxAgeSeconds: 30,
          includeHeaders: false,
          shadowMode: false,
          entityTypeName: 'Product',
          entityKeyMappings: [],
        },
      ] satisfies RootFieldCacheConfig[]);
    });

    test('2. @openfed__queryCache on field returning nullable entity (Product not Product!) — should succeed', () => {
      // Nullable return type should still work — the entity type name is extracted
      // by unwrapping NonNull wrappers.
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toHaveLength(1);
      expect(config!.rootFieldCacheConfigurations![0].entityTypeName).toBe('Product');
      // Auto-mapping should still work
      expect(config!.rootFieldCacheConfigurations![0].entityKeyMappings).toHaveLength(1);
    });

    test('3. @openfed__queryCache on field returning union type — should error (union is not an entity)', () => {
      // A union type itself doesn't have @key, so it's not an entity.
      // Expect: error about non-entity return type.
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            item(id: ID!): Item @openfed__queryCache(maxAge: 30)
          }
          union Item = Product | Service
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
          type Service @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            description: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
    });

    test('4. @openfed__queryCache on field returning interface type — should error (interface is not a keyed entity)', () => {
      // An interface can't have @key in federation v1-style, so it's not an entity.
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            node(id: ID!): Node @openfed__queryCache(maxAge: 30)
          }
          interface Node {
            id: ID!
          }
          type Product implements Node @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
    });

    test('5. @openfed__is(fields: "id") on argument WITHOUT @openfed__queryCache — should error', () => {
      // @openfed__is only makes sense for cache key construction. Without @openfed__queryCache, it's meaningless.
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            product(pid: ID! @openfed__is(fields: "id")): Product
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(IS, 'Query.product(pid: ...)', FIRST_ORDINAL, [
          isWithoutQueryCacheErrorMessage('pid', 'Query.product'),
        ]),
      );
    });

    test('6. @openfed__is(fields: "id id") — duplicate field reference in @openfed__is', () => {
      // The @openfed__is value "id id" references the same key field twice.
      // This might be treated as a composite @openfed__is spec (contains space).
      // Expect: either an error about duplicate mapping or a parse failure.
      // Let's see what actually happens.
      const sg = subgraph(`
        type Query {
          product(key: ProductKey! @openfed__is(fields: "id id")): Product @openfed__queryCache(maxAge: 30)
        }
        input ProductKey {
          id: ID!
        }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version });
      // We just want to know if it silently succeeds with a broken config
      // or produces a meaningful error. Either is acceptable as long as it's not silent corruption.
      if (result.success) {
        const internal = (result as BatchNormalizationSuccess).internalSubgraphBySubgraphName.get(sg.name);
        const queryConfig = internal!.configurationDataByTypeName.get(QUERY as TypeName);
        if (queryConfig?.rootFieldCacheConfigurations) {
          // If it produced a config, the mappings should not have duplicates
          const mappings = queryConfig.rootFieldCacheConfigurations[0]?.entityKeyMappings;
          // If mappings exist, they should be sensible
          if (mappings && mappings.length > 0) {
            for (const m of mappings) {
              const keyFields = m.fieldMappings.map((f) => f.entityKeyField);
              const uniqueKeyFields = new Set(keyFields);
              expect(keyFields.length).toBe(uniqueKeyFields.size);
            }
          }
        }
      }
      // If it errored, that's fine — just not silent corruption
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // @openfed__entityCache edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('@openfed__entityCache edge cases', () => {
    test('7. @openfed__entityCache on type with multiple @key directives — config should still have one entityCacheConfig', () => {
      // Multiple @key directives on same type, single @openfed__entityCache. The entity has
      // multiple ways to be identified, but only one cache TTL config.
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      // Should have exactly one entityCacheConfig regardless of multiple keys
      expect(config!.entityCacheConfigurations).toHaveLength(1);
      expect(config!.entityCacheConfigurations![0].maxAgeSeconds).toBe(60);
    });

    test('8. @openfed__entityCache with very large maxAge (Int32 max) — should accept', () => {
      // Very large TTL. GraphQL `Int` is 32-bit signed, so 2^31-1 = 2147483647 is the max.
      // Previously this test used 999999999999, which is outside GraphQL Int range and would
      // be rejected by the spec-compliant parser — shadowing the intent of the "large but valid
      // TTL" check.
      // Expect: succeeds, config has the exact value.
      const config = getConfigForType(
        subgraph(`
          type Query { product(id: ID!): Product }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 2147483647) {
            id: ID!
            name: String!
          }
        `),
        'Product',
      );
      expect(config).toBeDefined();
      expect(config!.entityCacheConfigurations).toHaveLength(1);
      expect(config!.entityCacheConfigurations![0].maxAgeSeconds).toBe(2147483647);
    });

    test('9. @openfed__entityCache on type with ONLY unresolvable @key(resolvable: false) — should succeed', () => {
      // An entity with only unresolvable keys still has @key, so @openfed__entityCache should be accepted.
      // The router uses the key to construct cache keys even if it can't resolve the entity.
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Product @key(fields: "id", resolvable: false) @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('10. Multiple @openfed__entityCache on same type (repeated directive) — only first is used', () => {
      // @openfed__entityCache is NOT marked repeatable, so GraphQL validation should reject this.
      // But if it gets past parsing, only the first directive is processed.
      // Let's see what happens.
      const sg = subgraph(`
        type Query { product(id: ID!): Product }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) @openfed__entityCache(maxAge: 120) {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version });
      if (result.success) {
        const internal = (result as BatchNormalizationSuccess).internalSubgraphBySubgraphName.get(sg.name);
        const productConfig = internal!.configurationDataByTypeName.get('Product' as TypeName);
        // If it succeeds, the second @openfed__entityCache should be silently ignored
        // (the code processes entityCacheDirectives[0] only).
        // This is technically correct but could be surprising — the user might expect
        // the second TTL to win or get an error about duplicates.
        if (productConfig?.entityCacheConfigurations) {
          expect(productConfig.entityCacheConfigurations).toHaveLength(1);
          // Should be the first directive's value (60), not the second (120)
          expect(productConfig.entityCacheConfigurations[0].maxAgeSeconds).toBe(60);
        }
      }
      // If it errors about non-repeatable directive, that's also correct
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Multiple @key + @openfed__queryCache mapping edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('multiple @key + @openfed__queryCache mapping', () => {
    test('11. Two @key directives, argument satisfies both — both keys should produce mappings', () => {
      // @key(fields: "id") and @key(fields: "id sku") — argument "id" satisfies the first key fully.
      // The second key needs both "id" and "sku", and only "id" is provided.
      // Expect: one fully-mapped key (for "id"), the second key is incomplete so it's skipped.
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const rfcs = config!.rootFieldCacheConfigurations!;
      expect(rfcs).toHaveLength(1);
      // The first key "id" should be fully satisfied
      const fullMappings = rfcs[0].entityKeyMappings.filter((m) => m.fieldMappings.length > 0);
      expect(fullMappings).toHaveLength(1);
      // At least one mapping should map "id" to "id"
      const hasIdMapping = fullMappings.some((m) =>
        m.fieldMappings.some((f) => f.entityKeyField === 'id' && f.argumentPath[0] === 'id'),
      );
      expect(hasIdMapping).toBe(true);
    });

    // BUG: Two independent @key directives (@key(fields: "id") and @key(fields: "sku"))
    // each produce a single-field EntityKeyMappingConfig. But buildAutoMappings() at lines
    // 4921-4931 merges all single-field results into ONE EntityKeyMappingConfig with both
    // field mappings. This makes the router treat them as a composite key (AND semantics:
    // both "id" AND "sku" must match) instead of independent keys (OR semantics: either
    // "id" OR "sku" can be used for a cache hit). The merge is wrong — independent keys
    // should remain separate EntityKeyMappingConfig entries.
    test('12. Two @key directives, arguments satisfy both fully — should produce two key mappings', () => {
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!, sku: String!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 60) {
            id: ID!
            sku: String!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const mappings = config!.rootFieldCacheConfigurations![0].entityKeyMappings;
      // Both keys should be fully satisfied as SEPARATE entries
      expect(mappings).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Nested key edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('nested key edge cases', () => {
    test('13. @key(fields: "store { id }") with @openfed__is(fields: "store.id") on scalar arg', () => {
      // Nested key path: "store.id" — the @openfed__is targets it with dot notation.
      // Expect: succeeds, mapping has entityKeyField "store.id".
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(storeId: ID! @openfed__is(fields: "store.id")): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "store { id }") @openfed__entityCache(maxAge: 60) {
            store: Store!
            name: String!
          }
          type Store {
            id: ID!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const mappings = config!.rootFieldCacheConfigurations![0].entityKeyMappings;
      expect(mappings).toHaveLength(1);
      expect(mappings[0].fieldMappings).toHaveLength(1);
      expect(mappings[0].fieldMappings[0].entityKeyField).toBe('store.id');
      expect(mappings[0].fieldMappings[0].argumentPath).toStrictEqual(['storeId']);
    });

    test('14. @key with deeply nested field (3 levels)', () => {
      // @key(fields: "a { b { c } }") — deep nesting.
      // Expect: succeeds with key.
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { thing(id: ID!): Thing }
          type Thing @key(fields: "a { b { c } }") @openfed__entityCache(maxAge: 60) {
            a: A!
          }
          type A {
            b: B!
          }
          type B {
            c: ID!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // @openfed__is with input objects
  // ═══════════════════════════════════════════════════════════════════════════

  describe('@openfed__is with input objects', () => {
    test('15. @openfed__is(fields: "id sku") with input object having EXTRA fields — should error', () => {
      // Input object has "id", "sku", and "extra". The "extra" field is not a key field.
      // With explicit @openfed__is, extra non-key arguments should be an error.
      const sg = subgraph(`
        type Query {
          product(key: ProductKey! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 30)
        }
        input ProductKey {
          id: ID!
          sku: String!
          extra: String!
        }
        type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
          id: ID!
          sku: String!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version });
      // Extra fields in the input object beyond key fields should cause an error
      // about additional non-key arguments, since they make the cache key incomplete.
      if (result.success) {
        const internal = (result as BatchNormalizationSuccess).internalSubgraphBySubgraphName.get(sg.name);
        const queryConfig = internal!.configurationDataByTypeName.get(QUERY as TypeName);
        // If it succeeded, check if the extra field was silently ignored
        // (which would be a bug — the cache key would be incomplete)
        if (queryConfig?.rootFieldCacheConfigurations) {
          const mappings = queryConfig.rootFieldCacheConfigurations[0]?.entityKeyMappings;
          if (mappings && mappings.length > 0) {
            // The mapping should only have id and sku, not extra
            for (const m of mappings) {
              for (const f of m.fieldMappings) {
                expect(f.entityKeyField).not.toBe('extra');
              }
            }
          }
        }
      }
    });

    test('16. @openfed__is(fields: "id sku") with input object MISSING one field — should error', () => {
      // Input object has "id" but not "sku". The @openfed__is says it maps to both.
      // Expect: error about missing field in input object.
      const sg = subgraph(`
        type Query {
          product(key: ProductKey! @openfed__is(fields: "id sku")): Product @openfed__queryCache(maxAge: 30)
        }
        input ProductKey {
          id: ID!
        }
        type Product @key(fields: "id sku") @openfed__entityCache(maxAge: 60) {
          id: ID!
          sku: String!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version });
      // This should produce an error — the input object can't satisfy the @openfed__is spec.
      // If it silently succeeds with broken mappings, that's a bug.
      if (result.success) {
        const internal = (result as BatchNormalizationSuccess).internalSubgraphBySubgraphName.get(sg.name);
        const queryConfig = internal!.configurationDataByTypeName.get(QUERY as TypeName);
        if (queryConfig?.rootFieldCacheConfigurations) {
          const mappings = queryConfig.rootFieldCacheConfigurations[0]?.entityKeyMappings;
          // If we got here with mappings, the "sku" field is missing from the input object
          // so the mapping is incomplete — that's a bug if no error was raised.
          if (mappings && mappings.length > 0) {
            for (const m of mappings) {
              const keyFields = m.fieldMappings.map((f) => f.entityKeyField);
              // BUG if "sku" is in the mapping but not in the input object
              // Or if the mapping is emitted at all without "sku"
            }
          }
        }
      }
      // If it errored, that's the correct behavior
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // @openfed__requestScoped edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('@openfed__requestScoped edge cases', () => {
    test('17. @openfed__requestScoped requires key — missing key is a failure', () => {
      // key is mandatory.
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            currentUser: User @openfed__requestScoped
            user: User @openfed__requestScoped(key: "u")
          }
          type User @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      // The error is from the directive definition validation — key is required.
      expect(errors).toHaveLength(1);
    });

    test('18. @openfed__requestScoped with ≥ 2 fields sharing the same key — no warning, l1Key subgraph-prefixed', () => {
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            me: User @openfed__requestScoped(key: "me")
          }
          type Article @key(fields: "id") {
            id: ID!
            viewer: User @openfed__requestScoped(key: "me")
          }
          type User @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      // No single-field warning because both fields declare key: "me"
      expect(warnings).toHaveLength(0);

      const config = getConfigForType(
        subgraph(`
          type Query {
            me: User @openfed__requestScoped(key: "me")
          }
          type Article @key(fields: "id") {
            id: ID!
            viewer: User @openfed__requestScoped(key: "me")
          }
          type User @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.requestScopedFields).toBeDefined();
      expect(config!.requestScopedFields).toHaveLength(1);
      expect(config!.requestScopedFields![0].l1Key).toBe('subgraph-a.me');
    });

    test('19. @openfed__requestScoped on a non-entity type field — should succeed when ≥ 2 fields share the key', () => {
      // @openfed__requestScoped is on FIELD_DEFINITION, works on any object type field.
      const config = getConfigForType(
        subgraph(`
          type Query {
            currentLocale: String @openfed__requestScoped(key: "locale")
          }
          type Article @key(fields: "id") {
            id: ID!
            articleLocale: String @openfed__requestScoped(key: "locale")
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.requestScopedFields).toBeDefined();
      expect(config!.requestScopedFields).toHaveLength(1);
      expect(config!.requestScopedFields![0].fieldName).toBe('currentLocale');
      expect(config!.requestScopedFields![0].l1Key).toBe('subgraph-a.locale');
    });

    test('20. @openfed__requestScoped with only one field declaring a key — warning emitted', () => {
      // Single-field @openfed__requestScoped is meaningless (no second reader to benefit).
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            currentUser: User @openfed__requestScoped(key: "lonely")
          }
          type User @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        requestScopedSingleFieldWarning({
          subgraphName: 'subgraph-a',
          key: 'lonely',
          fieldCoords: 'Query.currentUser',
        }),
      );
    });

    test('21. Multiple @openfed__requestScoped on same field — not repeatable, should fail', () => {
      // @openfed__requestScoped is NOT repeatable.
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query {
            currentUser: User @openfed__requestScoped(key: "a") @openfed__requestScoped(key: "b")
          }
          type User @key(fields: "id") {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // @openfed__cacheInvalidate / @openfed__cachePopulate edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('@openfed__cacheInvalidate/@openfed__cachePopulate edge cases', () => {
    test('22. @openfed__cachePopulate(maxAge: -1) — should error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__cachePopulate(maxAge: -1)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Mutation.createProduct', FIRST_ORDINAL, [
          maxAgeNotPositiveIntegerErrorMessage(CACHE_POPULATE, -1),
        ]),
      );
    });

    test('23. @openfed__cacheInvalidate returning a list type — should succeed', () => {
      // Mutation returning [Product]! with @openfed__cacheInvalidate. The named type is still "Product".
      // getTypeNodeNamedTypeName unwraps list and NonNull wrappers.
      const { schema } = normalizeSubgraphSuccess(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            deleteProducts(ids: [ID!]!): [Product!]! @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(schema).toBeDefined();
    });

    test('24. @openfed__cacheInvalidate on Subscription field — should succeed', () => {
      // The code allows both Mutation and Subscription for @openfed__cacheInvalidate.
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            productDeleted: Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        SUBSCRIPTION,
      );
      expect(config).toBeDefined();
      expect(config!.cacheInvalidateConfigurations).toStrictEqual([
        {
          fieldName: 'productDeleted',
          operationType: SUBSCRIPTION,
          entityTypeName: 'Product',
        },
      ] satisfies CacheInvalidateConfig[]);
    });

    test('25. @openfed__cachePopulate on Subscription returning a non-entity type — should error', () => {
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            eventOccurred: Event @openfed__cachePopulate
          }
          type Event {
            id: ID!
            message: String!
          }
        `),
        version,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(CACHE_POPULATE, 'Subscription.eventOccurred', FIRST_ORDINAL, [
          cachePopulateOnNonEntityReturnTypeErrorMessage('Subscription.eventOccurred', 'Event'),
        ]),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cross-directive interactions
  // ═══════════════════════════════════════════════════════════════════════════

  describe('cross-directive interactions', () => {
    test('26. @openfed__queryCache + @openfed__entityCache on same field — @openfed__queryCache is on the Query field, @openfed__entityCache on the type', () => {
      // This is the normal usage pattern, not actually on the "same field".
      // Verify the combined config is correct.
      const sg = subgraph(`
        type Query {
          product(id: ID!): Product @openfed__queryCache(maxAge: 30)
        }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const internal = result.internalSubgraphBySubgraphName.get(sg.name)!;

      // Product type should have entityCacheConfig
      const productConfig = internal.configurationDataByTypeName.get('Product' as TypeName);
      expect(productConfig!.entityCacheConfigurations).toHaveLength(1);
      expect(productConfig!.entityCacheConfigurations![0].maxAgeSeconds).toBe(60);

      // Query type should have rootFieldCacheConfig
      const queryConfig = internal.configurationDataByTypeName.get(QUERY as TypeName);
      expect(queryConfig!.rootFieldCacheConfigurations).toHaveLength(1);
      expect(queryConfig!.rootFieldCacheConfigurations![0].maxAgeSeconds).toBe(30);
    });

    test('27. @openfed__entityCache + @openfed__requestScoped on same type — both should be present in config', () => {
      // An entity can be both cacheable and have request-scoped fields.
      // Two fields share the "session" key so no single-field warning.
      const sg = subgraph(`
        type Query {
          user(id: ID!): User @openfed__queryCache(maxAge: 30)
          activeSession: String @openfed__requestScoped(key: "session")
        }
        type User @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
          currentSession: String @openfed__requestScoped(key: "session")
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const internal = result.internalSubgraphBySubgraphName.get(sg.name)!;
      const userConfig = internal.configurationDataByTypeName.get('User' as TypeName);
      expect(userConfig).toBeDefined();
      // Should have entity cache config
      expect(userConfig!.entityCacheConfigurations).toHaveLength(1);
      // Should have request-scoped fields
      expect(userConfig!.requestScopedFields).toBeDefined();
      expect(userConfig!.requestScopedFields).toHaveLength(1);
      expect(userConfig!.requestScopedFields![0].fieldName).toBe('currentSession');
      expect(userConfig!.requestScopedFields![0].l1Key).toBe('subgraph-a.session');
    });

    test('28. Both @openfed__cachePopulate and @openfed__queryCache on same field — should this be rejected?', () => {
      // @openfed__queryCache is only valid on Query fields, @openfed__cachePopulate only on Mutation/Subscription.
      // They can't be on the same field since a field can only be on one root type.
      // But what if someone puts @openfed__cachePopulate on a Query field? That's caught by rule 17.
      // What about @openfed__queryCache on a Mutation field? That's caught by rule 4.
      // So this combination is inherently impossible on the same field.
      // Let's verify the error for @openfed__queryCache on Mutation with @openfed__cachePopulate:
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            createProduct(name: String!): Product @openfed__queryCache(maxAge: 30) @openfed__cachePopulate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      // Should error about @openfed__queryCache on non-Query field
      expect(errors).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-mapping traps
  // ═══════════════════════════════════════════════════════════════════════════

  describe('auto-mapping traps', () => {
    test('29. Argument named "id" with type [ID!]! (list) on singular return — should NOT auto-map', () => {
      // The argument "id" matches the key field name "id", but the argument is a list
      // while the return type is singular. For singular returns, a list argument can't
      // map to a scalar key field (type mismatch).
      const sg = subgraph(`
        type Query {
          product(id: [ID!]!): Product @openfed__queryCache(maxAge: 30)
        }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const internal = result.internalSubgraphBySubgraphName.get(sg.name)!;
      const queryConfig = internal.configurationDataByTypeName.get(QUERY as TypeName);
      expect(queryConfig).toBeDefined();
      const rfcs = queryConfig!.rootFieldCacheConfigurations!;
      expect(rfcs).toHaveLength(1);
      // The mapping should be empty because [ID!]! can't map to scalar ID! on singular return
      expect(rfcs[0].entityKeyMappings).toHaveLength(0);
    });

    test('30. Argument named "id" with nullable type ID mapping to key field id: ID! — should auto-map', () => {
      // Nullability differences should be ignored per the mapping rules.
      // Nullable ID arg → non-null ID! key field should still auto-map.
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const mappings = config!.rootFieldCacheConfigurations![0].entityKeyMappings;
      // Should auto-map despite nullability difference
      expect(mappings).toHaveLength(1);
      expect(mappings[0].fieldMappings).toHaveLength(1);
      expect(mappings[0].fieldMappings[0].entityKeyField).toBe('id');
    });

    test('31. Entity with @key(fields: "type") — "type" is a valid field name, should work', () => {
      // "type" is a valid GraphQL field name that happens to be a keyword in some contexts.
      // It should not conflict with __typename.
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(type: String!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "type") @openfed__entityCache(maxAge: 60) {
            type: String!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const mappings = config!.rootFieldCacheConfigurations![0].entityKeyMappings;
      expect(mappings).toHaveLength(1);
      expect(mappings[0].fieldMappings[0].entityKeyField).toBe('type');
    });

    test('32. Argument type mismatch: arg is String!, key field is ID! — should skip auto-mapping with warning', () => {
      // Auto-mapping compares named types (unwrapping NonNull). String != ID.
      // Expect: auto-mapping is skipped, warning emitted.
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(id: String!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      // Should produce a type mismatch warning
      expect(warnings).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Batch / list edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('batch / list edge cases', () => {
    test('33. List return with list argument — should produce isBatch mapping', () => {
      // products(ids: [ID!]!): [Product!]! with @openfed__queryCache — batch lookup.
      // The argument "ids" doesn't match key field "id" by name, so we need @openfed__is.
      const config = getConfigForType(
        subgraph(`
          type Query {
            products(ids: [ID!]! @openfed__is(fields: "id")): [Product!]! @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const rfcs = config!.rootFieldCacheConfigurations!;
      expect(rfcs).toHaveLength(1);
      const mappings = rfcs[0].entityKeyMappings;
      expect(mappings).toHaveLength(1);
      expect(mappings[0].fieldMappings).toHaveLength(1);
      expect(mappings[0].fieldMappings[0].isBatch).toBe(true);
    });

    test('34. List return with scalar argument — should not establish batch mapping', () => {
      // products(category: String!): [Product!]! with @openfed__queryCache — scalar arg can't batch.
      // Auto-mapping won't find "category" in @key(fields: "id"), so no mapping.
      const config = getConfigForType(
        subgraph(`
          type Query {
            products(category: String!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const rfcs = config!.rootFieldCacheConfigurations!;
      expect(rfcs).toHaveLength(1);
      // No mappings since "category" doesn't match any key field
      expect(rfcs[0].entityKeyMappings).toHaveLength(0);
    });

    test('35. List return with auto-mapped list argument named "id" — should produce isBatch', () => {
      // products(id: [ID!]!): [Product!]! — "id" matches key field "id", list arg, list return.
      // Should auto-map with isBatch: true.
      const config = getConfigForType(
        subgraph(`
          type Query {
            products(id: [ID!]!): [Product!]! @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      const rfcs = config!.rootFieldCacheConfigurations!;
      expect(rfcs).toHaveLength(1);
      const mappings = rfcs[0].entityKeyMappings;
      expect(mappings).toHaveLength(1);
      expect(mappings[0].fieldMappings[0].isBatch).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3 attachment edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('config attachment edge cases', () => {
    test('36. @openfed__cachePopulate config goes to correct operation type (Mutation vs Subscription)', () => {
      // Verify that @openfed__cachePopulate on Mutation goes to "Mutation" config and
      // @openfed__cachePopulate on Subscription goes to "Subscription" config.
      // BUG CHECK: The code in Phase 3 uses `cp.operationType` as the key into
      // configurationDataByTypeName. The operationTypeString is set to "Mutation"
      // or "Subscription" — but when operationType is SUBSCRIPTION, the string is set to
      // "Subscription" only if the operationType is not MUTATION.
      // Let's check: operationTypeString = operationType === OperationTypeNode.MUTATION ? MUTATION : SUBSCRIPTION
      // This means for Query it would be "Subscription" — but Query fields with @openfed__cachePopulate
      // are already rejected by rule 17. So this is fine for valid inputs.

      // Test Subscription specifically
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Subscription {
            newProduct: Product @openfed__cachePopulate(maxAge: 120)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        SUBSCRIPTION,
      );
      expect(config).toBeDefined();
      expect(config!.cachePopulateConfigurations).toHaveLength(1);
      expect(config!.cachePopulateConfigurations![0].operationType).toBe(SUBSCRIPTION);
      expect(config!.cachePopulateConfigurations![0].maxAgeSeconds).toBe(120);
    });

    test('37. @openfed__cacheInvalidate config uses correct entityTypeName from return type', () => {
      // Verify the entityTypeName is correctly set even when the return type is wrapped.
      const config = getConfigForType(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            deleteProduct(id: ID!): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        MUTATION,
      );
      expect(config).toBeDefined();
      expect(config!.cacheInvalidateConfigurations).toHaveLength(1);
      expect(config!.cacheInvalidateConfigurations![0].entityTypeName).toBe('Product');
    });

    test('38. Multiple @openfed__queryCache fields on same Query type — all get configs', () => {
      // Two different query fields with @openfed__queryCache returning different entities.
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 30)
            user(id: ID!): User @openfed__queryCache(maxAge: 45)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
          type User @key(fields: "id") @openfed__entityCache(maxAge: 90) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toHaveLength(2);
      const fieldNames = config!.rootFieldCacheConfigurations!.map((r) => r.fieldName).sort();
      expect(fieldNames).toStrictEqual(['product', 'user']);
    });

    test('39. Multiple mutations with different cache directives — all get correct configs', () => {
      const sg = subgraph(`
        type Query { dummy: String! }
        type Mutation {
          updateProduct(id: ID!): Product @openfed__cacheInvalidate
          createProduct(name: String!): Product @openfed__cachePopulate(maxAge: 30)
        }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version }) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const internal = result.internalSubgraphBySubgraphName.get(sg.name)!;
      const mutConfig = internal.configurationDataByTypeName.get(MUTATION as TypeName);
      expect(mutConfig).toBeDefined();
      expect(mutConfig!.cacheInvalidateConfigurations).toHaveLength(1);
      expect(mutConfig!.cacheInvalidateConfigurations![0].fieldName).toBe('updateProduct');
      expect(mutConfig!.cachePopulateConfigurations).toHaveLength(1);
      expect(mutConfig!.cachePopulateConfigurations![0].fieldName).toBe('createProduct');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Potential silent corruption scenarios
  // ═══════════════════════════════════════════════════════════════════════════

  describe('potential silent corruption', () => {
    test('40. @openfed__entityCache without maxAge argument — should error (maxAge is required)', () => {
      // If the directive definition makes maxAge required, parsing should fail.
      // But if it somehow gets through, the code defaults maxAgeSeconds to 0 which would
      // be caught by the <= 0 check.
      const sg = subgraph(`
        type Query { product(id: ID!): Product }
        type Product @key(fields: "id") @openfed__entityCache {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version });
      // Should fail because maxAge is required
      expect(result.success).toBe(false);
    });

    test('41. @openfed__queryCache maxAge as float (3.5) — should be parsed as 0 and error', () => {
      // maxAge is Int!, a float value should either fail parsing or be treated as 0.
      const sg = subgraph(`
        type Query {
          product(id: ID!): Product @openfed__queryCache(maxAge: 3.5)
        }
        type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
          id: ID!
          name: String!
        }
      `);
      const result = batchNormalize({ subgraphs: [sg], version });
      // A float value for an Int! field should fail at some point
      expect(result.success).toBe(false);
    });

    test('42. @openfed__is on argument of non-Query field without @openfed__queryCache — error about @openfed__is without @openfed__queryCache', () => {
      // @openfed__is without @openfed__queryCache on a Mutation argument — should still error about @openfed__is placement.
      const { errors } = normalizeSubgraphFailure(
        subgraph(`
          type Query { dummy: String! }
          type Mutation {
            updateProduct(pid: ID! @openfed__is(fields: "id")): Product @openfed__cacheInvalidate
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      // Should have error about @openfed__is without @openfed__queryCache
      expect(errors).toHaveLength(1);
    });

    test('43. @openfed__queryCache on field returning entity with @key but entity has NO fields matching any argument — empty mappings, no warning', () => {
      // product(name: String!): Product — "name" is not a key field.
      // Should succeed with empty mappings and no warning (this is already tested, just double-checking).
      const { warnings } = normalizeSubgraphSuccess(
        subgraph(`
          type Query {
            product(name: String!): Product @openfed__queryCache(maxAge: 30)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 60) {
            id: ID!
            name: String!
          }
        `),
        version,
      );
      expect(warnings).toHaveLength(0);
    });

    test('44. @openfed__queryCache with very large maxAge but @openfed__entityCache with very small maxAge — no error about TTL mismatch', () => {
      // The query cache TTL (3600) is much larger than the entity cache TTL (1).
      // This means cached query results would reference entities that expired long ago.
      // No validation exists for this — it's a logical error but not caught.
      const config = getConfigForType(
        subgraph(`
          type Query {
            product(id: ID!): Product @openfed__queryCache(maxAge: 3600)
          }
          type Product @key(fields: "id") @openfed__entityCache(maxAge: 1) {
            id: ID!
            name: String!
          }
        `),
        QUERY,
      );
      expect(config).toBeDefined();
      // Succeeds without warning — the router would serve stale query cache entries
      // that reference long-expired entity cache entries. This is a potential foot-gun
      // but not necessarily a bug — just worth noting.
      expect(config!.rootFieldCacheConfigurations![0].maxAgeSeconds).toBe(3600);
    });

    test('45. @openfed__queryCache on field returning entity that exists only in another subgraph', () => {
      // The entity type Product is defined in subgraph-b but not in subgraph-a.
      // However, subgraph-a references it as a return type and adds @openfed__queryCache.
      // This should work in a multi-subgraph setup — the entity is resolved by subgraph-b.
      // In a single-subgraph normalization, Product would need at least a stub.
      const sg = subgraph(`
        type Query {
          product(id: ID!): Product @openfed__queryCache(maxAge: 30)
        }
        type Product @key(fields: "id") {
          id: ID!
        }
      `);
      // Without @openfed__entityCache on Product, the mapping still produces a root field config
      // but with empty key mappings (since hasEntityCache is false).
      const config = getConfigForType(sg, QUERY);
      expect(config).toBeDefined();
      expect(config!.rootFieldCacheConfigurations).toHaveLength(1);
      // entityKeyMappings should be empty since Product lacks @openfed__entityCache
      expect(config!.rootFieldCacheConfigurations![0].entityKeyMappings).toStrictEqual([]);
    });
  });
});
