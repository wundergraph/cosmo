# COMPOSITION_CONVENTIONS.md — Composition Package

Source-of-truth for how code in `composition/` is expected to look and evolve.
Derived from the last 40 merged PRs touching this package (#1892 → #2648,
May 2025 → Mar 2026) and the review discussions on each.
Newer feedback takes precedence when guidance conflicts.
Older PR numbers are cited where the pattern originated or was first enforced.

Companion docs: [README.md](./README.md) (public contract),
[ARCHITECTURE.md](./ARCHITECTURE.md) (pipeline deep-dive),
[CLAUDE.md](./CLAUDE.md) (entity caching + @key internals),
[AGENTS.md](./AGENTS.md) (entity caching invariants).

## 1. Package layout

```
composition/src/
├── index.ts                      # public exports — minimal, additive
├── buildASTSchema/               # schema construction helpers
├── errors/                       # error factories + typed param interfaces
├── federation/                   # shared federation types (public result shapes)
├── normalization/                # shared normalization types
├── resolvability-graph/          # reachability validation (graph.ts, walker/)
├── router-compatibility-version/ # ROUTER_COMPATIBILITY_VERSION_ONE
├── router-configuration/types.ts # ConfigurationData + cache/field mapping types
├── schema-building/              # build router + client schemas from merged model
├── subgraph/types.ts             # Subgraph, SubgraphConfig, InternalSubgraph
├── types/                        # shared branded/alias types (SubgraphName, ...)
├── utils/                        # string-constants.ts, params.ts, shared helpers
├── v1/                           # router-compatibility-version=1 implementation
│   ├── constants/                # split into dedicated modules (see §3)
│   │   ├── constants.ts
│   │   ├── directive-definitions.ts
│   │   ├── integers.ts
│   │   ├── non-directive-definitions.ts
│   │   ├── strings.ts
│   │   └── type-nodes.ts
│   ├── federation/               # federation-factory.ts + params
│   ├── normalization/            # normalization-factory.ts + walkers + utils
│   ├── schema-building/
│   ├── subgraph/
│   ├── utils/
│   └── warnings/
└── warnings/                     # shared warning types

composition/tests/v1/             # mirrors v1/ layout
├── directives/                   # one file per directive (authorization, entity-caching, ...)
├── types/                        # per-GraphQL-type tests (interfaces, unions, ...)
├── utils/                        # shared test helpers + SDL fragments
└── test-data/
```

**Rules:**

- Router-compatibility-version-scoped code lives under `v1/`.
  Add `v2/` siblings when version 2 work starts.
  Do not mix v1 and v-neutral code in the same module.
- Public types (`FederationResult`, `FederationSuccess`, `FederationFailure`,
  `Subgraph`, `SubgraphConfig`, `ConfigurationData`) live in version-neutral
  directories (`federation/`, `subgraph/`, `router-configuration/`) — they are
  the package's ABI and must stay stable across version implementations.
