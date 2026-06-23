# RFC: Disallow Inline Argument Values (Force Variables)

| Field | Value |
| --- | --- |
| Title | Disallow Inline Argument Values (Force Variables) |
| Status | Draft |
| Date | 2026-06-17 |
| Internal ID | ENG-9586 |
| Ticket | #2498 |
| Author | _TBD (placeholder)_ |

## 1. Summary

This RFC proposes an optional Cosmo Router security policy that detects,
and optionally rejects,
GraphQL operations that carry hardcoded inline argument values instead of variables.

The canonical example the policy targets:

```graphql
query GetUserById {
  userById(userId: "12345") {
    loginName
  }
}
```

Under the policy this operation can be flagged or rejected,
and the client is guided to rewrite it as:

```graphql
query GetUserById($userId: ID!) {
  userById(userId: $userId) {
    loginName
  }
}
```

The feature ships in three modes: `off` (default), `enabled-non-enforcing` (log plus an extensions hint on a successful response), and `enabled-enforcing` (reject with a GraphQL error and a configurable HTTP status code).

## 2. Motivation

The use case driving this request:

> A team validates unique queries from a runtime query store against draft supergraph schemas.
> Too many unique queries (caused by inline values) overwhelm their tooling.
> They want the router to optionally force clients to use variables and prevent operations with hardcoded inline argument values,
> and optionally surface the normalized form / guidance.

The core problem is cardinality.
Every distinct inline literal produces a distinct raw operation string,
so `userById(userId: "12345")` and `userById(userId: "12346")` look like two unique queries to a downstream query store,
even though they are the same operation shape.
When the operations are parameterized with variables,
they collapse to a single unique query,
which is what such validation tooling expects.

### Why detection must run on the ORIGINAL, un-normalized operation

The policy must flag an inline argument **whenever the client sent one**, with no exceptions for
directive arguments or introspection, and even when normalization would later erase the evidence.
Normalization mutates and prunes the operation in three ways that destroy that evidence:

- **Variable extraction rewrites literals into variables.**
  `variablesExtractionVisitor.EnterArgument` sets `arg.Value.Kind = ast.ValueKindVariable`
  (`variables_extraction.go` lines 79-80 and 119-120).
  After it runs, the literals look like variables.
- **`@skip` / `@include` normalization removes whole nodes.**
  `directiveIncludeSkipKeepNodes` deletes fields whose `@skip(if: true)` / `@include(if: false)`
  resolves at normalization time, via `RemoveNodeFromSelectionSetNode`
  (`directive_include_skip.go:128-135`).
  If a removed field carried an inline argument, that argument is gone before any later pass sees it.
- **Fragment inlining and dead-fragment removal** reshape where arguments live.

The requirement is explicit: we want to flag the inline argument **even if** a `@skip`/`@include`
would normalize that part of the query out, **even if** it is a directive argument
(`@include(if: true)` itself counts), and **even if** the operation is an introspection query
(`__type(name: "User")` counts).
The only document where all of these are simultaneously visible and intact is the operation
exactly as parsed, before any normalization stage runs.

Therefore detection runs during parsing itself (`operationKit.Parse()`, `graphql_prehandler.go:687`),
which is the first and only pass that sees the operation fully intact,
before any normalization stage and before the router writes any internal cache.
An enforce-mode rejection then short-circuits without polluting a single cache — see § 4.1 and § 4.3.

## 3. Goals / Non-Goals

### Goals

- Detect inline argument values on the original operation exactly as the client sent it.
- Flag inline arguments **comprehensively**: field arguments, directive arguments (`@skip`/`@include` and any other directive), introspection-field arguments, and arguments inside selections that `@skip`/`@include` would normalize out.
- Provide three modes: off, log-only (non-enforcing), and enforce.
- Make HTTP status code, GraphQL error code, and error message configurable.
- In non-enforcing mode, return a successful response with an extensions annotation that lists the offending paths so clients can migrate.
- Emit structured logs and an OTEL attribute so operators can discover affected clients before enforcing.
- Allow persisted operations by default (they are stored server-side and therefore intentional), with a config flag to apply the policy to persisted operations as well.

