# AGENTS.md — Composition Library

## Working on Entity Caching

When modifying entity caching logic, understand these invariants:

### The Key Mapping Pipeline

The flow from @key to router cache config is:

```
@key(fields: "...") on entity type
    ↓
extractKeyFieldSets() → KeyFieldSetData { documentNode, normalizedFieldSet, isUnresolvable }
    ↓
keyFieldSetDatasByTypeName: Map<TypeName, Map<normalizedFieldSet, KeyFieldSetData>>
    ↓
validateKeyFieldSets() → keyFieldPathsByTypeNameByFieldSet (per-key dot-notation paths)
    ↓
extractPerKeyFieldPaths() → Array<{normalizedFieldSet, isUnresolvable, fieldPaths: Set<string>}>
    ↓
buildArgumentKeyMappings() → EntityKeyMappingConfig[] (one per fully-satisfiable key)
    ↓
RootFieldCacheConfig.entityKeyMappings → serialized to protobuf → router
```

Each `@key` is evaluated independently. `validateKeyFieldSets()` produces dot-notation paths (e.g., `"store.id"` from `@key(fields: "store { id }")`). `extractPerKeyFieldPaths()` groups these paths per key. `buildArgumentKeyMappings()` attempts argument mapping against each key separately and emits an `EntityKeyMappingConfig` for every fully-satisfiable key.

### Key Rule: Alternative Keys Are Independent

Entity types can have multiple @key directives representing ALTERNATIVE keys (not combined keys):

```graphql
type Product @key(fields: "id") @key(fields: "sku region") { ... }
```

These are independent — a resolver only needs to satisfy ONE key. Each key is evaluated separately and all fully-satisfiable keys produce their own `EntityKeyMappingConfig`.

### Key Rule: Nested Keys Use Dot-Notation Paths

`@key(fields: "store { id }")` means the entity is identified by `store.id` — a path through an object. The pipeline converts the normalized field set `"store { id }"` into the dot-notation path `"store.id"`. The `@openfed__is` directive references these paths directly: `@openfed__is(fields: "store.id")`. `FieldMappingConfig.entityKeyField` stores the dot-notation path string.

### Where Key Data Lives

| Stage          | Location                                                             | What It Holds                                             |
| -------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Per-subgraph   | `keyFieldSetDatasByTypeName`                                         | Full AST + metadata per key                               |
| Cross-subgraph | `entityDataByTypeName[t].keyFieldSetDatasBySubgraphName`             | Keys grouped by subgraph                                  |
| Router config  | `configurationData.keys`                                             | `RequiredFieldConfiguration[]` with selection set strings |
| Cache config   | `configurationData.rootFieldCacheConfigurations[].entityKeyMappings` | Argument→key field mappings                               |

### Entity Caching Validation Rules

| Rule | What                                                                             | Where                    |
| ---- | -------------------------------------------------------------------------------- | ------------------------ |
| 1    | @openfed\_\_entityCache requires @key                                            | Phase 1                  |
| 3    | maxAge must be positive                                                          | Phase 1                  |
| 4    | @openfed\_\_queryCache only on Query fields                                      | Phase 2                  |
| 5    | @openfed\_\_queryCache return type must have @key                                | Phase 2                  |
| 6    | @openfed\_\_queryCache return type must have @openfed\_\_entityCache             | Phase 2                  |
| 7    | Warning: incomplete key mapping (non-list only)                                  | Phase 2                  |
| 9    | @openfed\_\_queryCache maxAge must be positive                                   | Phase 2                  |
| 10   | @openfed\_\_is only with @openfed\_\_queryCache                                  | Phase 2                  |
| 11   | `@openfed__is(fields: "...")` must reference an existing `@key` field path       | buildArgumentKeyMappings |
| 12   | No duplicate key field mappings                                                  | buildArgumentKeyMappings |
| 13   | Warning: redundant @openfed\_\_is when arg name matches key field                | buildArgumentKeyMappings |
| 14   | @openfed\_\_cacheInvalidate only on Mutation/Subscription                        | Phase 2                  |
| 16   | @openfed\_\_cacheInvalidate and @openfed\_\_cachePopulate are mutually exclusive | Phase 2                  |

### Protobuf Mapping

TypeScript types serialize to proto messages in `shared/src/router-config/graphql-configuration.ts`:

- `EntityCacheConfig` → `EntityCacheConfiguration`
- `RootFieldCacheConfig` → `RootFieldCacheConfiguration`
- `FieldMappingConfig` → `EntityCacheFieldMapping`
- `CachePopulateConfig` → `CachePopulateConfiguration`
- `CacheInvalidateConfig` → `CacheInvalidateConfiguration`

Proto definitions in `proto/wg/cosmo/node/v1/node.proto`.

### Test Expectations

- Always pass `version: ROUTER_COMPATIBILITY_VERSION_ONE` to `batchNormalize`
- Use `getConfigForType()` helper for config extraction tests
- Assert exact config structure with `toStrictEqual()`
- Entity caching tests live in `tests/v1/directives/entity-caching.test.ts`

### What's NOT Tested (Gaps)

- Input object arguments mapping to key fields (multi-element `argumentPath`)
- Mixed resolvable/unresolvable keys on same type with caching
