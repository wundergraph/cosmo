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

Therefore detection runs immediately after `Parse()` (`graphql_prehandler.go:687`) and before any
normalization — a single linear scan of the parsed argument slice (`ast.Document.Arguments`), which at
that point holds every argument the client sent, intact.
This is before the router writes any internal cache, so an enforce-mode rejection short-circuits
without polluting a single cache — see § 4.1 and § 4.3.

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
- Normalizing variable *names*. The same operation shape with different variable names still yields distinct query strings; this policy forces values to be variables but cannot collapse variable-name variance (see § 9). 
- A per-field or per-argument allowlist of "acceptable" inline arguments (out of scope for v1; see Open Questions).

## 4. Detailed Design

### 4.1 Integration point: a direct lookup over the parsed AST

> Review note (PR #2998): an earlier draft proposed instrumenting the parser
> (`parseArgumentList`) or adding a dedicated visitor. Reviewers pushed back —
> the parser approach taxes every parse with a flag check (Noroth), and the
> simplest correct option is just to scan the parsed AST once in the request
> pipeline (jensneuse). This section adopts that direct-lookup approach;
> the parser and visitor variants are retained as alternatives in § 11.

The literal-vs-variable discriminator is trivial in graphql-go-tools v2.4.6.
An argument is inline if `arg.Value.Kind != ast.ValueKindVariable`
(`pkg/ast/ast_argument.go:18-25`, `pkg/ast/ast_value.go`).

The key enabling fact: the parser appends **every** argument it parses — for both fields and
directives — into one flat slice, `ast.Document.Arguments []ast.Argument` (`pkg/ast/ast.go:19`;
populated in `parseArgumentList`, `pkg/astparser/parser.go:439`).
After `Parse()`, that slice is the complete, un-normalized set of arguments the client sent.

#### Recommended approach

After `Parse()`, iterate `o.kit.doc.Arguments` once and check each `Value.Kind`.
No visitor, no walker, no parser change, **no graphql-go-tools change at all** — the entire feature
lives in the router:

```go
// in the router prehandler, immediately after operationKit.Parse(), only when the feature is enabled
for ref := range o.kit.doc.Arguments {
    if o.kit.doc.Arguments[ref].Value.Kind != ast.ValueKindVariable {
        // inline argument found
        // enforce mode: record it and stop the pipeline here
        // log mode: collect and continue
    }
}
```

Why this satisfies every requirement:

- **Flags everything.** Because `doc.Arguments` is the flat parse-time slice, it contains field
  arguments, directive arguments (`@include`/`@skip`/any — they go through the same `parseArgumentList`),
  introspection-field arguments (`__type(name: "User")`), and arguments inside selections that
  `@skip`/`@include` would later normalize out — nothing has been pruned or rewritten yet.
- **Naturally excludes variable-definition defaults.** `$x: Int = 5` is parsed on the
  variable-definition path, not `parseArgumentList`, so its default never lands in `doc.Arguments`.
  The one intended exclusion needs no special-casing.
- **Rejects early, pollutes nothing.** The scan runs right after `Parse()` (`graphql_prehandler.go:687`)
  and before `NormalizeOperation()` (`:830`), so an enforce-mode stop happens before any cache is
  consulted or written (§ 4.3).
- **Cheap, and a true no-op when disabled.** It is a single linear pass over a slice the parser
  already built — no tree traversal, no recursion. When the feature is off, the loop is never entered.
  This directly addresses the reviewer concern that parser-level detection would tax every parse: here
  parsing is untouched, and the only added work is one bounded loop, only when the feature is enabled.

#### What the lookup can and cannot report

The flat slice gives, per offending argument, the data on `ast.Argument` (`ast_argument.go:18-25`):
the argument name (`doc.ArgumentNameString(ref)`) and the source `Position`.
It does **not** carry parent context, so the enclosing field, a dotted path, or "which directive"
are not available from this scan.

This is a deliberate v1 scope decision and it resolves two review points directly:

- **No path/argument duplication (Noroth).** The reported shape is argument-name + value-kind + position
  only — there is no separate dotted `path` field to drift from `argument`. The struct is:

```go
type InlineArgument struct {
    Name      string            // argument name, e.g. "userId"
    ValueKind ast.ValueKind     // e.g. ValueKindString
    Position  position.Position // line/column in the operation as the router parsed it
}
```

- **Positions are accurate (Noroth).** Because the scan runs on the **first** parse of the operation
  text, before any normalization, re-print, or re-parse, the `Position` refers to the operation exactly
  as the client sent it (or, for persisted operations, the stored document) — it is the correct frame
  for telling a developer where to fix their query. Detecting later (post-normalization) is exactly the
  case where positions would drift, which is a further reason to detect here.

Reconstructing enclosing fields or full paths would require a walk (the visitor variant in § 11)
and is deferred; for v1 the source position is what pinpoints the argument for the developer.

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
| Directive arguments | `field @include(if: true)`, `@skip(if: false)` | **Yes** | Directive arguments are parsed through the same `parseArgumentList`, so they land in `doc.Arguments` |
| Introspection-field arguments | `__type(name: "User")` | **Yes** | Introspection-field arguments are ordinary arguments in `doc.Arguments`; not exempt |
| Arguments under a node `@skip`/`@include` would remove | `user @skip(if: true) { posts(first: 10) }` | **Yes** | The scan runs pre-normalization, so the still-present `first: 10` is flagged even though normalization would delete the `user` selection |
| Variable arguments | `userById(userId: $userId)` | No | `ValueKindVariable` — the compliant form |
| Variable-definition default values | `query q($x: Int = 5)` | No | A definition default is not an argument the client passed to a field or directive; it is parsed off the variable-definition path, so it never lands in `doc.Arguments` (see Non-Goals / Open Questions) |

Explicit decisions:

- **Directive and introspection arguments count.**
  The scan applies no context guards — any argument in `doc.Arguments` whose value is not a variable is flagged.
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

Detection is a single scan of `o.kit.doc.Arguments` run **immediately after `Parse()` (line 687)
and before `NormalizeOperation()` (line 830)**. At every later line in the order above, normalization
has already begun rewriting or pruning the operation, so just-after-parse is the only complete view.

```
Parse (687)
  === scan doc.Arguments here (only when the feature is enabled) ===
  === enforce mode: stop the pipeline here, before any cache is consulted or written ===
NormalizeOperation (830)   -> first cache write at :885
NormalizeVariables (855)   -> variables cache
... RemapVariables / Validate / Plan, each with its own cache
```

Persisted-operation gating (checked before the scan):

- A persisted operation is identified by `parsedOperation.IsPersistedOperation`,
  set during `FetchPersistedOperation` (`graphql_prehandler.go:638`, field at `operation_processor.go:75`) —
  before `Parse()` at line 687.
- The scan runs only when `enabled && (!parsedOperation.IsPersistedOperation || includePersistedOperations)`.
- **By default the policy skips persisted operations** — they are stored server-side, so an inline value
  in a persisted operation was an intentional, pre-vetted choice; the operation executes normally.
- With `include_persisted_operations: true` (§ 5), persisted operations are scanned too,
  and treated identically to dynamic ones.

Enforce mode:

- The scan stops at the first inline argument and the prehandler returns an `*inlineArgumentsError`
  (a typed error like the existing `reportError`) right there, before `NormalizeOperation()`.
  Because this is before the normalization-cache consult/write (`:819`/`:885`),
  before `NormalizeVariables`, `RemapVariables`, `Validate`, `ValidateStaticCost`, complexity, and planning,
  **no internal cache is consulted or written for the rejected operation** — the request stops at the
  earliest possible boundary, by construction.
- The prehandler maps `*inlineArgumentsError` to the configured HTTP status, `extensions.code`, and message.

Log-only / annotate mode:

- The scan collects all inline arguments (no early stop); the operation is valid and proceeds through
  the normal pipeline (and is cached normally).
  The result is stored on `parsedOperation` (`HadInlineArguments bool`, `InlineArguments []InlineArgument`),
  and the prehandler emits the Warn log line and attaches the `extensions` annotation after resolve.

Threading (config side):

- Config flows from the new `SecurityConfiguration` sub-block -> `OperationProcessorOptions` (`operation_processor.go:109-133`)
  -> `OperationProcessor` (`operation_processor.go:137-150`),
  initialized in `NewOperationProcessor` (`operation_processor.go:1539`),
  consistent with how existing operation-processing limits are threaded.
  When `mode == off`, the scan is never entered — there is no added per-request work and no change to parsing.

#### Why detection is intentionally not cached

The scan runs on the freshly parsed document, which exists on every request regardless of downstream
cache state, so there is no cache-hit gap to close (unlike a normalization-stage byproduct, which would
go silent on a hit). Rejected operations are never inserted into any cache.
The work is a single linear pass over an existing slice; there is nothing to memoize.

### 4.4 The three modes

- **off** (default): the scan is never entered; parsing is unchanged; zero added work.
- **enabled-non-enforcing**: after `Parse()` (line 687) the scan collects all inline arguments without stopping; the prehandler logs a structured Warn line and attaches an `extensions` annotation to the otherwise-successful response.
- **enabled-enforcing**: the scan stops at the first inline argument and the prehandler rejects before `NormalizeOperation()` (line 830) and before any cache is consulted or written, returning a GraphQL error with the configured `extensions.code` and HTTP status code. No internal cache is touched for the rejected operation.

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

The scan finds inline args, the request is short-circuited before `NormalizeOperation()`,
and a GraphQL error is returned via `NewHttpGraphqlError(message, code, statusCode)`
(`http_graphql_error.go:22-28`), written through `writeOperationError()` (`errors.go:361-433`).
HTTP status is the configured `enforce_http_status_code` (default 400).

Each reported argument carries its name, value kind, and source position (line/column in the operation
as the router parsed it). There is no dotted `path` field — the flat scan has no parent context (§ 4.1);
the position is what locates the argument for the developer.

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
            "argument": "userId",
            "valueKind": "String",
            "line": 2,
            "column": 14
          }
        ]
      }
    }
  ]
}
```

### 6.2 Non-Enforce (`enabled-non-enforcing`)

The operation succeeds (HTTP 200).
The result carries an `extensions` annotation that lists the offending arguments and a migration hint,
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
          "argument": "userId",
          "valueKind": "String",
          "line": 2,
          "column": 14
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
  arguments=["userId"]
  operation_name="GetUserById"
  operation_hash=12345678901234567890
  client_name="web"
  client_version="1.4.2"
```

