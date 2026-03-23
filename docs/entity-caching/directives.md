# Entity Caching Directives

This document defines the GraphQL directives for configuring entity caching in cosmo federation subgraphs.

---

## Design Principles

1. **Subgraph developers declare what to cache.** Directives express freshness requirements and data relationships.
2. **Flat arguments.** Following ecosystem convention, directive arguments use scalars, enums, and simple lists — no nested input objects.
3. **Seconds for TTL.** All frameworks (Apollo `@cacheControl`, Stellate `@stellate_cache`, Hasura `@cached`) use seconds. We follow this convention.
4. **Separate directives per concern.** Each directive has a single, clear purpose rather than one overloaded directive with context-dependent behavior.
5. **Mutual exclusivity.** A field either invalidates or populates the cache — never both.
6. **No prefix.** Like `@authenticated` and `@requiresScopes`, entity caching is a first-class cosmo feature and uses unprefixed directive names.

---

## Directives

### 1. `@entityCache` — Entity Type Caching

Declares that instances of this entity type should be cached when resolved via `_entities` queries.

```graphql
directive @entityCache(
  maxAge: Int!
  negativeCacheTTL: Int = 0
  includeHeaders: Boolean = false
  partialCacheLoad: Boolean = false
  shadowMode: Boolean = false
) on OBJECT
```

**Not repeatable.** Each entity type may have at most one `@entityCache` directive.

**Arguments:**

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `maxAge` | Int! | required | TTL in seconds. How long a cached entity remains valid. |
| `negativeCacheTTL` | Int | 0 | TTL in seconds for caching null entity results (entity not found). When > 0, null responses from `_entities` (entity returned null without errors) are cached as negative sentinels to avoid repeated subgraph lookups for non-existent entities. When 0 (default), null entities are not cached. Use shorter TTLs than `maxAge` (e.g., 5-10s) so deleted entities are re-checked sooner. |
| `includeHeaders` | Boolean | false | When true, forwarded HTTP headers are hashed and included in the cache key. Use for multi-tenant scenarios where the same entity ID may return different data depending on request headers (e.g., authorization token, tenant header). |
| `partialCacheLoad` | Boolean | false | Controls batch miss behavior. When false (default): any miss in a batch refetches ALL entities (maximum freshness). When true: only missing entities are fetched (reduced subgraph load, within-TTL staleness acceptable). |
| `shadowMode` | Boolean | false | When true, L2 reads and writes happen but cached data is never served. Fresh data is always fetched from the subgraph. Use for testing caching behavior (hit rates, staleness) before enabling it in production. |

**Example:**

```graphql
# Basic: cache User entities for 5 minutes
type User @key(fields: "id") @entityCache(maxAge: 300) {
  id: ID!
  name: String!
  email: String!
}

# Multi-tenant: include auth headers in cache key
type Account @key(fields: "id") @entityCache(maxAge: 600, includeHeaders: true) {
  id: ID!
  balance: Float!
}

# High-throughput: only fetch missing entities in batch
type Product @key(fields: "upc") @entityCache(maxAge: 120, partialCacheLoad: true) {
  upc: String!
  name: String!
  price: Float!
  inStock: Boolean!
}

# Shadow mode: test caching without serving cached data
type Inventory @key(fields: "sku") @entityCache(maxAge: 60, shadowMode: true) {
  sku: String!
  quantity: Int!
}

# Negative caching: cache "not found" for 10 seconds to avoid repeated lookups
type Product @key(fields: "upc") @entityCache(maxAge: 600, negativeCacheTTL: 10) {
  upc: String!
  name: String!
  price: Float!
}

# Composite key
type OrderItem @key(fields: "orderId itemId") @entityCache(maxAge: 60) {
  orderId: ID!
  itemId: ID!
  quantity: Int!
}
```

**Cache key format:**
```json
{"__typename":"User","key":{"id":"123"}}
{"__typename":"Product","key":{"upc":"top-1"}}
{"__typename":"OrderItem","key":{"itemId":"42","orderId":"1"}}
```

---

### 2. `@queryCache` — Root Query Field Caching

Declares that the result of a root query field should be cached. The field must return an entity type (or list of entities). The cache uses entity key format, enabling sharing between root field queries and `_entities` fetches.

```graphql
directive @queryCache(
  maxAge: Int!
  includeHeaders: Boolean = false
  shadowMode: Boolean = false
) on FIELD_DEFINITION
```

**Not repeatable.**

**Arguments:**

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `maxAge` | Int! | required | TTL in seconds. |
| `includeHeaders` | Boolean | false | Include forwarded headers in cache key. |
| `shadowMode` | Boolean | false | When true, caching runs in shadow mode (reads/writes happen but cached data is never served). |

