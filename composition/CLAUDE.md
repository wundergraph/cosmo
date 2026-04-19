# CLAUDE.md — Composition Library

Focus of this doc: entity caching, `@key` internals, and the composition→router
pipeline details.
For general code style, naming, test, review, and process conventions, see
[COMPOSITION_CONVENTIONS.md](./COMPOSITION_CONVENTIONS.md).
For the public API surface, see [README.md](./README.md).
For the high-level pipeline walkthrough, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For entity-caching invariants specifically, see [AGENTS.md](./AGENTS.md).

## What This Is

The composition library normalizes and validates GraphQL subgraph schemas for federated composition. It takes individual subgraph SDL documents, validates them against federation rules, and produces `ConfigurationData` objects consumed by the Cosmo router.

## Key Architecture

### Entry Points

- **`batchNormalize({ subgraphs, options })`** — Main entry. Iterates subgraphs, calls `normalizeSubgraph()` on each, aggregates entity data across subgraphs.
- **`normalize(document)`** — Single-subgraph normalization.

### Core File: `src/v1/normalization/normalization-factory.ts`

~4,900 lines. The `NormalizationFactory` class holds all state for a normalization pass. Key properties:

| Property | Type | Purpose |
|----------|------|---------|
| `parentDefinitionDataByTypeName` | `Map<string, ParentDefinitionData>` | Central type registry — all objects, interfaces, scalars, enums, unions, input objects |
| `keyFieldSetDatasByTypeName` | `Map<TypeName, Map<normalizedFieldSet, KeyFieldSetData>>` | Entity type → (normalized field set string → parsed key metadata) |
| `keyFieldNamesByParentTypeName` | `Map<TypeName, Set<FieldName>>` | Entity type → top-level field names participating in any @key |
| `entityCacheConfigByTypeName` | `Map<TypeName, {...}>` | @openfed__entityCache directives (lookup during cache validation) |
| `configurationDataByTypeName` | `Map<TypeName, ConfigurationData>` | Final router configuration output |

### Normalization Pipeline

1. **AST Walking** (`walkers.ts`) — Extract schema definitions, type definitions, directives
2. **Key Extraction** (`extractKeyFieldSets()`) — Parse @key directives into `KeyFieldSetData`
3. **Key Validation** (`validateKeyFieldSets()` in `utils.ts`) — Validate field existence, types, no arguments
4. **External Key Evaluation** (`evaluateExternalKeyFields()`) — Validate @external key fields
5. **Entity Cache Validation** (`validateAndExtractEntityCachingConfigs()`) — Three-phase cache directive processing
6. **Configuration Output** — Attach validated configs to `ConfigurationData`

## @key Directive — How Keys Work

### Data Structures

```typescript
// src/v1/normalization/types.ts
type KeyFieldSetData = {
  documentNode: DocumentNode;     // Parsed GraphQL AST of the selection set
  isUnresolvable: boolean;        // true when @key(resolvable: false)
  normalizedFieldSet: string;     // Canonical form: "id" or "id region" or "store { id }"
  rawFieldSet: string;            // Original string from SDL
};
```

`keyFieldSetDatasByTypeName` is a two-level map: `TypeName → normalizedFieldSet → KeyFieldSetData`. The normalized field set string serves as both the map key and the canonical representation.

### Normalization of Field Sets

Raw `@key(fields: "...")` string → `safeParse('{' + rawFieldSet + '}')` → `DocumentNode` → `getNormalizedFieldSet()` which lexicographically sorts, prints, normalizes whitespace, and strips outer braces.

Examples:
- `"id"` → `"id"`
- `"name id"` → `"id name"` (sorted)
- `"store { id }"` → `"store { id }"`

The `documentNode` preserves the full nested AST structure. The `normalizedFieldSet` string is a flattened canonical representation.

### Key Shapes

| Shape | Example | How It's Stored |
|-------|---------|-----------------|
| Single field | `@key(fields: "id")` | normalizedFieldSet: `"id"` |
| Composite | `@key(fields: "id region")` | normalizedFieldSet: `"id region"` |
| Nested | `@key(fields: "store { id }")` | normalizedFieldSet: `"store { id }"` |
| Deep nested | `@key(fields: "a { b { c } }")` | normalizedFieldSet: `"a { b { c } }"` |
| Mixed | `@key(fields: "id store { id }")` | normalizedFieldSet: `"id store { id }"` |
| Unresolvable | `@key(fields: "id", resolvable: false)` | isUnresolvable: true |

