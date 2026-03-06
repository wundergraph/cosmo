# Task 05: Composition Validation + Extraction Logic

## Objective

Implement the 20 validation rules from ENTITY_CACHING_DIRECTIVES.md in the composition normalization pipeline, plus the extraction logic that produces cache configuration data for each subgraph's `DataSourceConfiguration`. This includes the `@queryCache` argument-to-key mapping algorithm and `@is` directive resolution.

## Scope

- Add validation handlers for all 5 entity caching directives
- Implement all 20 validation rules with precise error messages
- Extract cache configuration data during normalization
- Implement argument-to-`@key` field auto-mapping for `@queryCache` (non-list returns only)
- Resolve `@is` directives to produce `EntityKeyMapping`/`FieldMapping` entries
- Determine `cacheReadEnabled` based on mapping completeness (incomplete = write-only with warning)
- Store extracted cache configs in `ConfigurationData` for downstream serialization

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 02 | Directive registration (string constants, AST definitions, directive data, map entries) |

## Files to Modify

### File 1: `composition/src/v1/normalization/normalization-factory.ts`

This is the primary file. The normalization factory (~4,067 lines) processes subgraph schemas during composition. All directive validation and extraction happens here.

**Pattern to follow**: The `@authenticated` / `@requiresScopes` pattern:
- `validateDirective()` (lines 628-753) — entry point for all directive validation
- `handleAuthenticatedDirective()` (lines 2227-2242) — directive-specific handler
- `extractRequiredScopes()` (lines 2317-2345) — argument extraction

**New properties on the factory class:**

```ts
// Cache configuration storage (parallel to authorizationDataByParentTypeName)
private entityCacheConfigByTypeName = new Map<string, EntityCacheConfig>();
private rootFieldCacheConfigs: RootFieldCacheConfig[] = [];
private cachePopulateConfigs: CachePopulateConfig[] = [];
private cacheInvalidateConfigs: CacheInvalidateConfig[] = [];
```

### File 2: `composition/src/router-configuration/types.ts`

Add cache configuration types to the `ConfigurationData` type:

```ts
export type ConfigurationData = {
  // ... existing fields ...
  entityCacheConfigurations?: EntityCacheConfig[];
  rootFieldCacheConfigurations?: RootFieldCacheConfig[];
  cachePopulateConfigurations?: CachePopulateConfig[];
  cacheInvalidateConfigurations?: CacheInvalidateConfig[];
};

export type EntityCacheConfig = {
  typeName: string;
  maxAgeSeconds: number;
  includeHeaders: boolean;
  partialCacheLoad: boolean;
  shadowMode: boolean;
};

export type RootFieldCacheConfig = {
  fieldName: string;
  maxAgeSeconds: number;
  includeHeaders: boolean;
  shadowMode: boolean;
  entityTypeName: string;
  cacheReadEnabled: boolean; // false if key mapping is incomplete (write-only mode)
  entityKeyMappings: EntityKeyMappingConfig[];
};

export type EntityKeyMappingConfig = {
  entityTypeName: string;
  fieldMappings: FieldMappingConfig[];
};

export type FieldMappingConfig = {
  entityKeyField: string;
  argumentPath: string[]; // e.g., ["id"] or ["input", "userId"] for nested args
};

export type CachePopulateConfig = {
  fieldName: string;
  operationType: string; // "Mutation" or "Subscription"
  maxAgeSeconds?: number;
};

export type CacheInvalidateConfig = {
  fieldName: string;
  operationType: string; // "Mutation" or "Subscription"
  entityTypeName: string;
};
```

### File 3: `composition/src/errors/errors.ts`

Add error message functions for all 20 validation rules. Follow the existing pattern:

```ts
export function entityCacheWithoutKeyError(typeName: string): string {
  return `Type '${typeName}' has @entityCache but no @key directive.`;
}

export function queryCacheOnNonQueryFieldError(fieldCoords: string, parentType: string): string {
  return `@queryCache is only valid on Query fields, found on ${parentType}.${fieldCoords}.`;
}
// ... etc for all 20 rules
```

## Validation Rules Implementation

### `@entityCache` Rules (1-3)

**Rule 1**: Must be on a type with `@key`.
- Check: During object type processing, if `@entityCache` is present but no `@key` directive → error
- Error: `"Type 'X' has @entityCache but no @key directive."`

**Rule 2**: At most one per type.
- Check: Count `@entityCache` directives on the type
- Error: `"Type 'X' has multiple @entityCache directives."`

**Rule 3**: `maxAge` must be a positive integer.
- Check: Validate the `maxAge` argument value > 0
- Error: `"@entityCache maxAge must be a positive integer, got 'N'."`

