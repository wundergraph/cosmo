# Task 01: Proto Schema Changes + Codegen

## Objective

Add 5 new protobuf messages and 4 new repeated fields to `DataSourceConfiguration` to support entity caching configuration in the router execution config. This is the foundational schema change that all subsequent entity caching tasks depend on.

## Scope

- Define 6 new protobuf messages: `EntityCacheConfiguration`, `RootFieldCacheConfiguration`, `EntityKeyMapping`, `FieldMapping`, `CachePopulateConfiguration`, `CacheInvalidateConfiguration`
- Add 4 new repeated fields (field numbers 16-19) to the existing `DataSourceConfiguration` message
- Regenerate Go code (router + connect-go)
- Regenerate TypeScript code (connect package)
- Verify all existing tests pass

## Files to Modify

### Proto Definition

**File**: `proto/wg/cosmo/node/v1/node.proto`

### Generated Files (auto-generated, do not edit manually)

- `router/gen/proto/wg/cosmo/node/v1/node.pb.go`
- `connect-go/wg/cosmo/node/v1/node.pb.go`
- `connect/src/wg/cosmo/node/v1/node_pb.ts`

## Proto Changes

### 1. New Messages

Add these 5 messages to `node.proto`. Place them after the `EntityInterfaceConfiguration` message (line 168) and before `FetchConfiguration` (line 170).

```protobuf
// Entity type caching configuration (from @entityCache directive)
message EntityCacheConfiguration {
  string type_name = 1;                   // Entity type name
  int64 max_age_seconds = 2;              // TTL in seconds
  bool include_headers = 3;               // Include forwarded headers in cache key
  bool partial_cache_load = 4;            // Only fetch missing entities in batch
  bool shadow_mode = 5;                   // Test caching without serving cached data
}

// Root field caching configuration (from @queryCache directive)
message RootFieldCacheConfiguration {
  string field_name = 1;                  // Query field name
  int64 max_age_seconds = 2;              // TTL in seconds
  bool include_headers = 3;               // Include forwarded headers in cache key
  bool shadow_mode = 4;                   // Test caching without serving cached data
  string entity_type_name = 5;            // Return entity type (for cache key format)
  repeated EntityKeyMapping entity_key_mappings = 6;      // Entity key → argument mappings
}

// Maps entity key fields to query field arguments (from @is directive or auto-mapping).
// Groups field mappings by entity type to support multi-entity returns.
message EntityKeyMapping {
  string entity_type_name = 1;            // Entity type name (e.g., "User")
  repeated FieldMapping field_mappings = 2; // Key field → argument mappings
}

// Maps a single entity @key field to an argument path
message FieldMapping {
  string entity_key_field = 1;            // Entity @key field name
  repeated string argument_path = 2;      // Argument path (e.g., ["input", "userId"] for nested args)
}

// Mutation/subscription cache population configuration (from @cachePopulate directive)
message CachePopulateConfiguration {
  string field_name = 1;                  // Mutation/subscription field name
  string operation_type = 2;              // "Mutation" or "Subscription"
  optional int64 max_age_seconds = 3;     // Override TTL (nil = use entity's TTL)
}

// Mutation/subscription cache invalidation configuration (from @cacheInvalidate directive)
message CacheInvalidateConfiguration {
  string field_name = 1;                  // Mutation/subscription field name
  string operation_type = 2;              // "Mutation" or "Subscription"
  string entity_type_name = 3;            // Entity type to invalidate (inferred from return type)
}
```

### 2. New Fields on DataSourceConfiguration

The current highest field number in `DataSourceConfiguration` is **15** (`interface_objects`). Add 4 new repeated fields at positions 16-19.