### Key Validation Rules (in `utils.ts:validateKeyFieldSets`)

- All fields in selection set must exist on the type
- No arguments on key fields
- No duplicate fields within a single key
- Nested selections must be on OBJECT types (not INTERFACE/UNION)
- Leaf fields must be scalars
- No inline fragments

### Router Configuration Output

Each validated @key becomes a `RequiredFieldConfiguration`:
```typescript
{ fieldName: "", selectionSet: "id", disableEntityResolver?: true }
```

Stored in `configurationData.keys` array — one entry per @key directive.

## Entity Caching — Current State and Known Limitations

### Directive Hierarchy

```
@openfed__entityCache(maxAge: Int!)          → on OBJECT types (entities with @key)
@openfed__queryCache(maxAge: Int!)           → on Query fields returning cached entities
@openfed__cachePopulate(maxAge?: Int)        → on Mutation/Subscription fields
@openfed__cacheInvalidate                    → on Mutation/Subscription fields
@openfed__is(fields: String!)                 → on argument definitions (maps arg → key field)
```

### Cache Validation (`validateAndExtractEntityCachingConfigs`)

The entry method delegates to two helpers:

- `extractEntityCacheDirectives` — reads @openfed__entityCache off object types.
  Must run first because the root-field helpers look entity types up in `entityCacheConfigByTypeName`.
- `processRootFieldCacheDirectives` — walks root types (Query/Mutation/Subscription) and dispatches
  to `extractQueryCacheConfig`, `extractCacheInvalidateConfig`, `extractCachePopulateConfig`, and
  `validateIsDirectivePlacement` per field.

Configs attach directly to `ConfigurationData` keyed by the iteration's `parentTypeName` so renamed
root types (e.g., `schema { query: MyQuery }`) survive through to the router.

Validation behavior is encoded in `tests/v1/directives/entity-caching.test.ts` and
`tests/v1/directives/entity-cache-mapping-rules.test.ts`.

### Key Mapping Pipeline (`buildArgumentKeyMappings`)

The `buildArgumentKeyMappings` method implements type-aware argument-to-key mapping.
Behavior is encoded in `tests/v1/directives/entity-cache-mapping-rules.test.ts`.

**Per-key independent evaluation:**
Each `@key` directive is evaluated independently.
For `@key(fields: "id") @key(fields: "sku region")`,
the pipeline attempts argument mapping against each key separately.
ALL fully-satisfiable keys are emitted as separate `EntityKeyMappingConfig` entries.

**Type checking:**
- Auto-mapping compares named types (unwrapping NonNull).
  Mismatch → warning, mapping skipped.
- Explicit `@openfed__is` compares strictly.
  Mismatch → error.
- Nullability differences are ignored (nullable arg can map to non-null key).

**Nested key paths:**
`@key(fields: "store { id }")` produces path `"store.id"`.
`@openfed__is(fields: "store.id")` maps an argument to that path.
Type checking resolves the leaf field type from the entity's AST.

**Input object decomposition:**
`@openfed__is(fields: "id sku")` with an input object argument decomposes into
per-field mappings: `argumentPath: ["key", "id"]`, `argumentPath: ["key", "sku"]`.
Nested input objects map recursively to nested key structures.

**Batch / list detection:**
List-returning fields with list arguments produce `isBatch: true` on `FieldMappingConfig`.
Multiple list arguments on the same field are rejected.

**Extra non-key argument detection:**
Arguments not mapped to any key field → error for explicit `@openfed__is`, warning for auto-mapping.
All mappings for that key are discarded (cache key would be incomplete).

### @openfed__is Directive

`@openfed__is(fields: String!)` — note the argument name is `fields` (plural), matching the `FIELDS` constant.
The `IS_DEFINITION` in `directive-definitions.ts` and `IS_DEFINITION_DATA` in `directive-definition-data.ts`
must both use `FIELDS`.
The `buildArgumentKeyMappingsV2` reads `arg.name.value === FIELDS` to extract @openfed__is values.

**Gotcha**: A previous bug used `FIELD` (singular) instead of `FIELDS` (plural),
silently breaking all @openfed__is extraction.
Always verify the constant name matches the directive definition.

### @openfed__requestScoped Directive

`@openfed__requestScoped(key: String!)` on `FIELD_DEFINITION` — single mandatory argument.
Extracted by `extractRequestScopedFields()` in `normalization-factory.ts`.
Produces `RequestScopedFieldConfig` on the datasource's `ConfigurationData`.