### `@queryCache` Rules (4-9)

**Rule 4**: Only on fields of root `Query` type.
- Check: Parent type name must be `"Query"`
- Error: `"@queryCache is only valid on Query fields, found on Mutation.X / Subscription.X."`

**Rule 5**: Return type must be an entity (type with `@key`), or a list of entities.
- Check: Unwrap NonNull/List wrappers, verify the named type has `@key`
- Error: `"Field 'Query.X' has @queryCache but returns non-entity type 'Y'. @queryCache requires the return type to be an entity with @key."`

**Rule 6**: The return entity type must have `@entityCache`.
- Check: Look up the return entity in `entityCacheConfigByTypeName`
- Error: `"Field 'Query.X' returns entity type 'Y' which does not have @entityCache."`

**Rule 7**: When returning a single (non-list) entity with incomplete key mapping → **warning** (not error).
- Check: Run the argument-to-key mapping algorithm (see below); if any `@key` field is unmapped → emit warning
- Warning: `"Field 'Query.X' has @queryCache returning 'Y' but @key field 'Z' cannot be mapped to any argument. Cache reads are disabled for this field (cache writes/population still work). Add an argument named 'Z' or use @is(field: \"Z\") to enable cache reads."`
- **Behavior**: Incomplete mapping means the field operates in **write-only mode** — entities from responses are still cached (populated), but queries cannot read from the cache for this field because the cache key can't be constructed from arguments alone. This is a valid use case.

**Rule 8**: ~~When returning a list of entities, same mapping requirement as rule 7.~~ **Removed** — list returns do NOT require argument-to-key mapping. For list returns like `topProducts(first: Int): [Product!]!`, entity keys are extracted per-entity from the response data. The arguments (e.g., `first`) are NOT used to build cache keys. No mapping validation is needed.

**Rule 9**: `maxAge` must be a positive integer.

### `@is` Rules (10-13)

**Rule 10**: Only on arguments of fields that have `@queryCache`.
- Check: If `@is` is on an argument but the field lacks `@queryCache` → error
- Error: `"@is on argument 'X' of field 'Query.Y' has no effect without @queryCache."`

**Rule 11**: The `field` value must reference a `@key` field on the return entity type.
- Check: Parse the entity's `@key(fields: ...)` selection set, verify the `@is(field)` value matches one of those fields
- Error: `"@is(field: \"X\") on argument 'Y' of field 'Query.Z' references unknown @key field 'X' on type 'W'."`

**Rule 12**: No duplicate mappings — two arguments must not map to the same `@key` field.
- Check: After building all mappings, check for duplicate `entityKeyField` values
- Error: `"Multiple arguments on field 'Query.X' map to @key field 'Y'."`

**Rule 13**: An argument must not have `@is` if its name already matches a `@key` field.
- Check: If argument name matches a `@key` field AND has `@is` → error
- Error: `"Argument 'X' on field 'Query.Y' already matches @key field 'X' by name — @is is redundant."`

### `@cacheInvalidate` Rules (14-16)

**Rule 14**: Only on fields of root `Mutation` or `Subscription` type.
- Error: `"@cacheInvalidate is only valid on Mutation or Subscription fields."`

**Rule 15**: Return type must be an entity with `@key` and `@entityCache`.
- Error: `"Field 'Mutation.X' has @cacheInvalidate but returns non-entity type 'Y'."`

**Rule 16**: Mutually exclusive with `@cachePopulate`.
- Error: `"Field 'Mutation.X' has both @cacheInvalidate and @cachePopulate. A field must use one or the other, not both."`

### `@cachePopulate` Rules (17-20)

**Rule 17**: Only on fields of root `Mutation` or `Subscription` type.
- Error: `"@cachePopulate is only valid on Mutation or Subscription fields."`

**Rule 18**: Return type must be an entity with `@key` and `@entityCache`.
- Error: `"Field 'Subscription.X' has @cachePopulate but returns non-entity type 'Y'."`

**Rule 19**: Mutually exclusive with `@cacheInvalidate`. (Same error as rule 16.)

**Rule 20**: If `maxAge` is provided, must be a positive integer.

## Argument-to-Key Mapping Algorithm

For `@queryCache` fields returning a **non-list entity**, the mapping algorithm runs after all types are processed:

```
Input: field arguments[], return entity's @key fields[], isListReturn: boolean
Output: { mappings: EntityKeyMapping[], cacheReadEnabled: boolean }

1. If isListReturn: skip mapping entirely → return { mappings: [], cacheReadEnabled: false }
   (List returns always use per-entity key extraction from response data)

2. Parse entity's @key(fields: "...") → keyFields: string[]
3. For each argument on the field:
   a. If argument has @is(field: "X"):
      - Validate X is in keyFields (Rule 11)
      - Validate argument name != X (Rule 13 - redundant @is)
      - Add mapping: { entityKeyField: X, argumentPath: [arg.name] }
   b. Else if argument name is in keyFields:
      - Add mapping: { entityKeyField: arg.name, argumentPath: [arg.name] }
4. Check for duplicate entityKeyField values (Rule 12)
5. If NOT all keyFields are covered:
   - Emit warning (Rule 7) — cache reads disabled, writes still work
   - return { mappings, cacheReadEnabled: false }
6. return { mappings, cacheReadEnabled: true }
```

**Special cases:**
- **No-argument fields** (e.g., `me: User`): No mapping needed. Uses root field cache key format. Cache reads still work (key is just the field identity).
- **List return** (e.g., `topProducts(first: Int): [Product!]!`): No mapping needed. Entity keys are extracted per-entity from the response. Cache reads use `_entities` key format, not argument-based keys.
- **Incomplete mapping** (e.g., `user(name: String): User` where `@key(fields: "id")`): Cache population (writes) still work because `id` is in the response. Cache reads are disabled because `id` can't be derived from arguments. User gets a warning.

## Extraction Logic

After validation passes, extract cache configurations and attach them to `ConfigurationData`:

### `@entityCache` Extraction

During object type processing:
```ts
if (hasEntityCacheDirective) {
  const config: EntityCacheConfig = {
    typeName: typeName,
    maxAgeSeconds: maxAgeArg.value,
    includeHeaders: includeHeadersArg?.value ?? false,
    partialCacheLoad: partialCacheLoadArg?.value ?? false,
    shadowMode: shadowModeArg?.value ?? false,
  };
  this.entityCacheConfigByTypeName.set(typeName, config);
}
```

### `@queryCache` Extraction

During field processing on Query type:
```ts
if (hasQueryCacheDirective) {
  const { mappings, cacheReadEnabled } = buildArgumentKeyMappings(
    field.arguments, returnEntityKeyFields, isListReturn,
  );
  const config: RootFieldCacheConfig = {
    fieldName: fieldName,
    maxAgeSeconds: maxAgeArg.value,
    includeHeaders: includeHeadersArg?.value ?? false,
    shadowMode: shadowModeArg?.value ?? false,
    entityTypeName: returnEntityTypeName,
    cacheReadEnabled: cacheReadEnabled,
    entityKeyMappings: mappings,
  };
  this.rootFieldCacheConfigs.push(config);
}
```

### `@cacheInvalidate` / `@cachePopulate` Extraction

During field processing on Mutation/Subscription types:
```ts
if (hasCacheInvalidateDirective) {
  this.cacheInvalidateConfigs.push({
    fieldName: fieldName,
    operationType: parentTypeName, // "Mutation" or "Subscription"
    entityTypeName: returnEntityTypeName,
  });
}
```

### Final Assembly

At the end of normalization, attach extracted configs to the appropriate `ConfigurationData` entries (by type name), so they flow to `configurationDatasToDataSourceConfiguration()` in Task 06.

## Directive Stripping

Like `@authenticated`, caching directives must not appear in the final federated/client schema. They are metadata for the router, not for clients. The existing directive stripping mechanism handles this — registered directives are automatically stripped during schema composition.

## Verification

1. **Compilation**: `npx tsc --noEmit` in `composition/` — zero errors
2. **Existing tests pass**: Run full composition test suite — no regressions
3. **Validation rules**: Write tests for each of the 20 rules:
   - Subgraph with valid `@entityCache` → normalizes successfully
   - Subgraph with `@entityCache` on type without `@key` → returns error with exact message
   - Subgraph with `@queryCache` on Mutation field → returns error
   - Subgraph with `@is` mapping to non-existent `@key` field → returns error
   - Subgraph with both `@cacheInvalidate` and `@cachePopulate` on same field → returns error
   - ... etc for all 20 rules
4. **Extraction**: Verify that after normalization, `ConfigurationData` contains correct cache config arrays
5. **Argument mapping**: Test auto-mapping, `@is` mapping, composite keys, no-argument fields
6. **List returns**: `@queryCache` on list return → no mapping required, no error/warning
7. **Write-only mode**: `@queryCache` on non-list return with incomplete mapping → warning emitted, `cacheReadEnabled: false`
8. **Complete mapping**: `@queryCache` with all `@key` fields mapped → no warning, `cacheReadEnabled: true`

## Out of Scope

- Directive registration (Task 02)
- Proto serialization of extracted data (Task 06)
- Router-side config parsing (Task 04)
- Router wiring (Tasks 07-09)