**Argument-to-Key Mapping:**

When a `@queryCache` field returns an entity, composition maps field arguments to `@key` fields to enable cache sharing:

1. **Auto-mapping**: If a field argument name matches a `@key` field name exactly, the mapping is automatic.
2. **Explicit mapping with `@is`**: When argument names differ from `@key` field names, use the `@is` directive on the argument to declare the mapping.
3. **Composition error**: If any `@key` field cannot be mapped to an argument (neither by name match nor `@is`), composition fails with an error listing the unmapped fields.

**Single Entity Return:**

When a field returns a single entity type and all `@key` fields can be mapped to arguments, the cache key uses entity key format:
- A `@queryCache` hit for `user(id: "123")` also serves a subsequent `_entities` fetch for `User(id: "123")`
- An `@entityCache` write for `User(id: "123")` also serves a subsequent `user(id: "123")` query

**List Entity Return:**

When a field returns a list of entities (e.g., `[Product!]!`), each entity in the result is individually cached using its own entity key. This maps to a list of entity keys — one per entity in the result. Each cached entity is shared with `_entities` fetches.

**No-Argument Fields:**

When a field has no arguments (e.g., `me: User`), it uses root field cache key format since there are no arguments to map to entity keys.

**Example:**

```graphql
type User @key(fields: "id") @entityCache(maxAge: 300) {
  id: ID!
  name: String!
  email: String!
}

type Product @key(fields: "upc") @entityCache(maxAge: 600) {
  upc: String!
  name: String!
  price: Float!
}

type OrderItem @key(fields: "orderId itemId") @entityCache(maxAge: 60) {
  orderId: ID!
  itemId: ID!
  quantity: Int!
}

type Query {
  # Auto-mapped: argument "id" matches User @key field "id"
  # Cache key: {"__typename":"User","key":{"id":"123"}}
  user(id: ID!): User @queryCache(maxAge: 300)

  # Explicit mapping: argument "userId" does NOT match User @key field "id"
  # @is maps "userId" → "id"
  # Cache key: {"__typename":"User","key":{"id":"123"}}
  userById(userId: ID! @is(field: "id")): User @queryCache(maxAge: 300)

  # Auto-mapped composite key: both argument names match @key fields
  # Cache key: {"__typename":"OrderItem","key":{"orderId":"1","itemId":"42"}}
  orderItem(orderId: ID!, itemId: ID!): OrderItem @queryCache(maxAge: 60)

  # List return: each Product in the result is cached individually
  # Cache keys: [{"__typename":"Product","key":{"upc":"top-1"}}, ...]
  topProducts(first: Int = 5): [Product!]! @queryCache(maxAge: 30)

  # No arguments, returns entity: uses root field cache key format
  # Cache key: {"__typename":"Query","field":"me"}
  me: User @queryCache(maxAge: 60, includeHeaders: true)
}
```

**Cache key format (entity-mapped — single entity return with mapped args):**
```json
{"__typename":"User","key":{"id":"123"}}
{"__typename":"OrderItem","key":{"orderId":"1","itemId":"42"}}
```

**Cache key format (list return — list of entity keys):**
```json
[
  {"__typename":"Product","key":{"upc":"top-1"}},
  {"__typename":"Product","key":{"upc":"top-2"}}
]
```

**Cache key format (no-argument field — root field format):**
```json
{"__typename":"Query","field":"me"}
```

---

### 3. `@is` — Argument-to-Key Field Mapping

Maps a query field argument to an entity `@key` field when the names don't match. Used together with `@queryCache` to enable cache key sharing.

```graphql
directive @is(
  field: String!
) on ARGUMENT_DEFINITION
```

**Arguments:**

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `field` | String! | required | The `@key` field name on the return entity type that this argument maps to. |

**Example:**

```graphql
type Product @key(fields: "upc") @entityCache(maxAge: 600) {
  upc: String!
  name: String!
}

type Query {
  # Argument "productUpc" does not match @key field "upc"
  # @is explicitly maps it
  product(productUpc: String! @is(field: "upc")): Product @queryCache(maxAge: 600)

  # Without @is, this would be a composition error:
  # "Field 'Query.product' has @queryCache but argument 'productUpc'
  #  cannot be mapped to Product @key field 'upc'. Use @is(field: "upc")
  #  on the argument to declare the mapping."
}
```

---

### 4. `@cacheInvalidate` — Cache Invalidation

Declares that after this field completes, the cached entity should be deleted from L2.