**Symmetric semantics**: there is no receiver/provider distinction. Every field
annotated with `@openfed__requestScoped(key: "X")` in the same subgraph shares the same L1
entry under `l1Key = "{subgraphName}.X"`. Whichever field resolves first populates
L1; subsequent fields with the same key inject from L1 and may skip their fetch.

**Validation**:
- `key` is mandatory (enforced by `REQUEST_SCOPED_DEFINITION_DATA.requiredArgumentNames`)
- Composition emits a `requestScopedSingleFieldWarning` when a key is used on only
  one field in the subgraph — the directive is meaningless without a second reader

### Pipeline: Composition → Router

Changes to `FieldMappingConfig` (like adding `isBatch`) must be wired through:
1. `composition/src/router-configuration/types.ts` — TypeScript type
2. `proto/wg/cosmo/node/v1/node.proto` — Protobuf message
3. `connect/src/wg/cosmo/node/v1/node_pb.ts` — Generated TS proto class
4. `shared/src/router-config/graphql-configuration.ts` — Proto serialization
5. `router/core/factoryresolver.go` — Go plan mapping
6. `composition-go/generate.sh` — Rebuild JS bundle

Missing any step causes the field to silently drop from the config JSON.
Debug path: if a field is correct in composition output but missing in the final `config.json`,
check shared package serialization first.

### Router-Tests Config Regeneration

The `router-tests/entity_caching/testdata/config.json` is generated by a Go tool using the
composition-go bundle:
```
cd router-tests/entity_caching && make compose
```

This reads subgraph schemas from `subgraphs/*/subgraph/schema.graphqls` and writes the config
via `composition.BuildRouterConfiguration`. After changing shared/composition code, you must:
1. Rebuild composition: `cd composition && pnpm build`
2. Rebuild shared: `cd shared && pnpm build`
3. Regenerate composition-go bundle: `cd composition-go && bash generate.sh`
4. Regenerate router-tests config: `cd router-tests/entity_caching && make compose`

### Playground Integration

The playground is embedded in the router binary via `//go:embed graphiql.html`.
To update it:
```
cd playground && pnpm build:router
```

This builds a single-file HTML bundle and copies it to `router/internal/graphiql/graphiql.html`.
Then restart the router to pick up the new playground.

The playground exposes a per-request cache control dropdown (enabled / L2-only / L1-only / disabled)
that injects `X-WG-Disable-Entity-Cache*` headers transparently via a ref (not the fetcher dep array)
to avoid re-creating the fetcher and resetting the response state on mode change.

## File Map

| File | Purpose |
|------|---------|
| `src/v1/normalization/normalization-factory.ts` | Main normalization class (~4900 lines) |
| `src/v1/normalization/walkers.ts` | AST visitor entry points |
| `src/v1/normalization/utils.ts` | `validateKeyFieldSets()` and field set validation |
| `src/v1/normalization/types.ts` | `KeyFieldSetData`, `FieldSetData`, etc. |
| `src/v1/constants/directive-definitions.ts` | Directive AST definitions (@key, @openfed__entityCache, @openfed__queryCache, @openfed__is, etc.) |
| `src/router-configuration/types.ts` | Output types: `ConfigurationData`, `EntityCacheConfig`, `FieldMappingConfig`, etc. |
| `src/errors/errors.ts` | Error message factories |
| `src/v1/warnings/warnings.ts` | Warning message factories |
| `src/utils/string-constants.ts` | Shared string constants (KEY, ENTITY_CACHE, QUERY_CACHE, IS, etc.) |
| `tests/v1/directives/entity-caching.test.ts` | Entity caching tests (45 tests) |
| `tests/v1/directives/entity-cache-mapping-rules.test.ts` | Type-aware mapping rules (76 tests) |
| `tests/v1/entities.test.ts` | Entity and @key tests (~1945 lines) |
| `tests/v1/directives/fieldset-directives.test.ts` | @key field set validation tests |

## Test Patterns and Commands

Moved to [COMPOSITION_CONVENTIONS.md §6 (Tests)](./COMPOSITION_CONVENTIONS.md#6-tests)
and [§9 (Build, lint, format)](./COMPOSITION_CONVENTIONS.md#9-build-lint-format).
The top-level [CLAUDE.md](../CLAUDE.md) commands cheatsheet also covers the
cross-package workflow (composition + shared + composition-go + router-tests).