- When adding a new directive, put its data in `v1/constants/directive-definitions.ts`,
  its string constants in `v1/constants/strings.ts` or `src/utils/string-constants.ts`,
  its extraction logic in `v1/normalization/`, and its tests in a dedicated file
  under `tests/v1/directives/` (PR #2290 #2307 #2348).

## 2. Public API surface

Entry points (see `src/index.ts` and `ARCHITECTURE.md §1`):

- `federateSubgraphs({ subgraphs, version?, options? })`
- `federateSubgraphsWithContracts(...)`
- `federateSubgraphsContract(...)`
- `normalizeSubgraph(...)`
- `batchNormalize({ subgraphs, version })`

**Rules:**

- `federateSubgraphs` takes an **options object**, never positional arguments (PR #2648).
  New flags go on that options object, not as extra positional params.
- When adding an option (e.g. `disableResolvabilityValidation`, `ignoreExternalKeys`),
  wire it through **every** public path — `federateSubgraphs`,
  `federateSubgraphsWithContracts`, `federateSubgraphsContract` — and add a
  direct regression test per path (PR #2595).
- Options construction is duplicated easily between call-sites;
  build the options object **once** in a local constant and reuse (PR #2595).
- `FederationResult` is a discriminated union of `FederationSuccess` and
  `FederationFailure` on `success: true | false`.
  Both share `success` and `warnings`.
- New fields on `FederationSuccess` are allowed when they are **optional**
  (e.g. `schemaNode`, `shouldIncludeClientSchema` — PR #2325 #2330).
- Update `README.md` in the **same PR** as any API-shape change.
  README is part of the public contract, not documentation-after-the-fact (PR #2648).

## 3. Naming and constants

These rules came up repeatedly in review — expect feedback if you break them.

### 3.1 Use typed name aliases, not raw `string`

Prefer the aliases defined in `src/types/`: `FieldName`, `FieldCoords`,
`SubgraphName`, `TypeName`, `NodeType` (PR #2117 introduced the aliases;
PR #2307 #2330 #2338 expanded adoption).

```ts
// good
const keyFieldNamesByParentTypeName: Map<TypeName, Set<FieldName>>
function invalidSubgraph(name: SubgraphName): string

// bad — untyped strings
const keyFieldNamesByParentTypeName: Map<string, Set<string>>
```

**Exception:** when the value is semantically not one of those entities (e.g. an
array of error-message strings), type it as `Array<string>` — do NOT reuse
`Array<SubgraphName>` just because strings-to-strings (PR #2338).

### 3.2 Align alias types across related structs

If `Subgraph.name: SubgraphName`, then `InternalSubgraph.name` should be
`SubgraphName` too — don't let one side drift to `string` (PR #2338).
Apply the same rule to per-subgraph collections: prefer
`Map<SubgraphName, ...>` / `Set<SubgraphName>` over `Map<string, ...>` in
fields like `externalFieldDataBySubgraphName`, `keyFieldSetDatasBySubgraphName`,
`configureDescriptionDataBySubgraphName`, `interfaceObjectSubgraphs`
(PR #2117).

### 3.3 Use named constants for magic strings

Define named constants for any string literal that appears in the AST or
directive-argument logic (PR #2348, #2307).
Examples: `LITERAL_PERIOD`, `TYPENAME`, `FIELDS`, `KEY`, `ENTITY_CACHE`.

Live in:

- `src/utils/string-constants.ts` — shared across versions
- `src/v1/constants/strings.ts` — v1-scoped

**Gotcha:** the `@openfed__is` directive argument is **`fields`** (plural) —
constant name is `FIELDS`.
A past bug used `FIELD` (singular) and silently broke extraction (see
`CLAUDE.md` §"@openfed__is Directive").

### 3.4 Test constants must match source constants

If the source constant is `CONNECT_CONFIGURE_RESOLVER`, the test export is
`CONNECT_CONFIGURE_RESOLVER_DIRECTIVE` — not `CONNECT_FIELD_RESOLVER_DIRECTIVE`
(PR #2290).
Naming drift between `src/` and `tests/` trips grep and refactors.

### 3.5 `Array<T>` over `T[]` in exported signatures

Use `Array<string>` rather than `string[]` in exported function signatures and
type definitions, matching the existing style (PR #2449).

## 4. Directive handling

Directives are declared as `DirectiveDefinitionData` objects and consumed from a
single registry.

**Per directive, you touch:**

1. `src/v1/constants/directive-definitions.ts` — `DirectiveDefinitionNode`
   (the AST representation, with `locations`).
2. `src/v1/normalization/directive-definition-data.ts` — `*_DEFINITION_DATA`
   object with `argumentTypeNodeByName`, `requiredArgumentNames`,
   `optionalArgumentNames`, `isRepeatable`, `locations`.
3. `src/v1/constants/strings.ts` — directive name + argument name constants.
4. `src/v1/normalization/utils.ts` (or dedicated file) — extraction logic.
5. `tests/v1/directives/<directive>.test.ts` — tests.

**Rules:**

- Every argument declared in `argumentTypeNodeByName` must also appear in either
  `requiredArgumentNames` or `optionalArgumentNames` — missing entries were flagged
  in review as an incomplete definition (PR #2290: NATS_SUBSCRIBE example).
- Directive-definition *shapes* were consolidated to `DirectiveDefinitionNode`
  (PR #2307).
  Don't invent parallel representations.
- Persisted-directive extraction is **centralized** — route new persisted
  directives through the shared extractor rather than adding bespoke traversal
  (PR #2307).
- Directive-injection is **selective**: only inject the definitions a subgraph
  actually uses (PR #2307).
  When adding a new directive, decide whether it is always injected or
  conditionally-injected, and wire it into the selective-injection mechanism.
- **Two sources of truth must agree.**
  A directive has both a `*_DEFINITION` (AST node in `v1/constants/` or
  `v1/utils/constants.ts`) and a `*_DEFINITION_DATA` (normalization struct in
  `v1/normalization/directive-definition-data.ts`).
  Their `isRepeatable` and `locations` must match.
  PR #2225 flagged `ONE_OF_DEFINITION` (repeatable: true) vs
  `ONE_OF_DEFINITION_DATA` (repeatable: false) as a merge blocker — the
  federation and normalization layers disagreed silently.
- **Persisted directive repeatability is enforced** against
  `NON_REPEATABLE_PERSISTED_DIRECTIVES`.
  Check this list when declaring a new directive as non-repeatable.
- **Internal federation directives use the `openfed__` prefix**
  (`@openfed__requireFetchReasons`, `@openfed__configureDescription`,
  `@openfed__fieldSet`).
  Use the same prefix for new internal-only directives (PR #2170 #2256).
- **EDFS directives follow `edfs__<provider><Action>`** —
  `edfs__natsPublish`, `edfs__kafkaSubscribe`, `edfs__redisPublish`,
  `edfs__redisSubscribe` (PR #1810).
  Adding a new provider means constants + normalization factory + proto +
  router + full test coverage in one coherent pass.

## 5. Error and warning factories

Errors and warnings live in `src/errors/errors.ts` and `src/v1/warnings/warnings.ts`
as **factory functions**.

**Rules:**

- **Typed param objects over positional arguments** for any factory with 2+ params.
  This migration began in PR #2279 (`incompatibleParentKindMergeError` →
  `incompatibleParentTypeMergeError` with `IncompatibleParentTypeMergeErrorParams`)
  and is now the default; PR #2348 enforces it on new factories.
  Define a `*Params` interface next to the factory and export it alongside:

  ```ts
  export type NonExternalConditionalFieldErrorParams = {
    fieldCoordinates: string;
    path: string;
    // ...
  };
  export function nonExternalConditionalFieldError(
    params: NonExternalConditionalFieldErrorParams,
  ): Error { ... }
  ```

- **Error messages expand with step-by-step guidance** for user-facing remediation
  when the fix is non-obvious (PR #2456).
  Treat errors as documentation for people hitting them.
- **Multi-line error formatting** is intentional.
  Keep `\n` and indentation as written — `composition-go/index.global.js` bundles
  literal strings and diffs against them (PR #2456).
- When a warning receives a collection that the caller may mutate later, pass a
  **shallow copy** (`[...arr]`) to decouple the reference (PR #2449).
- **Deep-copy Maps of Sets/Maps** when threading per-subgraph state through
  field-data copies (PR #2221).
  Assigning by reference leaks mutations across copies and corrupts federation
  output.
  Canonical pattern:

  ```ts
  // good
  nullLevelsBySubgraphName: new Map(
    Array.from(src.nullLevelsBySubgraphName, ([k, v]) => [k, new Set(v)]),
  ),
  // bad — shared reference
  nullLevelsBySubgraphName: src.nullLevelsBySubgraphName,
  ```
- When introducing a new error, flag the `README.md §Contributing` note:
  "GraphQL types begin with a capital letter for clarity" (Enum, Input Object,
  Interface, Object, Scalar, Union) — apply this to **all** error messages you
  write or edit (PR #2648 README).

## 6. Tests

Tests run on **vitest** (`npx vitest run`).
Helper SDL fragments live in `tests/v1/utils/` and are named with two-letter
scheme constants (`fnaa`, `fnab`, `jaaa`, `jaab`, ...) — exported from the test
file and composed into scenarios.

### 6.1 Assertions

- **`toStrictEqual` on whole configs**, not field-by-field.
  See `getConfigForType()` helper pattern in `AGENTS.md`.
- **Compare errors strictly** — do not substring-match error messages.
  "Main issue is the tests do not strictly compare errors" was an explicit
  `CHANGES_REQUESTED` review (Aenimus, PR #2470).
- **`federateSubgraphsSuccess` is not self-asserting** — always include
  `expect(success).toBe(true)` even if the helper name implies it (PR #2298).
- Always pass `ROUTER_COMPATIBILITY_VERSION_ONE` to `batchNormalize`.
- **Use the success/failure helpers, not raw `federateSubgraphs`.**
  Prefer `federateSubgraphsSuccess` / `federateSubgraphsFailure` /
  `normalizeSubgraphSuccess` / `normalizeSubgraphFailure`
  (Aenimus on PR #1997: "A great opportunity to update to
  `federateSubgraphSuccess` ;)"; also on PR #1810 events tests).
- **Normalize SDL before string comparison.**
  Direct string equality on multi-line SDL strings is brittle across whitespace
  and directive-order changes.
  Define a small `expectClientSchema(actual, expected)` helper that normalizes
  both sides once (PR #2232).
- **For directive-emission tests, assert both server SDL and client SDL.**
  The client schema is produced via `printSchemaWithDirectives` and may include
  or exclude directives differently from the server schema (PR #2232).
- **Use exported constants (`QUERY`, `MUTATION`, `SUBSCRIPTION`) in tests**
  rather than the literal string `'Query'` / `'Mutation'` / `'Subscription'`
  (PR #2232).

### 6.2 Test titles

- **Title must match behavior.**
  "…returns an error" is wrong if the test asserts success (PR #2298).
- **No typos.**
  "will included" → "will be included", "frm" → "from" were blockers (PR #2298).
- Fix title grammar as part of the PR that changed the behavior the test covers,
  not in a follow-up.

### 6.3 Test hygiene

- **No duplicate tests.**
  Copy-paste with identical subgraphs, description, and assertions is a merge
  blocker (PR #2454 — two identical `@authenticated` tests).
  Either delete the duplicate or diff the scenario.
- **No unused SDL constants.**
  If `fpaa`/`fpab` are defined but no test references them, delete or wire them up
  (PR #2454).
- **One file per directive** under `tests/v1/directives/`.
  Use the existing naming (`entity-caching.test.ts`, `authorization-directives.test.ts`,
  `connect-configure-resolver.test.ts`).

### 6.4 Coverage

- Codecov reports on PRs but does not block merges — the project coverage floor
  is ~40%.
  Aim for coverage of **your change**, not the whole repo (PR #2470 had 8.8%
  patch coverage and still merged after review).
- When adding a new option or public path, add a dedicated regression test
  rather than relying on incidental coverage (PR #2595).
- **Refactor-only PRs still need tests.**
  "Should we write some tests?" was an explicit `CHANGES_REQUESTED` on PR #2013
  (a chore/refactor PR).
  "chore:"-prefixed PRs are not exempt from the test expectation.
- **Integration tests for new options** should cover both the enabled and the
  disabled case with proper setup and cleanup — see the
  `disableResolvabilityValidation` test pattern in PR #2065.

## 7. Walkers and graph code

`src/resolvability-graph/` and the walkers under
`src/v1/normalization/walkers.ts` return result objects.
Feedback on PR #2240 #2298 #2568 crystallized these rules:

- When adding a new return field (e.g. `isExternal`, `areDescendantsResolved`),
  propagate it through **every** call-site — don't fix one branch and leave the
  shared/concrete branches silently dropping the value.
- For paths whose existence depends on traversal history (nested entities,
  shared root fields), add an explicit code comment stating the invariant:
  `// The path may not exist from the root walker due to nested entities.`
  (Aenimus review, PR #2499).
- Extend `VisitNodeResult` / `VisitEntityParams` rather than piggy-backing a
  boolean on an existing field.
- **Construct param objects once and reuse.**
  `NodeResolutionData` takes a `NodeResolutionDataParams` object, not a raw
  `GraphNode`.
  Building the param object once and passing it through every call site keeps
  types honest under strict checking (PR #2240).
- **Watch for accumulator initializers with short-circuit operators.**
  `let removeDescendantPaths: boolean | undefined = undefined;` followed by
  `removeDescendantPaths &&= isRevisitedNode` stays `undefined` forever —
  the `&&=` operator never writes to a falsy LHS.
  Initialize to `true` when accumulating "all branches agreed" state
  (PR #2240).
- **Reset per-parent visitor flags** (e.g. `isParentObjectProtected`) before
  processing each type.
  `extractDirectives` early-returns on directive-free nodes, so flags from a
  previous parent can leak into unrelated types and mark fields incorrectly
  (PR #2225).
- **Use switch-case block scoping.**
  Wrap case bodies in `{ ... }` when declaring local variables — otherwise
  the declarations are accessible in sibling cases and cause subtle bugs.
  Flagged on the `Kind.INPUT_OBJECT_TYPE_DEFINITION` @oneOf validation (PR #2225).
- **Federated emission across subgraphs must be deterministic.**
  When collapsing per-subgraph data (e.g. `nullLevelsBySubgraphName`,
  `configureDescriptionDataBySubgraphName`) into a single emitted directive,
  compute a **deterministic union** across all subgraphs.
  Using `getFirstEntry(map)` produces order-dependent output and different
  federated schemas across runs (PR #2221).

### 7.1 Collection helpers

- **Do not use `Set.prototype.intersection`** — not available across all
  supported runtimes.
  Prefer `new Set<T>([...a].filter((x) => b.has(x)))` (PR #2117).
- Prefer `Array<T>` over `T[]` in signatures (see §3.5).

## 8. Pipeline consistency (composition → router)

This is the single most common source of silently-dropped functionality.
See `CLAUDE.md §"Pipeline: Composition → Router"` for the canonical list.
Summary of the steps **every** config-type change must touch:

1. `composition/src/router-configuration/types.ts` — TS type.
2. `composition/` extraction logic.
3. `proto/wg/cosmo/node/v1/node.proto` — protobuf (use `reserved` for removed fields).
4. `make generate-go` — regenerates Go proto.
5. `connect/src/wg/cosmo/node/v1/node_pb.ts` — generated TS proto class.
6. `shared/src/router-config/graphql-configuration.ts` — proto serialization.
7. `router/core/factoryresolver.go` — proto → planner metadata.
8. `composition-go/generate.sh` — rebuild JS bundle (rebuild `composition` +
   `shared` first).
9. `router-tests/entity_caching && make compose` — regenerate integration config.

**If a field appears in composition output but is missing from the router config
JSON, check the shared-package serializer first.**

## 9. Build, lint, format

See `package.json` — scripts are authoritative.

- `pnpm build` → `rm -rf dist && tsc`.
- `pnpm test` → `vitest run`.
- `pnpm lint` → `prettier --check .` (read-only).
- `pnpm format` → `prettier --write .` (writes).
- `pnpm lint:fix` → runs eslint with `--fix` then `pnpm format`.

**Rules:**

- **Keep `format` as write-only and `lint` as check-only.**
  Don't mix `-w` and `-c` flags on a single prettier call (PR #2579).
- When adding a Makefile target, add it to `.PHONY` (PR #2405 flagged the
  controlplane Makefile; same rule applies here).
- Dependency bumps (e.g. `@graphql-tools/utils` 10 → 11, `vitest` 2 → 3)
  live in their own PR (PR #2114 #2495).
  Don't fold them into feature work.
- **Use POSIX shell commands in `build` scripts**, not cross-platform Node
  wrappers.
  Canonical form: `"build": "rm -rf dist && tsc"` (PR #2219 removed `del-cli`
  across the workspace).
  CI runs bash;
  contributors on Windows use WSL.
  Don't reintroduce `del-cli` or similar wrappers as dev-dependencies.

## 10. Contributing and review workflow

Observed patterns from the 20-PR sample:

- **@coderabbitai** provides automated review.
  Its findings are advisory;
  the maintainer (primarily **@Aenimus** for the TS side) still gates merges.
- **CHANGES_REQUESTED → iterate → APPROVED** is normal.
  PR #2470 went through three rounds before landing.
- **Cross-team approval** is split: composition/TS reviewer approves the TS
  changes (`"From composition/TS perspective, LGTM!"`), router/protographic
  reviewer approves the Go/proto side separately.
  Tag both in cross-cutting PRs.
- **Revert PRs** use the `fix:` prefix, not `revert:` (PR #2328:
  `fix: revert propagating schema extension node to router`).
- Commit/PR title convention:
  - `feat:` new functionality
  - `fix:` bug fix (including reverts)
  - `chore:` refactor, test additions, internal propagation
  - `docs(composition):` README / ARCHITECTURE / doc changes

## 11. Refactoring discipline

- **Extract duplicated logic.**
  `buildSubgraphConfigMap()` and the config-building blocks in
  `buildFederationResult` / `buildFederationContractResult` were flagged as
  copy-paste duplicates (PR #2307).
  Before duplicating a block across two federation paths, extract a helper.
- **Avoid `as any` casts.**
  They pass type-checking at the cost of refactor safety (PR #2307 review).
  Prefer distributive conditionals or overloads;
  accept the cast only when the alternative is materially more complex, and
  document why.
- **Don't leave unused constructor parameters.**
  If `NormalizationFactory` takes `CompositionOptions` but never reads
  `this.options`, either remove the parameter or add a comment explaining the
  intent for future use (PR #2595 review).
- **Don't mix unrelated changes in one PR.**
  PR #2013 was flagged for incidentally bringing in Redis/EDFS constants
  (`CHANNEL`, `EDFS_REDIS_*`) that had nothing to do with the inheritable-directive
  refactor it claimed to do.
  Rebase cleanly or split the PR when you notice drift.
- **Name parameters descriptively.**
  `removeInheritedDirectives` was flagged as ambiguous —
  `excludeInheritedDirectiveNames` (or similar) makes the filter semantics
  explicit (PR #2013).

## 12. Documentation updates

Triggers that require a doc edit in the same PR:

| Change | Update |
|---|---|
| Public API signature (`federateSubgraphs`, result types) | `README.md` |
| Pipeline structure, new stage, new directive family | `ARCHITECTURE.md` |
| Entity-caching behavior | `CLAUDE.md` + `AGENTS.md` |
| New convention surfaced in review | this file (`COMPOSITION_CONVENTIONS.md`) |
| New error message | `README.md §Contributing` capitalization check |

## 13. Quick reference — things reviewers will block on

These are the concrete issues that caused `CHANGES_REQUESTED` in the sample.
Fix them before asking for review, not after.

- Tests using substring match on errors instead of strict comparison.
- Missing `expect(success).toBe(true)` after `federateSubgraphsSuccess`.
- Test title that describes an error but asserts success.
- Typos in test titles ("will included", "frm").
- Duplicate test cases (identical subgraphs + description + assertions).
- Unused SDL constants in a test file.
- Magic string literals where a `*_CONSTANT` exists.
- `string[]` where `Array<string>` is the house style.
- `as any` casts without justification.
- Positional args on 2+-param error factories (should be a typed param object).
- Missing `optionalArgumentNames`/`requiredArgumentNames` entries for a declared
  directive argument.
- Forgetting to update `README.md` when changing `federateSubgraphs` shape.
- Forgetting any step in the composition → router pipeline (silent config drop).
- Mixing `-w` and `-c` flags on prettier scripts.
- New flag added to one of `federateSubgraphs` / `...WithContracts` /
  `...Contract` but not the other two.
- `isRepeatable` / `locations` disagreement between `*_DEFINITION` and
  `*_DEFINITION_DATA` for the same directive.
- Per-subgraph `Map`/`Set` assigned by reference instead of deep-copied.
- Federated emission that picks `getFirstEntry(...)` instead of computing a
  deterministic union across subgraphs.
- `Set.prototype.intersection` used (not universally supported — use
  `[...a].filter(x => b.has(x))`).
- Switch case body declaring `let`/`const` without `{ ... }` block scope.
- Per-parent visitor flag (e.g. `isParentObjectProtected`) not reset between
  types.
- Positional-argument error factory where the rest of the codebase uses
  `*Params` object parameters.
- Test using `federateSubgraphs(...)` directly instead of the
  `federateSubgraphsSuccess` / `Failure` helper.
- SDL string-equality assertion without a normalization helper.
- `'Query'` / `'Mutation'` / `'Subscription'` literal in a test instead of the
  exported `QUERY` / `MUTATION` / `SUBSCRIPTION` constant.
- Directive-emission test that only asserts the server SDL and ignores the
  client SDL.
- Chore/refactor PR without any tests (PR #2013).
- Unrelated changes folded into a focused PR (flagged on PR #2013; split or
  rebase).
- `build` script reintroducing `del-cli` or similar wrapper (should be
  `rm -rf dist && tsc`).

---

**Sample:** 40 merged PRs, #1892 → #2648 (May 2025 → March 2026).
When this doc and the referenced PRs disagree, the newer PR wins —
open a PR to update this file rather than silently deviating.
