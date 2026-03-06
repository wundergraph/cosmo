# Task 11: Integration Tests

## Objective

Write end-to-end integration tests covering the 18 test scenarios from ENTITY_CACHING_TODO.md, plus composition directive validation tests. Tests verify the full pipeline from composition through router execution.

## Scope

- Router integration tests using `testenv.Run()` pattern with `MemoryEntityCache`
- Composition tests for all 20 validation rules
- 20 router test scenarios (18 from the TODO document + 2 additional)
- Test helpers for entity caching

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 05 | Composition validation rules (tested here) |
| Task 06 | Config builder serialization (tested here) |
| Task 08 | FactoryResolver + Executor integration (tested here) |
| Task 09 | Per-request CachingOptions (tested here) |

## Test Infrastructure

### Test Pattern: `testenv.Run()`

All router integration tests use this pattern:

```go
testenv.Run(t, &testenv.Config{
    ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
        // Inject entity caching proto configuration into datasources
    },
    ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
        // Enable entity caching in engine config
    },
}, func(t *testing.T, xEnv *testenv.Environment) {
    res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
        Query: `query { user(id: "1") { id name } }`,
    })
    // Assert response
    // Assert subgraph call counts
})
```

### MemoryEntityCache Injection

Tests use `MemoryEntityCache` (from Task 03) instead of Redis:

```go
testenv.Run(t, &testenv.Config{
    RouterOptions: []core.Option{
        core.WithEntityCacheInstances(map[string]resolve.LoaderCache{
            "default": entitycache.NewMemoryEntityCache(),
        }),
    },
    // ... config to enable entity caching
}, func(t *testing.T, xEnv *testenv.Environment) {
    // Tests run against in-memory cache
})
```

**Note**: A `core.WithEntityCacheInstances()` option may need to be added to the router to allow test injection of cache instances.

### Subgraph Call Counting

Use `SubgraphRequestCount` to verify cache hits vs. misses:

```go
func(t *testing.T, xEnv *testenv.Environment) {
    // First request: cache miss → subgraph call
    xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
        Query: `query { user(id: "1") { id name } }`,
    })
    require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Accounts.Load())

    // Second request: cache hit → no subgraph call
    xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
        Query: `query { user(id: "1") { id name } }`,
    })
    require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Accounts.Load()) // still 1
}
```

## Test Subgraph Schemas

Use or extend existing test subgraphs with entity caching directives. The schemas from ENTITY_CACHING_TODO.md section 8:

**accounts:**
```graphql
type User @key(fields: "id") @entityCache(maxAge: 300) {
  id: ID!
  name: String!
  email: String!
}

type Query {
  user(id: ID!): User @queryCache(maxAge: 300)
  me: User @queryCache(maxAge: 60, includeHeaders: true)
}

type Mutation {
  updateUser(id: ID!, name: String!): User @cacheInvalidate
  deleteUser(id: ID!): User @cacheInvalidate
}
```

**products:**
```graphql
type Product @key(fields: "upc") @entityCache(maxAge: 600, partialCacheLoad: true) {
  upc: String!
  name: String!
  price: Float!
}

type Review @key(fields: "id") @entityCache(maxAge: 120) {
  id: ID!
  body: String!
  product: Product!
  author: User!
  stars: Int!
}

type Query {
  topProducts(first: Int = 5): [Product!]! @queryCache(maxAge: 30)
  product(upc: String!): Product @queryCache(maxAge: 600)
}

type Mutation {
  addReview(productUpc: String!, body: String!, stars: Int!): Review @cachePopulate
  updateProduct(upc: String!, price: Float!): Product @cacheInvalidate
}

type Subscription {
  productPriceChanged: Product @cachePopulate
  productDeleted: Product @cacheInvalidate
}
```

## Router Test Scenarios (18)

### File: `router-tests/entity_caching_test.go`

**1. Basic L2 miss-then-hit**
- First request fetches from subgraph (miss), second request serves from cache (hit)
- Assert: subgraph called once for two identical requests

**2. Different entities**
- Fetch User(1) then User(2)
- Assert: separate cache entries, subgraph called twice

**3. L1 deduplication**
- Single request that fetches same entity twice (via different paths)
- Assert: subgraph called once per entity

**4. Mutation invalidation (`@cacheInvalidate`)**
- Query user (cached) → mutate user → query user again (cache miss)
- Assert: subgraph called 3 times (initial fetch, mutation, re-fetch)

