# Task 02: Composition Directive Registration

## Objective

Register 5 new entity caching directives in the composition TypeScript package so that the composition pipeline recognizes them in subgraph schemas. This task covers only directive registration (string constants, AST definition nodes, directive definition data, and map registration). It does not cover validation rules, config extraction, or serialization — those are subsequent tasks.

The 5 directives:

| Directive | Signature | Location |
|-----------|-----------|----------|
| `@entityCache` | `(maxAge: Int!, includeHeaders: Boolean = false, partialCacheLoad: Boolean = false, shadowMode: Boolean = false)` | OBJECT |
| `@queryCache` | `(maxAge: Int!, includeHeaders: Boolean = false, shadowMode: Boolean = false)` | FIELD_DEFINITION |
| `@is` | `(field: String!)` | ARGUMENT_DEFINITION |
| `@cacheInvalidate` | (no args) | FIELD_DEFINITION |
| `@cachePopulate` | `(maxAge: Int)` | FIELD_DEFINITION |

All are `repeatable: false`.

## Dependencies

None. This task has no external dependencies.

## Reference Pattern: `@authenticated`

The `@authenticated` directive follows a 6-file registration pattern:

1. **String constant** (`string-constants.ts`, line 8): `export const AUTHENTICATED = 'authenticated';`
2. **AST node** (`directive-definitions.ts`, lines 84-95): `AUTHENTICATED_DEFINITION`
3. **Directive data** (`directive-definition-data.ts`, lines 115-123): `AUTHENTICATED_DEFINITION_DATA`
4. **Map 1** (`constants.ts`, line 79): `[AUTHENTICATED, AUTHENTICATED_DEFINITION]`
5. **Map 2** (`constants.ts`, line 129): Same entry in V2 map
6. **Init** (`utils.ts`, line 427): `[AUTHENTICATED, AUTHENTICATED_DEFINITION_DATA]`

---

## Files to Modify

### File 1: `composition/src/utils/string-constants.ts`

Add 9 new string constants — 5 directive names and 4 argument names (insert alphabetically):

```ts
export const CACHE_INVALIDATE = 'cacheInvalidate';
export const CACHE_POPULATE = 'cachePopulate';
export const ENTITY_CACHE = 'entityCache';
export const INCLUDE_HEADERS = 'includeHeaders';
export const IS = 'is';
export const MAX_AGE = 'maxAge';
export const PARTIAL_CACHE_LOAD = 'partialCacheLoad';
export const QUERY_CACHE = 'queryCache';
export const SHADOW_MODE = 'shadowMode';
```

**Note**: `FIELD` (line 51), `BOOLEAN_SCALAR` (line 10), `INT_SCALAR` (line 76), and `STRING_SCALAR` (line 142) already exist and will be reused.

### File 2: `composition/src/v1/constants/type-nodes.ts`

Add `REQUIRED_INT_TYPE_NODE` for `maxAge: Int!`:

```ts
import { FIELD_SET_SCALAR, INT_SCALAR, STRING_SCALAR } from '../../utils/string-constants';

export const REQUIRED_INT_TYPE_NODE: TypeNode = {
  kind: Kind.NON_NULL_TYPE,
  type: stringToNamedTypeNode(INT_SCALAR),
};
```

### File 3: `composition/src/v1/constants/directive-definitions.ts`

Add 5 `DirectiveDefinitionNode` exports. Update imports to include all new string constants and `REQUIRED_INT_TYPE_NODE`.

#### `@cacheInvalidate` (no args, on FIELD_DEFINITION)

```ts
export const CACHE_INVALIDATE_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
  name: stringToNameNode(CACHE_INVALIDATE),
  repeatable: false,
};
```

#### `@cachePopulate` (1 optional arg, on FIELD_DEFINITION)

```ts
export const CACHE_POPULATE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(MAX_AGE),
      type: stringToNamedTypeNode(INT_SCALAR),
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
  name: stringToNameNode(CACHE_POPULATE),
  repeatable: false,
};
```

#### `@entityCache` (4 args, on OBJECT)

```ts
export const ENTITY_CACHE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(MAX_AGE),
      type: REQUIRED_INT_TYPE_NODE,
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(INCLUDE_HEADERS),
      type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      defaultValue: { kind: Kind.BOOLEAN, value: false },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PARTIAL_CACHE_LOAD),
      type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      defaultValue: { kind: Kind.BOOLEAN, value: false },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SHADOW_MODE),
      type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      defaultValue: { kind: Kind.BOOLEAN, value: false },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([OBJECT_UPPER]),
  name: stringToNameNode(ENTITY_CACHE),
  repeatable: false,
};
```

#### `@is` (1 required arg, on ARGUMENT_DEFINITION)

```ts
export const IS_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELD),
      type: REQUIRED_STRING_TYPE_NODE,
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([ARGUMENT_DEFINITION_UPPER]),
  name: stringToNameNode(IS),
  repeatable: false,
};
```

#### `@queryCache` (3 args, on FIELD_DEFINITION)

```ts
export const QUERY_CACHE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(MAX_AGE),
      type: REQUIRED_INT_TYPE_NODE,
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(INCLUDE_HEADERS),
      type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      defaultValue: { kind: Kind.BOOLEAN, value: false },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SHADOW_MODE),
      type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      defaultValue: { kind: Kind.BOOLEAN, value: false },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
  name: stringToNameNode(QUERY_CACHE),
  repeatable: false,
};
```