### 6.3 Off (`off`, default)

The scan is never entered, so the request path behaves exactly as today.
Complete no-op.

## 7. Migration Strategy

The rollout path is `off` -> `enabled-non-enforcing` -> `enabled-enforcing`.

1. **off (baseline).**
   No behavior change.
2. **enabled-non-enforcing (discovery).**
   Operators turn this on with `logging.enabled: true`.
   Every request that uses inline args produces a structured Warn log
   (`operation_name`, `operation_hash`, `client_name`, `client_version`, `arguments`)
   and an `extensions.inlineArguments` block in the response.
   Operators discover affected clients three ways:
   logs (filter on the message / argument fields),
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
- `arguments` (`zap.Strings`) — argument names that were inline (no enclosing path; see § 4.1).
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
  Directive arguments are in scope: an inline value on `@defer`, `@include`, `@skip`, or any custom
  directive is flagged, because directive arguments land in `doc.Arguments` like field arguments.
  The flat scan does not record *which* directive an argument belongs to (no parent context);
  reporting that would require a walk (§ 11) and is out of scope for v1.
- **Variable-name variance is out of scope (cannot be prevented).**
  Reviewers (Noroth, jensneuse on PR #2998) noted that the same operation shape can still produce
  distinct query strings via different *variable names*
  (`userById(userId: $userId1)` vs `userById(userId: $userId2)`).
  This policy only forces values to be variables; it does not, and cannot, normalize variable names —
  `jensneuse: "we cannot prevent this"`. It is explicitly not a goal; cardinality from variable-name
  variance is the client's responsibility (or a separate normalization concern).
- **Multi-operation documents.**
  The scan covers `doc.Arguments`, which includes every operation and fragment in the request document,
  not only the operation selected by `operationName`.
  For the common single-operation request this is exactly right; for a multi-operation document it means
  an inline argument in a non-executed operation is also flagged.
  Scoping strictly to the selected operation would require post-normalization (which removes the others)
  or a walk; treating any inline argument in the document as a violation is the v1 behavior.
- **Batched operations.**
  Each operation in a batch is parsed and processed independently,
  so detection applies per operation;
  in enforce mode a single offending operation rejects only that entry (consistent with existing batch error handling).
- **List of literals / partial inline.**
  `field(by: [1,2,3])` is recorded as one inline argument at the argument level.
  An operation that mixes variables and literals
  (`field(a: $a, b: "lit")`) is flagged for `b` only;
  the reported list reflects exactly which arguments were inline.
- **Nested object/list values.**
  A list or object literal argument is reported once at the argument level
  (`ValueKindList` / `ValueKindObject`); the scan does not descend into nested values.
- **Open question: enclosing-field / path reporting.**
  The flat scan reports argument name + value kind + position, not the enclosing field or a path.
  If reviewers want richer location info in the error/hint, the visitor variant (§ 11) provides it
  at the cost of one extra walk. Open for decision.
- **Open question: per-argument allowlist.**
  Some operators may want to permit specific arguments (e.g. a constant enum) to remain inline.
  Out of scope for v1; the `InlineArgument` shape leaves room to add this later.

## 10. Testing Plan

All assertions compare the FULL response body / struct, never substrings.

### Detector unit tests (router package)

The detector is a router-local function (`detectInlineArguments(doc *ast.Document) []InlineArgument`) — there is no graphql-go-tools change to test.
Table-driven tests parse a query with the router parser, run the detector, and assert the full `[]InlineArgument` slice (name + value kind + position):

- Inline string/int/float/boolean field argument -> recorded.
- Inline enum -> recorded.
- Inline null -> recorded.
- Inline list literal -> recorded (one entry at argument level).
- Inline object literal -> recorded (one entry at argument level).
- Variable argument -> NOT recorded.
- Mixed variable + literal (`field(a: $a, b: "lit")`) -> only `b` recorded.
- `@include(if: true)` / `@skip(if: false)` literal argument -> **recorded** (lands in `doc.Arguments`).
- Arbitrary custom-directive literal argument -> **recorded**.
- Inline argument under a node `@skip(if: true)` would remove (`user @skip(if: true) { posts(first: 10) }`) -> **recorded** (`first`, plus the `@skip` `if`) — proves the scan runs before normalization prunes the node.
- Introspection-field argument (`__type(name: "User")`) -> **recorded**.
- Field inside a fragment definition with an inline argument -> **recorded**.
- Variable-definition default value (`$x: Int = 5`) -> NOT recorded (never enters `doc.Arguments`).
- Positions: assert the recorded `line`/`column` match the original query text.
- Empty result when there are no inline arguments (all variables).

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
            require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":[{"argument":"id","valueKind":"Int","line":1,"column":18}]}}]}`, res.Body)
        })
    })
}
```

Cases (each via `testenv.Run` + `ModifySecurityConfiguration`, asserting the FULL `res.Body` and `res.Response.StatusCode`):

- **off (baseline)**: inline-bearing query returns the normal success body; no `extensions.inlineArguments`; HTTP 200.
- **enforce, inline field argument**: HTTP = configured status (default 400); body equals the exact § 6.1 error body.
- **enforce, inline `@include`/`@skip` argument** (`field @include(if: true)`): rejected; the `if` argument is reported.
- **enforce, inline argument under a skipped node** (`user @skip(if: true) { posts(first: 10) }`): rejected; the `first` and `if` arguments are reported — proves pre-normalization detection.
- **enforce, introspection** (`__type(name: "User")`): rejected.
- **enforce, compliant operation (variables only)**: passes through; full success body unchanged; HTTP 200.
- **non-enforce**: HTTP 200; body equals data plus the exact § 6.2 `extensions.inlineArguments` block; assert the Warn log line via the test logger/observer (`testenv` zap observer).
- **persisted operation, default (exempt)**: register a persisted op containing an inline argument, execute it by hash in enforce mode; asserts it executes normally (HTTP 200, success body) — not rejected.
- **persisted operation, `include_persisted_operations: true`**: same persisted op; asserts it is now rejected with the § 6.1 body.
- **custom config**: override `enforce_http_status_code`, `error_code`, `error_message`; assert the response reflects the overrides exactly.
- **mode matrix**: table-drive `off` / `enabled-non-enforcing` / `enabled-enforcing` against the same inline-bearing query, asserting status + full body per mode.

Per the project test convention, every assertion compares the FULL response body with `require.Equal`, never a substring.

- **Approach B — a dedicated argument visitor over the parsed operation, run after `Parse()`** (the richer-info fallback).
  A fresh `astvisitor.Walker` with one `RegisterEnterArgumentVisitor`, run on `operationKit.kit.doc`
  between `Parse()` (`graphql_prehandler.go:687`) and `NormalizeOperation()` (`:830`).
  Sees the same un-normalized operation as the chosen scan and rejects before any cache write, but pays for
  one extra argument walk. Its one advantage over the flat scan: an `Ancestors` stack, so it can report the
  enclosing field, a dotted path, and which directive an argument belongs to.
  This is the upgrade path if reviewers decide the error/hint needs more than argument-name + position
  (§ 9 open question).
- **Approach C — instrument the parser** (`pkg/astparser` `parseArgumentList`).
  Record inline arguments during parsing itself, with an opt-in `reportInlineArguments` flag.
  Zero extra walk and the earliest possible point. **Rejected on review (Noroth, PR #2998):** it taxes the
  hottest code path with a per-argument flag check on every parse (including when the feature is off), and
  the same un-normalized AST is available one step later via the flat `doc.Arguments` scan with no parser
  change. The chosen approach gets the same coverage without touching `pkg/astparser`.
- **Approach D — reuse / add a validation walker** (Noroth / @devsergiy suggestion, PR #2998).
  Reuse an existing validation pass (`astvalidation`) or add a rule rather than write new detection code.
  Rejected because validation runs on the *post-normalization* document
  (`Validate()` at `operation_processor.go:1059`), where literals are already variables and `@skip`/`@include`
  nodes are gone — systematic false negatives — and it cannot express the log-only mode (validation is
  binary pass/fail). The intent (don't add bespoke machinery) is honored more directly by the flat scan,
  which is a few lines over an existing slice and adds no walker at all.
- **Approach E — piggyback the static-normalization `cleanup` walk.**
  Adds an `EnterArgument` visitor to an existing normalization-stage walker (no extra walk).
  Rejected because by the time the `cleanup` stage runs, the `@skip`/`@include` stage has already
  deleted skipped nodes (`directive_include_skip.go:128-135`), so inline arguments inside those nodes
  are gone.
- **Approach F — instrument the variable-extraction visitor** (`variables_extraction.go:39`).
  Reuses the exact literal detector, but runs even later (`NormalizeVariables`, `operation_processor.go:953`),
  after node pruning *and* after the normalization cache write.
  Rejected for the same reason as E, plus it cannot reject before polluting the normalization cache.