**5. Mutation population (`@cachePopulate`)**
- Mutate (with @cachePopulate) → query same entity
- Assert: query is a cache hit, subgraph not called for the query

**6. Mutual exclusivity**
- Compose schema with both `@cacheInvalidate` and `@cachePopulate` on same field
- Assert: composition error with correct message

**7. Multi-subgraph cache**
- Cache User from accounts and Product from products independently
- Assert: each subgraph's entities cached separately

**8. Root field caching (`@queryCache`)**
- `user(id: "1")` cached using entity key format
- Assert: subsequent `_entities` fetch for same User is a cache hit

**9. `@is` argument mapping**
- Field `userById(userId)` with `@is(field: "id")`
- Assert: shares cache with `user(id)` query and `_entities` User fetch

**10. List return caching**
- `topProducts` caches each Product individually
- Assert: subsequent `product(upc: "top-1")` is a cache hit

**11. Extension-based invalidation**
- Subgraph response includes `extensions.cacheInvalidation.keys`
- Assert: referenced cache entries are deleted

**12. Subscription invalidation**
- `productDeleted` subscription event
- Assert: Product cache entry deleted

**13. Subscription population**
- `productPriceChanged` subscription event
- Assert: fresh Product data written to cache

**14. TTL expiry**
- Set short TTL (e.g., 1 second), query, wait, query again
- Assert: second query is a cache miss after TTL expires

**15. Shadow mode**
- `@entityCache(shadowMode: true)`
- Assert: fresh data always served, but cache reads/writes happen
- Assert: subgraph always called (no cache-based skipping)

**16. Analytics**
- Enable analytics, execute queries
- Assert: cache hit/miss metrics are collected (via test metric exporter or snapshot)

**17. No-argument query cache**
- `me` query with no arguments
- Assert: uses root field cache key format, subsequent request is cached

**18. Per-subgraph cache name**
- Configure different `cache_name` for different entities
- Assert: entities route to correct cache instances (different `MemoryEntityCache` instances)

**19. Field argument hashing**
- Entity field with arguments (e.g., `greeting(style: "formal")` vs `greeting(style: "casual")`)
- Assert: different argument values produce different cache entries (engine handles xxhash internally)

**20. Write-only mode (incomplete key mapping)**
- `@queryCache` on non-list field where argument→key mapping is incomplete (e.g., `search(name: String): User` where `@key(fields: "id")`)
- Assert: query always hits subgraph (no cache read), but entity from response is still cached
- Assert: subsequent `_entities` fetch for the same User by `id` is a cache hit (populated from the search result)

## Composition Tests

### File: `composition/tests/v1/entity-caching/entity-caching.test.ts`

Test each of the 20 validation rules using `normalizeSubgraph()`:

```typescript
describe('Entity Caching Directives', () => {
  describe('@entityCache', () => {
    test('Rule 1: error when @entityCache on type without @key', () => {
      const result = normalizeSubgraph(parse(`
        type User @entityCache(maxAge: 300) {
          id: ID!
          name: String!
        }
      `), 'test', undefined, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain("has @entityCache but no @key directive");
    });

    test('Rule 3: error when maxAge is not positive', () => {
      // @entityCache(maxAge: -1) → error
    });

    test('valid @entityCache on entity type', () => {
      const result = normalizeSubgraph(parse(`
        type User @key(fields: "id") @entityCache(maxAge: 300) {
          id: ID!
          name: String!
        }
      `), 'test', undefined, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
    });
  });

  // ... similar blocks for @queryCache, @is, @cacheInvalidate, @cachePopulate
});
```

**Test federation** (cross-subgraph composition):

```typescript
test('entity caching config serialized to datasource configuration', () => {
  const result = federateSubgraphsSuccess([accountsSubgraph, productsSubgraph], ROUTER_COMPATIBILITY_VERSION_ONE);
  expect(result.success).toBe(true);
  // Verify datasource configurations include cache config arrays
});
```

## Verification

1. **Router tests pass**: `cd router-tests && go test -race -run TestEntityCaching ./...`
2. **Composition tests pass**: `cd composition && npx vitest run tests/v1/entity-caching/`
3. **No regressions**: Full test suites pass: `cd router && go test ./...` and `cd composition && npm test`
4. **Race conditions**: All tests pass with `-race` flag
5. **Test coverage**: All 20 router scenarios and all 20 composition validation rules covered

## Out of Scope

- Cache backend unit tests (Task 03 — `memory_test.go`, `redis_test.go`)
- Extension-based invalidation implementation (Task 12 — tested here for basic case)
- Performance/load tests