### Non-Goals

- Rewriting the client's operation for them (Cosmo already normalizes internally; this policy does not change the executed operation).
- Changing the internal normalization behavior or the executed plan.
- Detecting inline values inside variable-definition default values (`$x: Int = 5` is a definition default, not an argument the client passed to a field or directive — out of scope; see Open Questions).
- A per-field or per-argument allowlist of "acceptable" inline arguments (out of scope for v1; see Open Questions).

## 4. Detailed Design

### 4.1 Integration point in graphql-go-tools

The literal-vs-variable discriminator is trivial in graphql-go-tools v2.4.6.
The argument `Value` carries a `Kind` of type `ast.ValueKind`
(`pkg/ast/ast_value.go` lines 17-30, `pkg/ast/ast_argument.go` line 18).
An argument is inline if `arg.Value.Kind != ast.ValueKindVariable`.
The existing `variablesExtractionVisitor.EnterArgument`
(`pkg/astnormalization/variables_extraction.go` line 39) uses exactly this check at line 62 —
we reuse the discriminator, but **not** its guards, because this policy must flag the cases those guards skip.

#### Recommended approach: detect during parsing, in `parseArgumentList`

Three requirements decide the integration point:

1. **Flag everything** — field arguments, directive arguments (`@skip`/`@include` included), introspection arguments, and arguments in selections that normalization would prune.
2. **Reject early without polluting caches** — short-circuit before the router writes any internal cache.
3. **No extra traversal** — reuse an iteration the router already performs.

Requirement 1 rules out riding any normalization stage:
normalization rewrites literals to variables, and `@skip`/`@include` normalization *deletes nodes*
(`directive_include_skip.go:128-135`) before later stages run.
The only point at which every inline argument is simultaneously present is the operation as parsed.

The parser already visits every argument value, so detection rides the parse the router performs anyway —
no extra walk, and it is the earliest possible point (before any normalization or cache).
The single choke point is `Parser.parseArgumentList` (`pkg/astparser/parser.go:415`),
which parses arguments for **both fields and directives**
(it is called from field parsing and from `parseDirectiveList`, `parser.go:394`).
It reads the argument name, then `value := p.ParseValue()` (`parser.go:431`),
and `ParseValue` already sets `value.Kind` — `ValueKindVariable` for `$var`, a literal kind otherwise (`parser.go:462-498`).

The changes in graphql-go-tools v2.4.6:

1. Add an opt-in field to `Parser` (e.g. `reportInlineArguments bool` plus a `[]InlineArgumentInfo` accumulator),
   settable per parse and reset at the start of each parse (alongside the parser's existing per-parse reset).
   When the flag is off, the only cost is one predictable branch per argument — effectively free.

2. In `parseArgumentList`, immediately after `value := p.ParseValue()`,
   record the argument when the flag is set and `value.Kind != ast.ValueKindVariable`.
   Because this is the common path for field **and** directive arguments, it captures:
   - field arguments (`userById(userId: "12345")`),
   - directive arguments (`@include(if: true)`, `@skip(if: false)`, any directive),
   - introspection-field arguments (`__type(name: "User")`),
   - arguments inside fields/fragments that `@skip`/`@include` would later remove (nothing is pruned yet).

   It naturally **excludes** variable-definition defaults (`$x: Int = 5`), because those are parsed
   on a different path (variable-definition parsing), not through `parseArgumentList` — so the one
   intended exclusion requires no special-casing.

```go
type InlineArgumentInfo struct {
    ArgumentName string        // e.g. "userId" — available as name.Literal at parser.go:430
    ValueKind    ast.ValueKind // e.g. ValueKindString — from value.Kind
    InDirective  string        // directive name if this is a directive argument, else ""
    Position     position.Position
}
```

3. Expose the accumulator (e.g. `func (p *Parser) InlineArguments() []InlineArgumentInfo`).

"Return during parse": in enforce mode the parser can fail fast — append the report on the first inline
argument and stop, surfacing it as a parse-time error so `OperationKit.Parse()` returns it directly
(the operation name is parsed before the selection set, so it is available for the error/log even on fast-fail).
In log-only mode the parser collects all inline arguments in the same single pass it already makes,
so the extensions hint can list every offending argument.

The one ergonomic cost relative to a post-parse AST visitor: a visitor gets a ready-made `Ancestors`
stack for building a dotted `field.path.argument`, whereas the recursive-descent parser would need a
small current-field/-directive name stack (maintained only when the flag is on) to produce the same path.
For v1 the report is argument-level (`ArgumentName` + `InDirective` + position), with the enclosing field
name supplied by the calling parse frame; richer nested paths are a later refinement (§ 9).

This is additive to graphql-go-tools and changes no existing parse or normalization behavior when the flag is off.

#### Comparison of approaches

| # | Approach | Flags directive / introspection / skip-removed args? | Reject before 1st cache write? | Extra walk? | Verdict |
| --- | --- | --- | --- | --- | --- |
| A | Detect during parse in `parseArgumentList` (RECOMMENDED) | **Yes** — sees the un-normalized operation | **Yes** — runs during `Parse()`, before `NormalizeOperation` and any cache | **No** — rides the parse already performed | Chosen |
| B | Dedicated argument visitor over the parsed op, after `Parse()` | **Yes** — also sees the un-normalized operation | Yes | Yes — one extra argument-only walk | Fallback (see § 11) |
| C | Piggyback the static-normalization `cleanup` walk | **No** — `@skip`/`@include` already pruned nodes | Partly | No | Rejected |
| D | Instrument the variable-extraction visitor (`variables_extraction.go:39`) | **No** — runs after pruning and after the normalization cache write | No | No | Rejected |
| E | `astvalidation` rule | **No** — post-normalization; literals already variables | No | Yes | Rejected |

Approaches C, D and E observe the operation *after* normalization has rewritten literals or deleted
skipped nodes, so none can flag normalized-out arguments.
Approach B sees the operation intact but pays for a second argument walk.
Approach A sees the operation intact, adds no traversal, and is the earliest possible decision point;
its only real cost is the minor path-reconstruction ergonomics noted above, which is an acceptable trade.

### 4.2 Detection scope

The policy flags **every** argument with a non-variable value, in any context.
There is exactly one structural exclusion (variable-definition defaults) and one runtime exclusion
(persisted operations, by default — § 4.3).

| Case | Example | Flagged? | Rationale |
| --- | --- | --- | --- |
| Field-argument literals (string/int/float/boolean) | `userById(userId: "12345")` | **Yes** | The core target |
| Enum literals | `field(order: ASC)` | **Yes** | A hardcoded value is still a hardcoded value |
| Null literals | `field(arg: null)` | **Yes** | Explicit `null` is an inline literal (distinct from an omitted argument, which produces no `Argument` node) |
| List / object literals | `filter(by: [1,2,3])`, `filter(by: {a: 1})` | **Yes** | Recorded as one inline argument at the argument level |
| Directive arguments | `field @include(if: true)`, `@skip(if: false)` | **Yes** | Per requirement: directive inline values are flagged (`InDirective` records the directive name) |
| Introspection-field arguments | `__type(name: "User")` | **Yes** | Per requirement: introspection is not exempt |
| Arguments under a node `@skip`/`@include` would remove | `user @skip(if: true) { posts(first: 10) }` | **Yes** | Detection runs pre-normalization, so the still-present `first: 10` is flagged even though normalization would delete the `user` selection |
| Variable arguments | `userById(userId: $userId)` | No | `ValueKindVariable` — the compliant form |
| Variable-definition default values | `query q($x: Int = 5)` | No | A definition default is not an argument the client passed to a field or directive; it is parsed off the variable-definition path, not `parseArgumentList`, so detection never sees it (see Non-Goals / Open Questions) |

Explicit decisions:

- **Directive and introspection arguments count.**
  This is the deliberate inversion of `variablesExtractionVisitor`'s guards;
  the policy treats any inline value the client typed as something to flag.
- **`@skip(if: true)` / `@include(if: false)` removed selections still count.**
  The argument existed in the operation the client sent; that it would be normalized away is irrelevant to "did the client use an inline value." This is why detection must precede normalization.
- **Required-literal cases still count.**
  GraphQL has no argument that *requires* a literal; any value can be supplied as a variable.

### 4.3 Router pipeline integration

The router pipeline order in `graphql_prehandler.go:handleOperation()` is:

```
Parse (687) -> NormalizeOperation (830) -> NormalizeVariables (855)
  -> RemapVariables (906) -> ValidateQueryComplexity (1038)
  -> Validate (1059) -> ValidateStaticCost (1149) -> Plan (1119)
```

Detection happens **inside `Parse()` (line 687)** — the parser records inline arguments as it
builds the AST (§ 4.1). At every later line in the order above, normalization has already begun
rewriting or pruning the operation, so parse time is the only complete view.

```
Parse (687)   <- parser records inline arguments here; enforce mode fails the parse
              <- enforce-mode rejection is returned by Parse(), before any cache is consulted or written
NormalizeOperation (830)   -> first cache write at :885
NormalizeVariables (855)   -> variables cache
... RemapVariables / Validate / Plan, each with its own cache
```

Persisted-operation gating (decided before `Parse()`):

- A persisted operation is identified by `parsedOperation.IsPersistedOperation`,
  which is set during `FetchPersistedOperation` (`graphql_prehandler.go:638`, field at `operation_processor.go:75`) —
  **before** `Parse()` at line 687. So the gating decision is available in time.
- `OperationKit.Parse()` sets the parser's detection flag for this request to
  `enabled && (!parsedOperation.IsPersistedOperation || includePersistedOperations)`.
- **By default the policy skips persisted operations** — they are stored server-side,
  so an inline value in a persisted operation was an intentional, pre-vetted choice;
  the parser flag stays off for them and the operation executes normally.
- With `include_persisted_operations: true` (§ 5), the flag is set for persisted operations too,
  and they are treated identically to dynamic ones.

Enforce mode:

- The parser fails fast on the first inline argument, so `OperationKit.Parse()` returns an
  `*inlineArgumentsError` (a typed error like the existing `reportError`) **from `Parse()` itself**.
  Because this is before the normalization-cache consult/write (`:819`/`:885`),
  before `NormalizeVariables`, `RemapVariables`, `Validate`, `ValidateStaticCost`, complexity, and planning,
  **no internal cache is consulted or written for the rejected operation** — the request stops at the
  earliest possible boundary, by construction.
- The prehandler maps `*inlineArgumentsError` to the configured HTTP status, `extensions.code`, and message.

Log-only / annotate mode:

- The parser collects all inline arguments in its single pass (no fail-fast); the operation is valid
  and proceeds through the normal pipeline (and is cached normally).
  The detection result is read off the parser and stored on `parsedOperation`
  (`HadInlineArguments bool`, `InlineArguments []InlineArgumentInfo`),
  and the prehandler emits the Warn log line and attaches the `extensions` annotation after resolve.

Threading (config side):

- Config flows from the new `SecurityConfiguration` sub-block -> `OperationProcessorOptions` (`operation_processor.go:109-133`)
  -> `OperationProcessor` (`operation_processor.go:137-150`),
  initialized in `NewOperationProcessor` (`operation_processor.go:1539`),
  consistent with how existing operation-processing limits are threaded.
  `OperationKit.Parse()` reads it to set the per-request parser flag described above.
  When `mode == off`, the flag is never set and the parser's per-argument branch is the only residual cost
  (one predictable, never-taken branch) — effectively zero.

#### Why detection is intentionally not cached

Detection rides parsing, which runs on every request regardless of downstream cache state,
so there is no cache-hit gap to close (unlike a normalization-stage byproduct, which would go silent on a hit).
Rejected operations are never inserted into any cache.
There is no separate detection walk to memoize — the work is folded into the parse the router already does.

### 4.4 The three modes

- **off** (default): the parser detection flag is never set; the only residual cost is one never-taken branch per argument; effectively zero.
- **enabled-non-enforcing**: the parser collects inline arguments during `Parse()` (line 687) without failing; the prehandler logs a structured Warn line and attaches an `extensions` annotation to the otherwise-successful response.
- **enabled-enforcing**: the parser fails fast on the first inline argument, so `Parse()` (line 687) returns the error before `NormalizeOperation()` (line 830) and before any cache is consulted or written; the prehandler returns a GraphQL error with the configured `extensions.code` and HTTP status code. No internal cache is touched for the rejected operation.

In all enabled modes, persisted operations are skipped unless `include_persisted_operations: true`.

## 5. Configuration

This block lives under `security` in the router config,
alongside `complexity_limits` and `cost_control`,
which use the same enabled/mode/parameters shape.

### YAML

```yaml
security:
  disallow_inline_arguments:
    # off | enabled-non-enforcing | enabled-enforcing
    mode: off
    # HTTP status returned in enforce mode (200 keeps GraphQL-spec compliance; 400 is common for hard reject)
    enforce_http_status_code: 400
    # GraphQL error extensions.code emitted on rejection / annotation
    error_code: INLINE_ARGUMENT_VALUES_NOT_ALLOWED
    # human-readable error / hint message
    error_message: "Inline argument values are not allowed. Use variables instead."
    # when false (default), persisted operations are exempt (they are stored server-side and intentional);
    # set true to apply the policy to persisted operations as well
    include_persisted_operations: false
    logging:
      enabled: true
      # debug | info | warn | error
      level: warn
```

### Go config struct

Mirrors `CostControl` (`config.go:551-580`) and the mode-const pattern of `ComplexityLimitsMode` (`config.go:527-534`).

```go
type DisallowInlineArgumentsMode string

const (
    DisallowInlineArgumentsModeOff           DisallowInlineArgumentsMode = "off"
    DisallowInlineArgumentsModeNonEnforcing  DisallowInlineArgumentsMode = "enabled-non-enforcing"
    DisallowInlineArgumentsModeEnforcing     DisallowInlineArgumentsMode = "enabled-enforcing"
)

type DisallowInlineArgumentsLogging struct {
    Enabled bool   `yaml:"enabled" json:"enabled" envDefault:"true"`
    Level   string `yaml:"level,omitempty" json:"level,omitempty" envDefault:"warn"`
}

type DisallowInlineArguments struct {
    Mode                       DisallowInlineArgumentsMode    `yaml:"mode,omitempty" json:"mode,omitempty" envDefault:"off"`
    EnforceHTTPStatusCode      int                            `yaml:"enforce_http_status_code,omitempty" json:"enforce_http_status_code,omitempty" envDefault:"400"`
    ErrorCode                  string                         `yaml:"error_code,omitempty" json:"error_code,omitempty" envDefault:"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`
    ErrorMessage               string                         `yaml:"error_message,omitempty" json:"error_message,omitempty" envDefault:"Inline argument values are not allowed. Use variables instead."`
    IncludePersistedOperations bool                           `yaml:"include_persisted_operations,omitempty" json:"include_persisted_operations,omitempty" envDefault:"false"`
    Logging                    DisallowInlineArgumentsLogging `yaml:"logging,omitempty" json:"logging,omitempty"`
}
```

This is added to `SecurityConfiguration` (`config.go:497`):

```go
type SecurityConfiguration struct {
    // ... existing fields ...
    DisallowInlineArguments DisallowInlineArguments `yaml:"disallow_inline_arguments,omitempty" json:"disallow_inline_arguments,omitempty"`
}
```

A new error-code constant is registered in `errors.go:58-63`:

```go
ExtCodeErrInlineArgumentValuesNotAllowed = "INLINE_ARGUMENT_VALUES_NOT_ALLOWED"
```

### Defaults table

| Knob | Default | Notes |
| --- | --- | --- |
| `mode` | `off` | Feature is fully disabled and free by default |
| `enforce_http_status_code` | `400` | Only used in enforce mode; non-enforce always returns 200 |
| `error_code` | `INLINE_ARGUMENT_VALUES_NOT_ALLOWED` | UPPER_SNAKE_CASE per convention |
| `error_message` | `Inline argument values are not allowed. Use variables instead.` | Surfaced in enforce error and non-enforce hint |
| `include_persisted_operations` | `false` | Persisted operations are exempt by default; set `true` to apply the policy to them too |
| `logging.enabled` | `true` | When the feature is active |
| `logging.level` | `warn` | Warn for both modes; Error is used on the rejection itself in enforce mode |

## 6. Behavior in Each Mode

### 6.1 Enforce (`enabled-enforcing`)

Detection finds inline args, the request is short-circuited before `Validate()`,
and a GraphQL error is returned via `NewHttpGraphqlError(message, code, statusCode)`
(`http_graphql_error.go:22-28`), written through `writeOperationError()` (`errors.go:361-433`).
HTTP status is the configured `enforce_http_status_code` (default 400).

Exact response body:

```json
{
  "errors": [
    {
      "message": "Inline argument values are not allowed. Use variables instead.",
      "extensions": {
        "code": "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
        "inlineArguments": [
          {
            "path": "userById.userId",
            "argument": "userId",
            "valueKind": "String"
          }
        ]
      }
    }
  ]
}
```

### 6.2 Non-Enforce (`enabled-non-enforcing`)

The operation succeeds (HTTP 200).
The result carries an `extensions` annotation that lists the offending paths and a migration hint,
following the warn-mode extensions pattern used by rate limiting and authorization
(`HasResponseExtensionData()` / `RenderResponseExtension()`,
`authorizer.go:32-48`, `ratelimiter.go:173-182`, attached via `response.Extensions`).

Exact response body (data shown illustratively):

```json
{
  "data": {
    "userById": {
      "loginName": "alice"
    }
  },
  "extensions": {
    "inlineArguments": {
      "code": "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
      "message": "Inline argument values are not allowed. Use variables instead.",
      "arguments": [
        {
          "path": "userById.userId",
          "argument": "userId",
          "valueKind": "String"
        }
      ]
    }
  }
}
```

Structured log line (also emitted):

```
WARN inline arguments found in operation
  count=1
  paths=["userById.userId"]
  operation_name="GetUserById"
  operation_hash=12345678901234567890
  client_name="web"
  client_version="1.4.2"