```protobuf
message DataSourceConfiguration {
  DataSourceKind kind = 1;
  repeated TypeField root_nodes = 2;
  repeated TypeField child_nodes = 3;
  bool override_field_path_from_alias = 4;
  DataSourceCustom_GraphQL custom_graphql = 5;
  DataSourceCustom_Static custom_static = 6;
  repeated DirectiveConfiguration directives = 7;
  int64 request_timeout_seconds = 8;
  string id = 9;
  repeated RequiredField keys = 10;
  repeated RequiredField provides = 11;
  repeated RequiredField requires = 12;
  DataSourceCustomEvents custom_events = 13;
  repeated EntityInterfaceConfiguration entity_interfaces = 14;
  repeated EntityInterfaceConfiguration interface_objects = 15;
  // Entity caching configurations (from composition directives)
  repeated EntityCacheConfiguration entity_cache_configurations = 16;
  repeated RootFieldCacheConfiguration root_field_cache_configurations = 17;
  repeated CachePopulateConfiguration cache_populate_configurations = 18;
  repeated CacheInvalidateConfiguration cache_invalidate_configurations = 19;
}
```

## Code Generation

### Prerequisites

```bash
make setup-build-tools
```

Installs: `buf` v1.32.2, `protoc-gen-go` v1.34.2, `protoc-gen-connect-go` v1.16.2

### Generate All Code (recommended)

```bash
make generate
```

This runs `pnpm generate` (TypeScript) followed by `make generate-go` (Go).

### Generate Go Only

```bash
make generate-go
```

Runs 3 buf generate commands via the root Makefile:
1. **Router Go** — `buf generate --path proto/wg/cosmo/node ... --template buf.router.go.gen.yaml` → `router/gen/proto/`
2. **GraphQL Metrics Go** — `buf generate --path proto/wg/cosmo/graphqlmetrics ... --template buf.graphqlmetrics.go.gen.yaml` → `graphqlmetrics/gen/`
3. **Connect Go** — `buf generate --path proto/wg/cosmo/node ... --template buf.connect-go.go.gen.yaml` → `connect-go/wg/`

### Generate TypeScript Only

```bash
pnpm generate
```

Uses `buf.ts.gen.yaml` template with `protoc-gen-es`, `protoc-gen-connect-es`, `protoc-gen-connect-query`. Output: `connect/src/wg/cosmo/node/v1/node_pb.ts`

## Dependencies

**None.** This is the first task in the implementation sequence. All other entity caching tasks depend on these proto definitions.

## Compatibility Version

Current `RouterCompatibilityVersionThreshold` is `1` (defined in `router/pkg/execution_config/compatibility.go`).

**No compatibility version bump needed.** Adding new optional/repeated fields to a protobuf message is backward-compatible:
- Old routers ignore unknown fields
- New routers see empty repeated fields when caching is not configured

## Verification Criteria

1. **Proto lints**: `buf lint` passes with no errors
2. **Go codegen**: `make generate-go` succeeds. Verify structs exist:
   ```bash
   grep -c 'EntityCacheConfiguration' router/gen/proto/wg/cosmo/node/v1/node.pb.go
   grep -c 'RootFieldCacheConfiguration' router/gen/proto/wg/cosmo/node/v1/node.pb.go
   grep -c 'EntityKeyMapping' router/gen/proto/wg/cosmo/node/v1/node.pb.go
   grep -c 'FieldMapping' router/gen/proto/wg/cosmo/node/v1/node.pb.go
   grep -c 'CachePopulateConfiguration' router/gen/proto/wg/cosmo/node/v1/node.pb.go
   grep -c 'CacheInvalidateConfiguration' router/gen/proto/wg/cosmo/node/v1/node.pb.go
   ```
3. **TS codegen**: `pnpm generate` succeeds. Verify classes exist in `connect/src/wg/cosmo/node/v1/node_pb.ts`
4. **Go builds**: `cd router && go build ./...` compiles without errors
5. **Existing tests pass**: `cd router && go test ./...` — no regressions
6. **Breaking change check**: `buf breaking --against '.git#branch=main'` reports only additions (no breaking changes)

## Implementation Notes

- The `optional` keyword on `CachePopulateConfiguration.max_age_seconds` generates a pointer type in Go (`*int64`) to distinguish "not set" (use entity's TTL) from "explicitly set".
- All other fields use standard proto3 semantics (zero values are default).
- `operation_type` is a string (`"Mutation"` or `"Subscription"`) rather than the existing `OperationType` enum, matching the TODO design. Using the enum is also viable if preferred.
- The new messages reference no external types — only `string`, `int64`, `bool`, `EntityKeyMapping`, and `FieldMapping`.