```graphql
directive @cacheInvalidate on FIELD_DEFINITION
```

No arguments. **Not repeatable.**

**Behavior:**
- **On mutations:** After the mutation completes and returns entity data containing `@key` fields, the corresponding L2 cache entry is deleted. The engine extracts the key field values from the mutation response to build the exact cache key to delete.
- **On subscriptions:** When a subscription event arrives containing entity data with `@key` fields, the corresponding L2 cache entry is deleted. Use this for "entity deleted" or "entity changed" events where you want to ensure stale data is evicted.

**Example:**

```graphql
type Mutation {
  # After update completes, User(id: "123") is deleted from L2
  updateUser(id: ID!, name: String!): User @cacheInvalidate

  # After delete completes, Product(upc: "abc") is deleted from L2
  deleteProduct(upc: String!): Product @cacheInvalidate
}

type Subscription {
  # When a product deletion event arrives, delete it from L2
  productDeleted: Product @cacheInvalidate

  # When a user changes, delete stale cache entry
  userChanged: User @cacheInvalidate
}
```

---

### 5. `@cachePopulate` — Cache Population

Declares that entity data from this field's execution should be written to the L2 cache.

```graphql
directive @cachePopulate(
  maxAge: Int
) on FIELD_DEFINITION
```

**Not repeatable.**

**Arguments:**

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `maxAge` | Int | nil | TTL in seconds for cache entries populated by this field. When omitted, uses the `@entityCache` TTL from the return entity type. When provided, overrides the entity TTL for entries written by this field. |

**Behavior:**
- **On mutations:** By default, mutations skip L2 reads AND writes. This directive enables L2 writes for entity fetches triggered during this mutation's execution. L2 reads remain skipped (mutations always fetch fresh data). After the mutation returns entity data, the freshly fetched entities are written to L2.
- **On subscriptions:** When a subscription event arrives containing entity data with `@key` fields and additional entity fields, the entity data is written to L2 cache. This keeps the cache warm as entities change in real time.

**Example:**

```graphql
type Mutation {
  # After creating a review, entity fetches for the associated
  # Product and User will be written to L2 cache
  addReview(productUpc: String!, body: String!, stars: Int!): Review @cachePopulate

  # Override TTL: write to cache with 10-minute TTL instead of entity's 5-minute TTL
  refreshUser(id: ID!): User @cachePopulate(maxAge: 600)
}

type Subscription {
  # Subscription events with full Product data are written to L2 cache
  productPriceChanged: Product @cachePopulate

  # Override TTL for subscription-driven cache population
  accountBalanceChanged: Account @cachePopulate(maxAge: 300)
}
```

---

## Validation Rules

This section consolidates all composition-time validation rules.

### `@entityCache`
1. Must be on a type with `@key`. Error: `"Type 'X' has @entityCache but no @key directive."`
2. At most one per type. Error: `"Type 'X' has multiple @entityCache directives."`
3. `maxAge` must be a positive integer. Error: `"@entityCache maxAge must be a positive integer, got 'N'."`
3a. `negativeCacheTTL`, if provided, must be a non-negative integer. Error: `"@entityCache negativeCacheTTL must be a non-negative integer, got 'N'."`

### `@queryCache`
4. Only on fields of root `Query` type. Error: `"@queryCache is only valid on Query fields, found on Mutation.X / Subscription.X."`
5. Return type must be an entity (type with `@key`), or a list of entities. Error: `"Field 'Query.X' has @queryCache but returns non-entity type 'Y'. @queryCache requires the return type to be an entity with @key."`
6. The return entity type must have `@entityCache`. Error: `"Field 'Query.X' returns entity type 'Y' which does not have @entityCache."`
7. When returning a single entity: all `@key` fields must be mappable to field arguments (by name match or `@is`). Error: `"Field 'Query.X' has @queryCache returning 'Y' but @key field 'Z' cannot be mapped to any argument. Add an argument named 'Z' or use @is(field: \"Z\") on an existing argument."`
8. When returning a list of entities: all `@key` fields must be mappable to field arguments (by name match or `@is`). Error: same as rule 7. Entity keys are extracted per-entity from the response, but the mapping must be complete for composition to validate correctness.
9. `maxAge` must be a positive integer.

### `@is`
10. Only on arguments of fields that have `@queryCache`. Error: `"@is on argument 'X' of field 'Query.Y' has no effect without @queryCache."`
11. The `field` value must reference a `@key` field on the return entity type. Error: `"@is(field: \"X\") on argument 'Y' of field 'Query.Z' references unknown @key field 'X' on type 'W'."`
12. No duplicate mappings — two arguments must not map to the same `@key` field. Error: `"Multiple arguments on field 'Query.X' map to @key field 'Y'."`
13. An argument must not have `@is` if its name already matches a `@key` field. Error: `"Argument 'X' on field 'Query.Y' already matches @key field 'X' by name — @is is redundant."`