```

### 6.3 Off (`off`, default)

The parser's detection flag is never set, so parsing behaves exactly as today.
Complete no-op aside from one never-taken branch per argument.

## 7. Migration Strategy

The rollout path is `off` -> `enabled-non-enforcing` -> `enabled-enforcing`.

1. **off (baseline).**
   No behavior change.
2. **enabled-non-enforcing (discovery).**
   Operators turn this on with `logging.enabled: true`.
   Every request that uses inline args produces a structured Warn log
   (`operation_name`, `operation_hash`, `client_name`, `client_version`, `inline_argument_paths`)
   and an `extensions.inlineArguments` block in the response.
   Operators discover affected clients three ways:
   logs (filter on the message / paths fields),
   the response extensions (clients/SDKs surface the hint directly to their teams),
   and the OTEL attribute / metric (per-client aggregation; see Observability).
   Client teams migrate inline values to variables at their own pace.
3. **enabled-enforcing (cutover).**
   Once the per-client metric shows the offending traffic has dropped to zero (or an acceptable floor),
   operators flip to enforce.
   Newly non-compliant operations are rejected with the configured status and code.

Per-client considerations:

- Because the log line and metric are dimensioned by `client_name` / `client_version`,
  operators can see exactly which clients (and versions) still need migration before enforcing.
- A staged rollout per client (e.g. enforce only after a client's version is known migrated)
  is not built into v1 but is enabled by the per-client observability (see Open Questions for a per-client mode).

## 8. Observability

### Structured log fields

Emitted via the request-scoped `requestContext.logger` (`graphql_prehandler.go`, logger retrieved around line 224),
following the `operation_blocker.go` precedent:

- `count` (`zap.Int`) — number of inline arguments found.
- `paths` (`zap.Strings`) — list of `field.path.argument` strings.
- `operation_name` (`zap.String`).
- `operation_hash` (`zap.Uint64`).
- `client_name` (`zap.String`).
- `client_version` (`zap.String`).

Warn level in non-enforce mode; Warn before rejection (and Error on the rejection itself) in enforce mode.

### OTEL attribute / metric

Add a new attribute key alongside the existing operation attributes in `router/pkg/otel/attributes.go`
(next to `WgOperationName`, `WgClientName`, `WgClientVersion`, `WgOperationHash`):

- `wg.operation.inline_arguments.count` — set as a span attribute via `span.SetAttributes()`.

This attribute lets operators build a per-client breakdown
(`wg.client.name` x `wg.client.version` x inline-argument count)
to drive the migration decision before enforcing.

## 9. Edge Cases & Open Questions

- **Mutations and subscriptions.**
  Detection walks the parsed operation regardless of operation type,
  so the policy applies to query, mutation, and subscription uniformly.
  Open question: should subscriptions be exempt (long-lived, fewer of them)?
  Proposed default: apply to all; revisit if customers ask.
- **Persisted / safelisted operations.** **Resolved.**
  Persisted operations are stored server-side and therefore intentional,
  so they are **allowed by default** (detection does not run for them).
  The `include_persisted_operations` flag (§ 5) opts persisted operations into the policy,
  treating them exactly like dynamic operations.
  (Safelisting is a separate, stronger control; this flag governs only the inline-argument policy.)
- **`@defer` and other directive arguments.**
  Directive arguments are now in scope: an inline value on `@defer`, `@include`, `@skip`,
  or any custom directive is flagged, with `InDirective` set to the directive name.
- **Batched operations.**
  Each operation in a batch is parsed and processed independently,
  so detection applies per operation;
  in enforce mode a single offending operation rejects only that entry (consistent with existing batch error handling).
- **List of literals / partial inline.**
  `field(by: [1,2,3])` is recorded as one inline argument at the argument level.
  An operation that mixes variables and literals
  (`field(a: $a, b: "lit")`) is flagged for `b` only;
  the `paths` list reflects exactly which arguments were inline.
- **Nested object/list path construction.**
  For the log-only mode, paths are built at the argument level (`field.path.argument`);
  deep paths into nested object literals are out of scope for v1 (the argument is reported as a single inline value).
- **Open question: per-argument allowlist.**
  Some operators may want to permit specific arguments (e.g. a constant enum) to remain inline.
  Out of scope for v1; the `InlineArgumentInfo` shape leaves room to add this later.

## 10. Testing Plan

All assertions compare the FULL response body / struct, never substrings.

### graphql-go-tools parser unit tests

In `pkg/astparser` (`parser_test.go`), parse each operation with the detection flag set and assert the full recorded `[]InlineArgumentInfo`; also assert the fail-fast variant returns a parse error on the first inline argument:

- Inline string/int/float/boolean field argument -> recorded.
- Inline enum -> recorded.
- Inline null -> recorded.
- Inline list literal -> recorded (one entry at argument level).
- Inline object literal -> recorded (one entry at argument level).
- Variable argument -> NOT recorded.
- Mixed variable + literal (`field(a: $a, b: "lit")`) -> only `b` recorded.
- `@include(if: true)` / `@skip(if: false)` literal argument -> **recorded**, with `InDirective` set.
- Arbitrary custom-directive literal argument -> **recorded**, with `InDirective` set.
- Inline argument under a node `@skip(if: true)` would remove (`user @skip(if: true) { posts(first: 10) }`) -> **recorded** (`posts.first` and the `@skip.if`) — proves the parser sees it before normalization prunes the node.
- Introspection-field argument (`__type(name: "User")`) -> **recorded**.
- Field inside a fragment definition with an inline argument -> **recorded**.
- Variable-definition default value (`$x: Int = 5`) -> NOT recorded (parsed off the `parseArgumentList` path).
- Detection flag off -> nothing recorded, parse output byte-identical to baseline.

### Router integration tests

Location and shape: a new `router-tests/security/disallow_inline_arguments_test.go`,
package `integration`, alongside `block_operations_test.go` and the other policy tests.
Each case uses the standard harness:

```go
func TestDisallowInlineArguments(t *testing.T) {
    t.Parallel()

    t.Run("enforce rejects inline field argument", func(t *testing.T) {
        t.Parallel()
        testenv.Run(t, &testenv.Config{
            ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
                s.DisallowInlineArguments = config.DisallowInlineArguments{
                    Mode: config.DisallowInlineArgumentsModeEnforcing,
                }
            },
        }, func(t *testing.T, xEnv *testenv.Environment) {
            res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
                Query: `query { employee(id: 1) { id } }`,
            })
            require.NoError(t, err)
            require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
            require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":[{"path":"employee.id","argument":"id","valueKind":"Int"}]}}]}`, res.Body)
        })
    })
}
```

Cases (each via `testenv.Run` + `ModifySecurityConfiguration`, asserting the FULL `res.Body` and `res.Response.StatusCode`):

- **off (baseline)**: inline-bearing query returns the normal success body; no `extensions.inlineArguments`; HTTP 200.
- **enforce, inline field argument**: HTTP = configured status (default 400); body equals the exact § 6.1 error body.
- **enforce, inline `@include`/`@skip` argument** (`field @include(if: true)`): rejected; `inlineArguments[].path` records the directive (e.g. `field.@include.if`).
- **enforce, inline argument under a skipped node** (`user @skip(if: true) { posts(first: 10) }`): rejected; both `posts.first` and `@skip.if` reported — proves pre-normalization detection.
- **enforce, introspection** (`__type(name: "User")`): rejected.
- **enforce, compliant operation (variables only)**: passes through; full success body unchanged; HTTP 200.
- **non-enforce**: HTTP 200; body equals data plus the exact § 6.2 `extensions.inlineArguments` block; assert the Warn log line via the test logger/observer (`testenv` zap observer).
- **persisted operation, default (exempt)**: register a persisted op containing an inline argument, execute it by hash in enforce mode; asserts it executes normally (HTTP 200, success body) — not rejected.
- **persisted operation, `include_persisted_operations: true`**: same persisted op; asserts it is now rejected with the § 6.1 body.
- **custom config**: override `enforce_http_status_code`, `error_code`, `error_message`; assert the response reflects the overrides exactly.
- **mode matrix**: table-drive `off` / `enabled-non-enforcing` / `enabled-enforcing` against the same inline-bearing query, asserting status + full body per mode.

Per the project test convention, every assertion compares the FULL response body with `require.Equal`, never a substring.

## 11. Alternatives Considered

- **Approach B — a dedicated argument visitor over the parsed operation, run after `Parse()`** (the documented fallback).
  A fresh `astvisitor.Walker` with one `RegisterEnterArgumentVisitor`, run on `operationKit.kit.doc`
  between `Parse()` (`graphql_prehandler.go:687`) and `NormalizeOperation()` (`:830`).
  Sees the same fully un-normalized operation as the chosen approach (so it flags directive, introspection,
  and skip-removed arguments equally) and rejects before any cache write — but it pays for one extra
  argument walk that the parser approach folds into the parse already happening.
  Its one advantage is isolation: it requires **no change to `pkg/astparser`**, only a new visitor file and
  a prehandler call. Choose this if touching the parser is considered too invasive;
  it also gives ancestor-based paths for free (no manual name stack). The trade is the extra traversal.
- **Approach C — piggyback the static-normalization `cleanup` walk.**
  Adds an `EnterArgument` visitor to an existing normalization-stage walker (no extra walk).
  Rejected because by the time the `cleanup` stage runs, the `@skip`/`@include` stage has already
  deleted skipped nodes (`directive_include_skip.go:128-135`), so inline arguments inside those nodes
  are gone — it cannot satisfy "flag arguments that normalization would remove."
- **Approach D — instrument the variable-extraction visitor** (`variables_extraction.go:39`).
  Reuses the exact literal detector, but runs even later (`NormalizeVariables`, `operation_processor.go:953`),
  after node pruning *and* after the normalization cache write.
  Rejected for the same reason as C, plus it cannot reject before polluting the normalization cache.
- **Approach E — `astvalidation` rule.**
  Rejected: validation runs on the post-normalization document (`Validate()` at `operation_processor.go:1059`),
  where literals are already variables and skipped nodes are gone — systematic false negatives;
  it also cannot express the log-only mode (validation is binary pass/fail).
