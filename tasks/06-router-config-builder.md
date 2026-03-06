# Task 06: Router Config Builder — Proto Serialization

## Objective

Extend the router config builder to serialize entity caching configuration from the composition output into the 4 new proto repeated fields on `DataSourceConfiguration`. This bridges composition (TypeScript) and the router (Go) — the composition extracts cache configs, and this task converts them to the proto format the router consumes.

## Scope

- Extend `configurationDatasToDataSourceConfiguration()` in the shared router config builder
- Add conversion functions for each cache config type → proto message type
- Ensure the output JSON matches the proto schema from Task 01

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 01 | Proto messages: `EntityCacheConfiguration`, `RootFieldCacheConfiguration`, `EntityKeyMapping`, `FieldMapping`, `CachePopulateConfiguration`, `CacheInvalidateConfiguration` |
| Task 02 | Directive registration (prerequisites for Task 05) |
| Task 05 | Extracted cache config data in `ConfigurationData` (types from `composition/src/router-configuration/types.ts`) |

## File to Modify

### `shared/src/router-config/graphql-configuration.ts`

This file (319 lines) contains `configurationDatasToDataSourceConfiguration()` (lines 113-219), which converts composition intermediate format to router protobuf format. It already handles `keys`, `provides`, `requires`, `entityInterfaces`, `interfaceObjects`, and event configurations.

## Implementation

### 1. Import Proto Types

Add imports for the new proto message types from the generated TypeScript proto file:

```ts
import {
  // ... existing imports ...
  EntityCacheConfiguration,
  RootFieldCacheConfiguration,
  EntityKeyMapping,
  FieldMapping,
  CachePopulateConfiguration,
  CacheInvalidateConfiguration,
} from '../../connect/src/wg/cosmo/node/v1/node_pb';
```

### 2. Extend Output Initialization

In `configurationDatasToDataSourceConfiguration()`, add the 4 new arrays to the output object:

```ts
const output: DataSourceConfiguration = {
  rootNodes: [],
  childNodes: [],
  keys: [],
  provides: [],
  events: new DataSourceCustomEvents({ nats: [], kafka: [], redis: [] }),
  requires: [],
  entityInterfaces: [],
  interfaceObjects: [],
  // New: entity caching config arrays
  entityCacheConfigurations: [],
  rootFieldCacheConfigurations: [],
  cachePopulateConfigurations: [],
  cacheInvalidateConfigurations: [],
};
```

### 3. Add Conversion Logic

After the existing field population loop (which iterates over `dataByTypeName`), add cache configuration conversion:

```ts
// Inside the for loop over dataByTypeName entries:
if (data.entityCacheConfigurations) {
  for (const ec of data.entityCacheConfigurations) {
    output.entityCacheConfigurations.push(
      new EntityCacheConfiguration({
        typeName: ec.typeName,
        maxAgeSeconds: BigInt(ec.maxAgeSeconds),
        includeHeaders: ec.includeHeaders,
        partialCacheLoad: ec.partialCacheLoad,
        shadowMode: ec.shadowMode,
      }),
    );
  }
}

if (data.rootFieldCacheConfigurations) {
  for (const rfc of data.rootFieldCacheConfigurations) {
    output.rootFieldCacheConfigurations.push(
      new RootFieldCacheConfiguration({
        fieldName: rfc.fieldName,
        maxAgeSeconds: BigInt(rfc.maxAgeSeconds),
        includeHeaders: rfc.includeHeaders,
        shadowMode: rfc.shadowMode,
        entityTypeName: rfc.entityTypeName,
        entityKeyMappings: rfc.entityKeyMappings.map(
          (m) => new EntityKeyMapping({
            entityTypeName: m.entityTypeName,
            fieldMappings: m.fieldMappings.map(
              (fm) => new FieldMapping({
                entityKeyField: fm.entityKeyField,
                argumentPath: fm.argumentPath,
              }),
            ),
          }),
        ),
      }),
    );
  }
}

if (data.cachePopulateConfigurations) {
  for (const cp of data.cachePopulateConfigurations) {
    output.cachePopulateConfigurations.push(
      new CachePopulateConfiguration({
        fieldName: cp.fieldName,
        operationType: cp.operationType,
        maxAgeSeconds: cp.maxAgeSeconds != null ? BigInt(cp.maxAgeSeconds) : undefined,
      }),
    );
  }
}

if (data.cacheInvalidateConfigurations) {
  for (const ci of data.cacheInvalidateConfigurations) {
    output.cacheInvalidateConfigurations.push(
      new CacheInvalidateConfiguration({
        fieldName: ci.fieldName,
        operationType: ci.operationType,
        entityTypeName: ci.entityTypeName,
      }),
    );
  }
}
```

### 4. Proto Field Type Notes

- `maxAgeSeconds` is `int64` in proto → `BigInt` in TypeScript proto bindings
- `CachePopulateConfiguration.maxAgeSeconds` is `optional int64` → generates a pointer field, use `undefined` for unset
- `FieldMapping.argumentPath` is `repeated string` → array of strings in TypeScript (e.g., `["input", "userId"]` for nested args, `["id"]` for simple args)
- All other fields are standard proto3 scalars (string, bool)

## Data Flow

```
Subgraph SDL
    ↓ (Task 02: registration)
NormalizationFactory
    ↓ (Task 05: validation + extraction)
ConfigurationData.entityCacheConfigurations[]  ← composition types
    ↓ (Task 06: THIS TASK)
DataSourceConfiguration.entity_cache_configurations[]  ← proto types
    ↓ (JSON serialization)
Router execution config JSON
    ↓ (Go proto deserialization)
nodev1.DataSourceConfiguration (Go struct)
    ↓ (Tasks 07-08: router wiring)
Engine SubgraphCachingConfig
```

## Expected Output Format

After this task, the router execution config JSON includes cache configs per datasource:

```json
{
  "datasource_configurations": [{
    "id": "subgraph-accounts",
    "kind": "GRAPHQL",
    "entity_cache_configurations": [
      {
        "type_name": "User",
        "max_age_seconds": 300,
        "include_headers": false,
        "partial_cache_load": false,
        "shadow_mode": false
      }
    ],
    "root_field_cache_configurations": [
      {
        "field_name": "user",
        "max_age_seconds": 300,
        "include_headers": false,
        "shadow_mode": false,
        "entity_type_name": "User",
        "entity_key_mappings": [
          {
            "entity_type_name": "User",
            "field_mappings": [
              {"entity_key_field": "id", "argument_path": ["id"]}
            ]
          }
        ]
      }
    ],
    "cache_populate_configurations": [],
    "cache_invalidate_configurations": [
      {
        "field_name": "updateUser",
        "operation_type": "Mutation",
        "entity_type_name": "User"
      }
    ]
  }]
}
```

## Verification

1. **Compilation**: `npx tsc --noEmit` in both `composition/` and `shared/` — zero errors
2. **Existing tests pass**: Run shared package test suite — no regressions
3. **Round-trip test**: Compose a subgraph with all 5 directives → verify the output JSON contains all 4 cache config arrays with correct values
4. **Proto compatibility**: Verify the JSON field names match the proto field names (snake_case)
5. **BigInt handling**: Verify `maxAgeSeconds` values serialize correctly as int64

## Out of Scope

- Proto definition (Task 01)
- Directive registration (Task 02)
- Validation rules and extraction logic (Task 05)
- Router-side deserialization and wiring (Tasks 07-09)