### `@cacheInvalidate`
14. Only on fields of root `Mutation` or `Subscription` type. Error: `"@cacheInvalidate is only valid on Mutation or Subscription fields."`
15. Return type must be an entity with `@key` and `@entityCache`. Error: `"Field 'Mutation.X' has @cacheInvalidate but returns non-entity type 'Y'."`
16. Mutually exclusive with `@cachePopulate`. Error: `"Field 'Mutation.X' has both @cacheInvalidate and @cachePopulate. A field must use one or the other, not both."`

### `@cachePopulate`
17. Only on fields of root `Mutation` or `Subscription` type. Error: `"@cachePopulate is only valid on Mutation or Subscription fields."`
18. Return type must be an entity with `@key` and `@entityCache`. Error: `"Field 'Subscription.X' has @cachePopulate but returns non-entity type 'Y'."`
19. Mutually exclusive with `@cacheInvalidate`. (Same error as rule 16.)
20. If `maxAge` is provided, must be a positive integer.

---

## Composition Behavior

### Directive Processing

During composition, the directives are:
1. **Validated** — all rules from the Validation Rules section are checked
2. **Extracted** — argument values are parsed into internal data structures
3. **Output** — cache configurations are serialized into the `DataSourceConfiguration` entries of the router execution config (one config per subgraph)
4. **Stripped from federated schema** — like `@authenticated`, caching directives do not appear in the final federated/client schema. They are metadata for the router, not for clients.

### Cross-Subgraph Behavior

When the same entity type is defined in multiple subgraphs with different `@entityCache` configurations:
- Each subgraph's cache configuration applies independently to fetches routed to that subgraph
- The router caches entity data per-subgraph, using the subgraph-specific TTL
- Entity key format is consistent across subgraphs (derived from `@key` fields)

---

## Directive Summary

| Directive | Location | Repeatable | Purpose | Key Args |
|-----------|----------|------------|---------|----------|
| `@entityCache` | OBJECT | No | Cache entity type via `_entities` | maxAge, negativeCacheTTL, includeHeaders, partialCacheLoad, shadowMode |
| `@queryCache` | FIELD_DEFINITION | No | Cache root query field (entity return required) | maxAge, includeHeaders, shadowMode |
| `@is` | ARGUMENT_DEFINITION | No | Map argument to entity @key field | field |
| `@cacheInvalidate` | FIELD_DEFINITION | No | Delete L2 cache on mutation/subscription | (none) |
| `@cachePopulate` | FIELD_DEFINITION | No | Write to L2 cache on mutation/subscription | maxAge |

---

## Complete Example

### Subgraph: Accounts

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@shareable"])

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

### Subgraph: Products

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@shareable"])

type Product @key(fields: "upc") @entityCache(maxAge: 600, negativeCacheTTL: 10, partialCacheLoad: true) {
  upc: String!
  name: String!
  price: Float!
  inStock: Boolean!
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
  productByUpc(productUpc: String! @is(field: "upc")): Product @queryCache(maxAge: 600)
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

---

## Ecosystem Comparison

| Feature | Cosmo (proposed) | Apollo | Stellate |
|---------|-----------------|--------|----------|
| Entity type caching | `@entityCache(maxAge)` | `@cacheControl(maxAge)` | `@stellate_cache(maxAge)` |
| Root field caching | `@queryCache(maxAge)` | `@cacheControl(maxAge)` | `@stellate_cache(maxAge)` |
| Cache key sharing | Automatic via `@queryCache` + `@is` | Not available | Not available |
| Mutation invalidation | `@cacheInvalidate` | `@cacheTag` + HTTP endpoint | Not available |
| Mutation population | `@cachePopulate` | Not available | Not available |
| Subscription invalidation | `@cacheInvalidate` on Subscription | Not available | Not available |
| Subscription population | `@cachePopulate` on Subscription | Not available | Not available |
| Multi-tenant isolation | `includeHeaders: true` | Not available | `scope: "AUTHENTICATED"` |
| Partial batch loading | `partialCacheLoad: true` | Not available | Not available |
| Shadow mode | `shadowMode: true` | Not available | Not available |
| Negative caching | `negativeCacheTTL: Int` | Not available | Not available |
| SWR | Not yet (future) | Not available | `swr: Int` |
| TTL unit | Seconds | Seconds | Seconds |