### File 4: `composition/src/v1/normalization/directive-definition-data.ts`

Add 5 `DirectiveDefinitionData` constants. Each maps argument names to types, sets required/optional argument sets, and references the AST node from File 3.

#### `CACHE_INVALIDATE_DEFINITION_DATA`

```ts
export const CACHE_INVALIDATE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByName: new Map<string, ArgumentData>([]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: CACHE_INVALIDATE,
  node: CACHE_INVALIDATE_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};
```

#### `CACHE_POPULATE_DEFINITION_DATA`

```ts
export const CACHE_POPULATE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByName: new Map<string, ArgumentData>([
    [MAX_AGE, { name: MAX_AGE, typeNode: stringToNamedTypeNode(INT_SCALAR) }],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: CACHE_POPULATE,
  node: CACHE_POPULATE_DEFINITION,
  optionalArgumentNames: new Set<string>([MAX_AGE]),
  requiredArgumentNames: new Set<string>(),
};
```

#### `ENTITY_CACHE_DEFINITION_DATA`

```ts
export const ENTITY_CACHE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByName: new Map<string, ArgumentData>([
    [MAX_AGE, { name: MAX_AGE, typeNode: REQUIRED_INT_TYPE_NODE }],
    [INCLUDE_HEADERS, { name: INCLUDE_HEADERS, typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR), defaultValue: { kind: Kind.BOOLEAN, value: false } }],
    [PARTIAL_CACHE_LOAD, { name: PARTIAL_CACHE_LOAD, typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR), defaultValue: { kind: Kind.BOOLEAN, value: false } }],
    [SHADOW_MODE, { name: SHADOW_MODE, typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR), defaultValue: { kind: Kind.BOOLEAN, value: false } }],
  ]),
  isRepeatable: false,
  locations: new Set<string>([OBJECT_UPPER]),
  name: ENTITY_CACHE,
  node: ENTITY_CACHE_DEFINITION,
  optionalArgumentNames: new Set<string>([INCLUDE_HEADERS, PARTIAL_CACHE_LOAD, SHADOW_MODE]),
  requiredArgumentNames: new Set<string>([MAX_AGE]),
};
```

#### `IS_DEFINITION_DATA`

```ts
export const IS_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByName: new Map<string, ArgumentData>([
    [FIELD, { name: FIELD, typeNode: REQUIRED_STRING_TYPE_NODE }],
  ]),
  isRepeatable: false,
  locations: new Set<string>([ARGUMENT_DEFINITION_UPPER]),
  name: IS,
  node: IS_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([FIELD]),
};
```

#### `QUERY_CACHE_DEFINITION_DATA`

```ts
export const QUERY_CACHE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByName: new Map<string, ArgumentData>([
    [MAX_AGE, { name: MAX_AGE, typeNode: REQUIRED_INT_TYPE_NODE }],
    [INCLUDE_HEADERS, { name: INCLUDE_HEADERS, typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR), defaultValue: { kind: Kind.BOOLEAN, value: false } }],
    [SHADOW_MODE, { name: SHADOW_MODE, typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR), defaultValue: { kind: Kind.BOOLEAN, value: false } }],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: QUERY_CACHE,
  node: QUERY_CACHE_DEFINITION,
  optionalArgumentNames: new Set<string>([INCLUDE_HEADERS, SHADOW_MODE]),
  requiredArgumentNames: new Set<string>([MAX_AGE]),
};
```

### File 5: `composition/src/v1/constants/constants.ts`

Register in both `DIRECTIVE_DEFINITION_BY_NAME` (line 75) and `V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME` (line 123):

```ts
[CACHE_INVALIDATE, CACHE_INVALIDATE_DEFINITION],
[CACHE_POPULATE, CACHE_POPULATE_DEFINITION],
[ENTITY_CACHE, ENTITY_CACHE_DEFINITION],
[IS, IS_DEFINITION],
[QUERY_CACHE, QUERY_CACHE_DEFINITION],
```

### File 6: `composition/src/v1/normalization/utils.ts`

Register in `initializeDirectiveDefinitionDatas()` (line 425):

```ts
[CACHE_INVALIDATE, CACHE_INVALIDATE_DEFINITION_DATA],
[CACHE_POPULATE, CACHE_POPULATE_DEFINITION_DATA],
[ENTITY_CACHE, ENTITY_CACHE_DEFINITION_DATA],
[IS, IS_DEFINITION_DATA],
[QUERY_CACHE, QUERY_CACHE_DEFINITION_DATA],
```

---

## Verification

1. **Compilation**: `npx tsc --noEmit` in `composition/` — zero errors
2. **Existing tests pass**: Run composition test suite — no regressions
3. **Directive recognition**: A subgraph schema with `@entityCache(maxAge: 300)` on a type normalizes without "unknown directive" errors

## Not in Scope

- Validation rules (Task 05)
- Config extraction and argument-to-key mapping (Task 05)
- Proto serialization (Task 06)
- Router-side config or wiring (Tasks 07-09)
