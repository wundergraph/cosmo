# Persisted GraphQL Operations: Compact TypeScript API for LLM Agents

**Status:** Draft v3
**Owner:** Router team
**Implementation:** Go (Cosmo router)

**Changes from v2:** Added required-paths semantics via `@require` directive
and runtime `opRequire` helper (§4.4). Updated Go implementation (§6) to use
the actual `graphql-go-tools/v2` AST API surface (flat-array, ref-based)
verified against pkg.go.dev rather than the pointer-based `gqlparser`-style
API assumed in v2.

**Changes from v1:** Added shared-type extraction policy (§3.8) and append-only
delivery model via interface declaration merging (§4.3). Storage and Go API
updated accordingly.

## 1. Goal

Expose persisted GraphQL operations to an LLM-driven runtime as a strongly-typed
TypeScript API. The model receives an extremely compact, TypeScript-native
description of every operation (variables in, response out) and writes
TypeScript that calls each operation by hash, then aggregates/combines results.

Constraints:

1. **Compact** — every operation should cost as few tokens as possible in the
   model's context window.
2. **One-shot accurate** — the model must write correct calls without iteration.
   That means the format must be unambiguous about required vs. optional fields,
   nullability, list cardinality, and union variants.
3. **Generated at persistence time** — when the router accepts a persisted
   operation, the Go code emits the TS signature and stores it alongside the
   hash. No runtime reflection.

Non-goals:

- Generating client-side data fetching code (that's the runtime's job).
- Replacing the GraphQL schema for human consumers.
- Supporting ad-hoc queries (only persisted ones).

## 2. High-level design

```
                       ┌─────────────────────────────┐
   persist request ──▶ │  Router (Go)                │
   { query, hash }     │                             │
                       │  1. Parse op (gqlparser)    │
                       │  2. Validate vs schema      │
                       │  3. Generate TS signature   │──▶ store: hash → { op, signature }
                       │  4. Generate TS bundle      │
                       └─────────────────────────────┘
                                     │
                                     ▼
                       agent context ◀── compact .d.ts bundle
                                     │
                                     ▼
                       agent writes TS calling op("<hash>", vars)
```

The router owns three artifacts per operation:

| Artifact | Purpose | Storage |
|---|---|---|
| Original GraphQL document | Execution at runtime | existing persisted-ops store |
| Compact TS signature | LLM context | new column / KV entry |
| Operation metadata (hash, name, kind) | Routing & telemetry | existing |

## 3. The TypeScript surface

### 3.1 The runtime API the model calls

```ts
// Provided to the agent. The agent does NOT implement this.
declare function op<H extends keyof Ops>(
  hash: H,
  vars: Ops[H]["vars"],
): Promise<Ops[H]["data"]>;
```

The model is told: *"Call `op(hash, vars)` to execute a persisted operation.
Hashes and their input/output shapes are listed below. Combine results in plain
TypeScript."*

### 3.2 The signature format (per operation)

Each operation gets exactly one TS block. The format is a single entry in an
`Ops` interface, keyed by hash:

```ts
interface Ops {
  // getUserOrders — query
  "a3f9c1": {
    vars: { userId: string; limit?: number; status?: "PENDING"|"SHIPPED"|"DELIVERED" };
    data: { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } | null };
  };
  // createOrder — mutation
  "b71e08": {
    vars: { input: { userId: string; items: { sku: string; qty: number }[] } };
    data: { createOrder: { id: string; total: number } };
  };
}
```

This is the canonical, on-the-wire format that gets injected into the model's
context. Rationale:

- **Indexed by hash literal** — the model uses string-literal types to autocomplete
  against `op("a3f9c1", …)` and the call site is type-checked end-to-end.
- **`vars` and `data` are siblings** — the model sees inputs and outputs in one
  glance per operation.
- **No imports, no type aliases unless reused** — keeps each entry self-contained.
- **One line per operation when feasible** — whitespace is optional in TS, so
  the formatter strips it; the model still reads it fine.

### 3.3 Type mapping rules (GraphQL → TS)

| GraphQL | TypeScript |
|---|---|
| `String`, `ID` | `string` |
| `Int`, `Float` | `number` |
| `Boolean` | `boolean` |
| Custom scalar `X` | `string` by default; configurable via scalar map (e.g. `DateTime` → `string`, `JSON` → `unknown`, `BigInt` → `string`) |
| `T!` (non-null) | `T` |
| `T` (nullable) | `T \| null` |
| `[T!]!` | `T[]` |
| `[T]!` | `(T \| null)[]` |
| `[T!]` | `T[] \| null` |
| `[T]` | `(T \| null)[] \| null` |
| `enum E { A B }` | `"A"\|"B"` (inlined at use site) |
| Input object | inline `{ ... }` |
| Output object | inline `{ ... }` shaped to the **selection set**, not the schema type |
| Interface / Union with selection | discriminated union via `__typename` |

**Critical:** the response shape reflects the *selection set of this specific
operation*, not the GraphQL type. If `User` has 30 fields and the operation
selects 3, only those 3 appear. This is what makes the format compact.

### 3.4 Selection-set example

GraphQL operation:

```graphql
query getUserOrders($userId: ID!, $limit: Int = 10, $status: OrderStatus) {
  user(id: $userId) {
    id
    name
    orders(first: $limit, status: $status) {
      id
      total
      items { sku qty }
    }
  }
}
```

Schema fragment:

```graphql
type User { id: ID! name: String! email: String! orders(first: Int, status: OrderStatus): [Order!]! ... }
type Order { id: ID! total: Float! items: [OrderItem!]! ... }
enum OrderStatus { PENDING SHIPPED DELIVERED }
```

Generated TS entry:

```ts
"a3f9c1": {
  vars: { userId: string; limit?: number; status?: "PENDING"|"SHIPPED"|"DELIVERED"|null };
  data: { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } | null };
};
```

Note:

- `email` is omitted (not selected).
- `limit` is optional because it has a default value.
- `status` is optional and nullable (no default, no `!`).
- `user` is nullable (assuming the schema declares it nullable).
- `orders` is a non-null list of non-null `Order` (`[Order!]!` → `Order[]`).

### 3.5 Interfaces and unions

For abstract types in the selection set, emit a discriminated union keyed on
`__typename`. The router **must** ensure `__typename` is added to the executed
query (or selection in the runtime layer) for any selection on an interface or
union, even if the original operation didn't request it. The compact signature
always exposes `__typename` as a string-literal discriminator.

```graphql
query search($q: String!) {
  search(q: $q) { __typename ... on User { id name } ... on Org { id slug } }
}
```

```ts
"c4d2a0": {
  vars: { q: string };
  data: { search: ({ __typename: "User"; id: string; name: string } | { __typename: "Org"; id: string; slug: string })[] };
};
```

### 3.6 Fragment handling

Fragments are inlined into the selection set. Named fragments are not preserved
as separate types — flattening is more compact and avoids naming collisions
across operations. If a fragment is reused inside a single operation (rare),
inline at each spread; the cost is negligible at typical operation sizes and
keeps each entry self-contained.

### 3.7 Scalar mapping configuration

The router exposes a scalar map in its config:

```yaml
persisted_ops:
  ts_signatures:
    enabled: true
    scalars:
      DateTime: string
      Date: string
      JSON: unknown
      BigInt: string
      UUID: string
    # If unset, custom scalars default to `string` and a warning is logged.
```

### 3.8 Shared types: when to inline, when to extract

Inlining keeps each operation entry self-contained, which matters for per-op
delivery (§4.2) and for the append model (§4.3): an entry must be valid in
isolation. But inlining duplicates content. The formatter applies a tiered
extraction policy that preserves entry-self-containment while removing the
worst duplication.

#### Tier 1 — Enums: extract on first reuse

Enums are the strongest case for extraction. They have a stable, schema-derived
name; their literal-union form is verbose (`"PENDING"|"SHIPPED"|"DELIVERED"`
≈ 30 chars); and they typically recur across operations. Once an enum appears
in **two or more** operations in the bundle, it is hoisted:

```ts
type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";
```

…and referenced by name in entries:

```ts
"a3f9c1": { vars: { userId: string; limit?: number; status?: OrderStatus|null }; data: ... };
```

Enum names mirror the GraphQL schema name verbatim. Single-use enums stay
inlined.

#### Tier 2 — Input objects: extract on first reuse

GraphQL input objects are also schema-named, so reuse detection is reliable:
two variable references to `OrderInput` always have identical TS shapes.
Same threshold as enums (≥2 uses), same hoisting strategy:

```ts
type OrderInput = { userId: string; items: { sku: string; qty: number }[] };
```

If the input object itself contains nested input objects, recursion applies —
nested inputs are extracted on their own merit (≥2 uses across the bundle),
not transitively.

#### Tier 3 — Output object shapes: do NOT extract by default

Output shapes look extractable but aren't, because the shape depends on the
*selection set*, not the schema type. Two operations selecting `User` rarely
select identical fields, and even when they do, declaring shared output types
introduces three failure modes:

1. **False sharing on coincidental match.** Two ops happen to select the same
   fields today; tomorrow one adds `email` and they diverge. The signature now
   needs to either invalidate a shared type (cascading regeneration) or rename
   on divergence (model now sees two near-identical names and may pick wrong).
2. **Aliases break structural identity.** `id name` and `id name: displayName`
   are not the same TS shape.
3. **Naming.** There is no schema-given name for an output selection set. We
   would have to invent one (`User_a3f9c1`, `User_orders_items`), which both
   bloats the bundle and confuses the model.

Default: output shapes are always inlined. An optional config flag
`extract_output_shapes: true` enables structural extraction for shapes that
appear identically (same fields, same aliases, same nullability, same nested
shapes) in **three or more** entries. Names are content-addressed:
`Shape_<8charSha>`. Off by default; turn on only after measuring bundle size
on a real corpus.

#### Tier 4 — Discriminated-union branches: never extracted

Each `__typename`-tagged branch is small and deeply coupled to its parent
union. Extraction provides little savings and hurts readability for the model.

#### Effect on append (§4.3)

Extraction is **scoped to the bundle being delivered to the agent**, not to
the global persisted-op store. Adding a new operation to the bundle may
promote a previously-inlined enum to extracted form, but it does not retro-
actively rewrite stored signatures. See §4.3 for how this plays with append
semantics.

#### Worked example

Without extraction (3 ops using `OrderStatus`, 2 using `OrderInput`):

```ts
"a3f9c1": { vars: { ...; status?: "PENDING"|"SHIPPED"|"DELIVERED"|null }; ... };
"d8e211": { vars: { ...; status: "PENDING"|"SHIPPED"|"DELIVERED" }; ... };
"f02c4a": { vars: { ...; status: "PENDING"|"SHIPPED"|"DELIVERED"|null }; ... };
"b71e08": { vars: { input: { userId: string; items: { sku: string; qty: number }[] } }; ... };
"e3a991": { vars: { input: { userId: string; items: { sku: string; qty: number }[] } }; ... };
```

With extraction:

```ts
type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";
type OrderInput = { userId: string; items: { sku: string; qty: number }[] };

"a3f9c1": { vars: { ...; status?: OrderStatus|null }; ... };
"d8e211": { vars: { ...; status: OrderStatus }; ... };
"f02c4a": { vars: { ...; status: OrderStatus|null }; ... };
"b71e08": { vars: { input: OrderInput }; ... };
"e3a991": { vars: { input: OrderInput }; ... };
```

Token savings scale roughly linearly with the number of reuses past the first.

## 4. Wire format delivered to the model

Three representations. §4.1 (bundle) is recommended for a fixed agent context.
§4.2 (per-op) is for selective retrieval. §4.3 (append chunks) is the format
delivered when operations are added incrementally during a long-running agent
session.

### 4.1 Bundle form

A single `.d.ts` blob containing all operations the agent has access to at the
moment the bundle was assembled:

```ts
// Persisted operations — call via op(hash, vars).
// New operations may be appended later as additional `interface Ops` blocks.
declare function op<H extends keyof Ops>(hash: H, vars: Ops[H]["vars"]): Promise<Ops[H]["data"]>;

// Shared schema types (extracted per §3.8)
type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";
type OrderInput = { userId: string; items: { sku: string; qty: number }[] };

interface Ops {
  // getUserOrders — query
  "a3f9c1": { vars: { userId: string; limit?: number; status?: OrderStatus|null }; data: { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } | null } };
  // createOrder — mutation
  "b71e08": { vars: { input: OrderInput }; data: { createOrder: { id: string; total: number } } };
  // search — query
  "c4d2a0": { vars: { q: string }; data: { search: ({ __typename: "User"; id: string; name: string } | { __typename: "Org"; id: string; slug: string })[] } };
}
```

Pros: types resolve, autocomplete works in any TS-aware sandbox the agent runs
in, single round-trip into context.

### 4.2 Per-operation form

Used when the agent retrieves operations on demand (RAG-style):

```ts
// op:a3f9c1 — getUserOrders
(v: { userId: string; limit?: number; status?: "PENDING"|"SHIPPED"|"DELIVERED"|null }) =>
  { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } | null }
```

Per-op form **always inlines** shared types (enums and input objects).
Self-containment is the whole point of this format — extracting would force
the agent to fetch additional context just to interpret a signature.

### 4.3 Append form: incremental delivery

When the agent's session is long-lived and new operations get persisted while
the agent is running, the runtime needs a format that **adds** entries to the
existing `Ops` interface without resending what the model has already seen.

TypeScript supports this natively via **interface declaration merging**: any
two `interface Ops { ... }` declarations in the same scope are merged by the
type-checker. The model — which has been trained on enormous amounts of
TypeScript — already knows this. We exploit it.

The very first delivery contains the function declaration, any extracted
shared types, and the initial `interface Ops` block:

```ts
// === persisted ops bundle (initial) ===
declare function op<H extends keyof Ops>(hash: H, vars: Ops[H]["vars"]): Promise<Ops[H]["data"]>;

type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";

interface Ops {
  "a3f9c1": { vars: { userId: string }; data: { user: { id: string; name: string } | null } };
  "b71e08": { vars: { input: { userId: string; items: { sku: string; qty: number }[] } }; data: { createOrder: { id: string; total: number } } };
}
```

Subsequent appends contain only the new entries:

```ts
// === persisted ops bundle (append @ 2026-04-26T14:22Z) ===
// These declarations merge with the existing `Ops` interface.
interface Ops {
  "c4d2a0": { vars: { q: string }; data: { search: ({ __typename: "User"; id: string; name: string } | { __typename: "Org"; id: string; slug: string })[] } };
  "d8e211": { vars: { userId: string; status: OrderStatus }; data: { ordersByStatus: { id: string }[] } };
}
```

After both deliveries, the model's effective view is the union of all entries
and `op("a3f9c1" | "b71e08" | "c4d2a0" | "d8e211", …)` is fully type-safe.

#### Why this works for the model

The append form encodes the invariant in the language itself, not in prose:

1. **Append, never replace.** The format never reissues `interface Ops` with
   a *different* set of entries; it only emits new entries inside a fresh
   `interface Ops` block. There is no syntactic operation in this format that
   could be read as "remove" or "replace."
2. **Merging is a TS feature the model knows.** No prose explanation needed
   beyond the one-line comment on each chunk. The model has seen this pattern
   thousands of times in `.d.ts` files for libraries that use module
   augmentation.
3. **Hashes are unique and stable.** A given hash maps to exactly one
   operation forever. An entry for an existing hash will never appear in an
   append chunk; if it did, TS would error on duplicate property declarations
   in merged interfaces, which is exactly the right outcome.
4. **Shared-type promotion is monotone-additive.** When a new append would
   promote a previously-inlined enum to a shared type, we do **not** rewrite
   prior entries (that would violate append-only). Instead the new entry uses
   the inlined form too, OR — preferred — the formatter pre-extracts every
   enum and input object that is *known to the schema* in the very first
   bundle, regardless of usage count. See §3.8 amendment below.

#### Amendment to §3.8 for append-mode bundles

When `delivery_mode: append` is configured, Tier 1 and Tier 2 extraction
threshold drops from "≥2 uses" to "any schema enum/input that *could* be used
by future operations." In practice this means the initial bundle ships type
aliases for all enums and input objects in the federated schema (typically
small — tens to low hundreds of names — and far smaller than re-inlining
across many ops). Append chunks then reference those names freely without
risk of needing to retroactively extract.

If the schema itself changes (a new enum is added), an append chunk MAY
introduce new `type` aliases at its top:

```ts
// === persisted ops bundle (append @ ...) ===
type PaymentMethod = "CARD"|"BANK"|"CRYPTO"; // new in schema rev 47
interface Ops {
  "f9a012": { vars: { method: PaymentMethod }; data: { ... } };
}
```

This is still strictly additive — old entries are unaffected.

#### Idempotency and resends

If the runtime is uncertain whether the agent received a particular append
chunk (e.g. context truncation, session restart), it MAY resend the same
chunk verbatim. This is safe in two ways:

1. The `Ops` interface re-merge produces an identical type — TS does not
   error on duplicate *identical* property declarations across merged
   interfaces, only on conflicting ones.
2. Each chunk header carries a monotonic sequence number and timestamp:
   `// === persisted ops bundle (append #N @ <iso8601>) ===`. The runtime
   tracks the highest N delivered per session and can deduplicate at the
   delivery layer rather than relying on TS semantics.

#### What the model is told (system-prompt fragment)

A short, fixed instruction accompanies the first bundle:

> The `Ops` interface lists persisted GraphQL operations you can call via
> `op(hash, vars)`. Additional operations may be added later as new
> `interface Ops { ... }` blocks; TypeScript merges them automatically.
> Operations are never removed and existing entries never change. If a hash
> is not in `Ops`, you cannot call it — ask for it to be persisted.
>
> Both `op` and `opRequire(hash, vars, requiredPaths)` may reject with
> `{ code: "REQUIRED_FIELD_NULL", path }` when an annotated or
> caller-required field is null. Treat this as a hard failure unless you
> have a specific fallback plan.

That's the entire prose budget for explaining append semantics. The format
does the rest.

### 4.4 Required paths: failing fast instead of null-checking

GraphQL nullability is pessimistic by default. A field selected as nullable
yields a `T | null` in the generated TS, which the agent must null-check at
every level. For deeply nested selections this means 3-5 null checks before
the agent reaches the data it actually wanted, and the model sometimes gets
this wrong — either by skipping checks (runtime error) or by producing
spurious "data not available" branches that never trigger.

The agent often does not want to handle "the data wasn't there" gracefully.
It wants the operation to fail loudly so a higher layer (retry, fallback to a
different op, escalate) handles it. Two mechanisms are provided.

#### 4.4.1 `@require` directive at persist time (preferred)

The operation author can annotate fields whose absence should turn the entire
response into an error. The router accepts a custom directive `@require` on
any field selection:

```graphql
query getUserOrders($userId: ID!) {
  user(id: $userId) @require {
    id
    name
    orders @require {
      id
      total
      items { sku qty }   # items themselves not required
    }
  }
}
```

Semantics:

- A `@require` annotation on a field means: if this field resolves to `null`
  at runtime, the entire `op(...)` call rejects with a structured error
  (`{ code: "REQUIRED_FIELD_NULL", path: "user.orders" }`).
- The annotation has no effect on the wire-format request to upstream
  subgraphs. It is enforced at the router's response-shaping layer.
- The annotation propagates into the generated TS signature: any `@require`d
  field becomes non-null in the TS shape, removing the corresponding
  `| null`. The agent never sees the null branch.
- For lists, `@require` on the list field means the list itself is non-null
  (but elements may still be null per their own type). To require non-null
  elements, the schema must already declare `[T!]`. We deliberately do not
  introduce element-level requireness — keeps the model's mental model
  simple.

Generated TS for the example above (assuming `user`, `orders` are nullable
in the schema):

```ts
"a3f9c1": {
  vars: { userId: string };
  data: { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } };
  // note: no `| null` on user or orders; they're @require'd
};
```

The agent writes:

```ts
const { user } = await op("a3f9c1", { userId: "u_42" });
// user is { id, name, orders } — no null check needed
const totals = user.orders.map(o => o.total);
```

If at runtime `user` resolves to null, the `await` throws. The agent's
top-level `try/catch` (or the runtime's error reporter) handles it.

#### 4.4.2 Runtime require helper for ad-hoc cases

Sometimes the agent wants stricter guarantees than the operation declared —
e.g. an operation has nullable `user.email` and the agent's task only makes
sense with an email. We expose a wrapper:

```ts
declare function opRequire<H extends keyof Ops, P extends Path<Ops[H]["data"]>[]>(
  hash: H,
  vars: Ops[H]["vars"],
  required: P,
): Promise<Required<Ops[H]["data"], P>>;
```

`Path` and `Required` are utility types shipped in the bundle preamble. They
are deliberately small:

```ts
// shipped once in the bundle header
type Path<T> = string;  // see note below
type Required<T, P extends string[]> = T;  // narrows null away on listed paths
```

**A pragmatic note on the type-level implementation.** A fully-correct
`Path<T>` and `Required<T, P>` using TypeScript template literal types is
possible but verbose (≈30 lines of utility types) and produces large compiler
errors when paths are wrong. We ship the simple version above by default —
`Path<T>` is just `string` — and accept that path strings are not
type-checked. The runtime layer validates paths against the response shape
and throws on typos. For agent runtimes that have the budget to ship the
full template-literal version, it is provided as an optional bundle preamble
(see §9 `strict_path_types`).

Usage:

```ts
const { user } = await opRequire(
  "a3f9c1",
  { userId: "u_42" },
  ["user", "user.email"]
);
// user is non-null, user.email is non-null
```

If any required path resolves to null/undefined at runtime, `opRequire`
rejects with `{ code: "REQUIRED_FIELD_NULL", path: "user.email" }`.

#### 4.4.3 Path syntax

A path is a dotted string identifying a field in the response shape:

| Path | Meaning |
|---|---|
| `user` | the `user` field |
| `user.name` | `user`'s `name` field |
| `user.orders` | the `orders` list itself (must be non-null) |
| `user.orders[]` | every element of the list (each element must be non-null) |
| `user.orders[].id` | every element's `id` (each `id` must be non-null) |
| `user.orders[0].id` | the first element's `id` only |

Wildcards (`[]`) require the corresponding list to be non-empty if used —
otherwise there is nothing to require. To allow empty lists while still
requiring element fields, use `user.orders[]?.id` (the `?` after `[]` opts
into "empty list is fine"). This is the only piece of syntax the agent has
to learn beyond regular dotted paths.

#### 4.4.4 Choosing between `@require` and `opRequire`

| Use `@require` | Use `opRequire` |
|---|---|
| The operation has a single dominant use case where these fields are always needed | The operation is reused across contexts with different requirements |
| You want the requirement to be visible to all callers | The requirement is specific to one task |
| You're persisting the operation yourself | You're a downstream consumer |

The router's persisted-op accept path **does not** force the author to pick
one. Both can coexist on the same operation; `opRequire` paths add to the
`@require`'d set at runtime.

#### 4.4.5 Error shape

When a required field is null, the rejected promise carries:

```ts
type RequiredFieldNullError = {
  code: "REQUIRED_FIELD_NULL";
  path: string;          // dotted path to the null field
  hash: string;          // op hash that was called
  message: string;       // human-readable
  upstreamErrors?: unknown[]; // GraphQL errors from subgraphs, if any
};
```

The model is told (one line in the system prompt fragment) that `op` and
`opRequire` may reject with this shape, and that catching and re-raising is
usually the right move unless the agent has a specific fallback strategy.

## 5. Compactness rules

The Go formatter MUST apply these in order:

1. **Strip insignificant whitespace.** Single space after `:` and `;` for
   readability of small blocks; no indentation; no trailing spaces. Newlines
   only between top-level operation entries.
2. **Inline all object types.** No `type X = ...` extraction.
   *Exception:* if a type appears 3+ times within a single operation entry and
   is ≥4 fields, extract a local `type` alias scoped to that entry.
3. **Use union literals over enum declarations.** `"A"|"B"|"C"` always.
4. **Drop redundant nullability.** `T | undefined` is never emitted; only
   `T | null` for nullable GraphQL fields. Optional inputs use `?:`.
5. **Omit unselected fields.** Always.
6. **Sort variable keys** so required fields come before optional fields. Helps
   the model see the contract at a glance.
7. **Emit one comment line per operation** with the operation name and kind
   (`query`/`mutation`/`subscription`). No JSDoc, no descriptions — they bloat
   context and rarely help one-shot generation. (Configurable: see §9.)
8. **Hashes are quoted string literal keys**, never numeric, never bare.

## 6. Go implementation

### 6.1 Package layout

```
router/
  persistedops/
    tsgen/
      tsgen.go          // entry: GenerateSignature, GenerateBundle, AppendChunk
      walker.go         // selection-set walker
      types.go          // GraphQL→TS type mapping
      shared.go         // SharedTypes registry, enum/input extraction
      format.go         // compaction & emission
      bundle.go         // multi-op bundle assembly + append chunks
      tsgen_test.go
```

### 6.2 Dependencies

### 6.2 Dependencies

This implementation targets the `graphql-go-tools/v2` API surface as
documented at <https://pkg.go.dev/github.com/wundergraph/graphql-go-tools/v2>.
That library is already a dependency of the Cosmo router; no new
dependencies are introduced.

The packages used are:

- `pkg/ast` — `Document`, `Type`, `Node`, `Selection`, `SelectionSet`,
  `Field`, `VariableDefinition`, `EnumTypeDefinition`,
  `InputObjectTypeDefinition`, etc., plus the helper methods like
  `FieldNameString`, `FieldAliasOrNameString`, `ResolveTypeNameString`,
  `ResolveUnderlyingType`, `FieldDefinitionTypeNode`,
  `InlineFragmentTypeConditionNameString`, `EnumValueDefinitionNameString`.
- `pkg/astparser` — `NewParser`, `ParseGraphqlDocumentBytes`,
  `ParseGraphqlDocumentString`.
- `pkg/astnormalization` — to inline fragment spreads before walking
  (simplifies the formatter; see §6.5).
- `pkg/astvalidation` — already invoked by the persisted-op accept path;
  the formatter assumes its preconditions.
- `pkg/astvisitor` — `Walker` with `EnterField`/`LeaveField`/`EnterInlineFragment`
  callbacks. Provides `walker.EnclosingTypeDefinition` (a `Node`) and
  `walker.FieldDefinition(ref) (int, bool)`.
- `pkg/operationreport` — `Report` for parser/walker error collection.

A critical fact about this AST: it is **flat-array, ref-based**, not
pointer-based. A `Type` is referenced by an `int` index into
`Document.Types`. Every entity (fields, selections, types, definitions) lives
in a typed slice on `Document` and is referenced by integer index. There are
no `*ast.Type` pointers and no recursive struct walks. The code below uses
this style throughout. Mistaking this for a `gqlparser`-style API will
produce code that does not compile.

### 6.3 Public API

```go
package tsgen

import (
    "github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
    "github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// DeliveryMode controls how shared types are extracted.
type DeliveryMode int

const (
    DeliveryModeBundle DeliveryMode = iota // ≥2-use extraction
    DeliveryModeAppend                     // pre-extract all schema enums/inputs
    DeliveryModePerOp                      // fully inlined per signature
)

type Config struct {
    Scalars             map[string]string // GraphQL scalar name → TS type
    Compact             bool              // strip newlines within an op entry
    EmitComments        bool              // op-name comments
    BundleHeader        bool              // emit `declare function op<H...>` etc.
    DeliveryMode        DeliveryMode
    ExtractOutputShapes bool              // experimental, off by default
    StrictPathTypes     bool              // ship full template-literal Path/Required types
}

// Operation is a parsed, validated GraphQL operation paired with its hash.
// The Doc holds ONLY this operation (and any fragments it references), not
// the entire persisted-op corpus. This isolation simplifies walking.
type Operation struct {
    Hash  string
    Name  string // empty for anonymous ops
    Kind  ast.OperationType
    Doc   *ast.Document
    OpRef int   // index into Doc.OperationDefinitions
}

type SharedTypeKind int

const (
    SharedTypeEnum SharedTypeKind = iota
    SharedTypeInputObject
)

type SharedType struct {
    Name string         // e.g. "OrderStatus"
    TS   string         // e.g. `"PENDING"|"SHIPPED"|"DELIVERED"`
    Kind SharedTypeKind
}

type SharedTypes struct {
    // Insertion-ordered. Lookup by Name is rare; emit order is what matters.
    Aliases []SharedType
}

func (s *SharedTypes) Has(name string) bool { /* linear scan is fine, small N */ }
func (s *SharedTypes) Add(t SharedType)    { /* dedupes by Name */ }

// GenerateSignature emits one entry's body: `{ vars: {...}; data: {...} }`.
// `known` is the set of shared types already delivered to this session;
// the formatter references them by name rather than re-inlining.
// Returns the entry text and the subset of `known` actually used (so the
// caller can prune unused aliases for per-op delivery).
func GenerateSignature(
    op Operation,
    schema *ast.Document,
    known SharedTypes,
    cfg Config,
) (entry string, used SharedTypes, err error)

// GenerateBundle emits a full `.d.ts` blob: header, shared types, and one
// entry per operation. The returned SharedTypes is the registry the caller
// should remember for subsequent AppendChunk calls.
func GenerateBundle(
    ops []Operation,
    schema *ast.Document,
    cfg Config,
) (bundle string, registered SharedTypes, err error)

// AppendChunk emits an append-mode chunk for newly-persisted operations.
// `known` is what the session has already received; the chunk references
// those by name and only introduces new aliases for genuinely-new types.
// `seq` is a monotonic per-session sequence used in the chunk header.
func AppendChunk(
    ops []Operation,
    schema *ast.Document,
    known SharedTypes,
    seq uint64,
    cfg Config,
) (chunk string, newlyRegistered SharedTypes, err error)
```

### 6.4 Walking variables

`OperationDefinition.VariableDefinitions.Refs` holds an `[]int` of indices
into `Document.VariableDefinitions`. Each `VariableDefinition` exposes:

- `VariableDefinition.VariableValue` — index into `Document.VariableValues`,
  whose name is read with `Document.VariableValueNameString(ref)`.
- `VariableDefinition.Type` — index into `Document.Types`.
- `VariableDefinition.DefaultValue` — `DefaultValue` struct with `IsDefined bool`.

```go
func emitVars(op Operation, schema *ast.Document, known SharedTypes, cfg Config) string {
    doc := op.Doc
    opDef := doc.OperationDefinitions[op.OpRef]
    refs := opDef.VariableDefinitions.Refs

    type entry struct {
        name      string
        ts        string
        optional  bool
    }
    entries := make([]entry, 0, len(refs))

    for _, vRef := range refs {
        vd := doc.VariableDefinitions[vRef]
        name := doc.VariableValueNameString(vd.VariableValue)
        ts := mapInputType(doc, vd.Type, schema, known, cfg) // see 6.4.1
        // Optional iff: type is nullable, OR a default value exists.
        nonNull := doc.TypeIsNonNull(vd.Type)
        hasDefault := vd.DefaultValue.IsDefined
        optional := !nonNull || hasDefault
        entries = append(entries, entry{name, ts, optional})
    }

    // Sort: required first; preserve insertion order within each group.
    sort.SliceStable(entries, func(i, j int) bool {
        return !entries[i].optional && entries[j].optional
    })

    var b strings.Builder
    b.WriteString("{ ")
    for i, e := range entries {
        if i > 0 { b.WriteString("; ") }
        b.WriteString(e.name)
        if e.optional { b.WriteString("?") }
        b.WriteString(": ")
        b.WriteString(e.ts)
    }
    b.WriteString(" }")
    return b.String()
}
```

#### 6.4.1 Mapping a `Type` ref to TypeScript

The `Type` struct on `Document.Types` has:

- `TypeKind` — one of `ast.TypeKindNamed`, `ast.TypeKindList`, `ast.TypeKindNonNull`.
- `Name` — `ast.ByteSliceReference` (only meaningful when `TypeKind == TypeKindNamed`).
- `OfType` — `int` ref into `Document.Types` (for List and NonNull wrappers).

```go
// mapInputType maps a variable's type. Note: variable types come from the
// OPERATION document (op.Doc), but the Named type they ultimately resolve to
// (e.g. "OrderInput", "OrderStatus") must be looked up in the SCHEMA document.
func mapInputType(opDoc *ast.Document, typeRef int, schema *ast.Document, known SharedTypes, cfg Config) string {
    return mapTypeRef(opDoc, typeRef, /*nullable=*/true, schema, known, cfg)
}

func mapTypeRef(opDoc *ast.Document, typeRef int, nullable bool, schema *ast.Document, known SharedTypes, cfg Config) string {
    t := opDoc.Types[typeRef]
    switch t.TypeKind {
    case ast.TypeKindNonNull:
        return mapTypeRef(opDoc, t.OfType, false, schema, known, cfg)
    case ast.TypeKindList:
        inner := mapTypeRef(opDoc, t.OfType, true, schema, known, cfg)
        list := inner + "[]"
        if nullable { list = "(" + list + " | null)" }
        return list
    case ast.TypeKindNamed:
        name := opDoc.Input.ByteSliceString(t.Name)
        ts := mapNamedType(name, schema, known, cfg)
        if nullable { ts = ts + " | null" }
        return ts
    }
    return "unknown"
}

func mapNamedType(name string, schema *ast.Document, known SharedTypes, cfg Config) string {
    if ts, ok := cfg.Scalars[name]; ok { return ts }
    switch name {
    case "String", "ID": return "string"
    case "Int", "Float": return "number"
    case "Boolean":      return "boolean"
    }
    // Look up the named type's definition in the SCHEMA, not the op doc.
    node, found := schema.Index.FirstNodeByNameStr(name)
    if !found {
        // Custom scalar without a mapping. Default to string and let
        // GenerateSignature surface a warning via the report.
        return "string"
    }
    switch node.Kind {
    case ast.NodeKindEnumTypeDefinition:
        if known.Has(name) { return name }
        return enumLiteralUnion(schema, node.Ref)
    case ast.NodeKindInputObjectTypeDefinition:
        if known.Has(name) { return name }
        return inputObjectShape(schema, node.Ref, known, cfg)
    case ast.NodeKindScalarTypeDefinition:
        return "string"
    case ast.NodeKindObjectTypeDefinition,
         ast.NodeKindInterfaceTypeDefinition,
         ast.NodeKindUnionTypeDefinition:
        // Output types should never appear as variable types.
        return "unknown" // schema validation should have caught this
    }
    return "unknown"
}

func enumLiteralUnion(schema *ast.Document, enumDefRef int) string {
    def := schema.EnumTypeDefinitions[enumDefRef]
    var parts []string
    for _, vRef := range def.EnumValuesDefinition.Refs {
        name := schema.EnumValueDefinitionNameString(vRef)
        parts = append(parts, `"` + name + `"`)
    }
    return strings.Join(parts, "|")
}

func inputObjectShape(schema *ast.Document, defRef int, known SharedTypes, cfg Config) string {
    def := schema.InputObjectTypeDefinitions[defRef]
    var b strings.Builder
    b.WriteString("{ ")
    for i, ivRef := range def.InputFieldsDefinition.Refs {
        iv := schema.InputValueDefinitions[ivRef]
        if i > 0 { b.WriteString("; ") }
        name := schema.Input.ByteSliceString(iv.Name)
        nonNull := schema.TypeIsNonNull(iv.Type)
        hasDefault := iv.DefaultValue.IsDefined
        ts := mapTypeRef(schema, iv.Type, /*nullable=*/!nonNull, schema, known, cfg)
        b.WriteString(name)
        if !nonNull || hasDefault { b.WriteString("?") }
        b.WriteString(": ")
        b.WriteString(ts)
    }
    b.WriteString(" }")
    return b.String()
}
```

Note: `schema.Index.FirstNodeByNameStr(name)` is the documented lookup that
returns a `Node` (kind + ref) for a named type. This is much faster than
linear scans over `EnumTypeDefinitions` etc., and is built by
`asttransform.NewMergedSchema` / the supergraph composition step.

### 6.5 Walking the response shape

Two passes:

1. **Normalization pass.** Run `astnormalization.NewNormalizer(true, true)`
   on the operation document with the schema as the definition. This inlines
   fragment spreads and converts the operation into a canonical form. After
   this, the formatter only needs to handle inline fragments (with type
   conditions for abstract types) and field selections.
2. **Emission pass.** Use `astvisitor.NewWalker(48)` and register a custom
   visitor that drives the TS emission via depth tracking and a stack of
   `strings.Builder`s, one per nesting level.

```go
type emitter struct {
    walker  *astvisitor.Walker
    op      *ast.Document
    schema  *ast.Document
    cfg     Config
    known   SharedTypes
    require requireSet // see §4.4 / §6.7

    stack []*strings.Builder // one per open object scope
    // For abstract-type selection sets, we collect branches before flushing:
    branches []branchScope
    // requirePaths, used for @require directive enforcement (§4.4):
    pathStack []string
}

func (e *emitter) EnterField(ref int) {
    fieldDefRef, ok := e.walker.FieldDefinition(ref)
    if !ok { return }

    // Field name (alias if present, else field name) — this becomes the TS key.
    keyBytes := e.op.FieldAliasOrNameBytes(ref)
    key := string(keyBytes)

    // Field's GraphQL type, looked up in the SCHEMA.
    fieldTypeRef := e.schema.FieldDefinitionType(fieldDefRef)
    hasRequireDirective := e.fieldHasRequire(ref) // §6.7
    nullable := !e.schema.TypeIsNonNull(fieldTypeRef) && !hasRequireDirective

    top := e.stack[len(e.stack)-1]
    if top.Len() > 1 { top.WriteString("; ") }
    top.WriteString(key)
    top.WriteString(": ")

    if e.op.FieldHasSelections(ref) {
        // Object/interface/union field: open a new builder.
        // We'll wrap with list/null on LeaveField using the field's type.
        // For now, push a placeholder marker we'll replace in LeaveField.
        e.pushObjectScope(fieldTypeRef, nullable)
    } else {
        // Leaf field. Emit the scalar/enum mapping.
        ts := mapTypeRef(e.schema, fieldTypeRef, nullable, e.schema, e.known, e.cfg)
        top.WriteString(ts)
    }

    e.pathStack = append(e.pathStack, key)
}

func (e *emitter) LeaveField(ref int) {
    if e.op.FieldHasSelections(ref) {
        e.popObjectScope() // composes list-wrapping and null-wrapping
    }
    e.pathStack = e.pathStack[:len(e.pathStack)-1]
}

func (e *emitter) EnterInlineFragment(ref int) {
    // Only meaningful when the parent type is abstract.
    typeName := e.op.InlineFragmentTypeConditionNameString(ref)
    e.openBranch(typeName)
}

func (e *emitter) LeaveInlineFragment(ref int) {
    e.closeBranch()
}
```

`pushObjectScope` / `popObjectScope` handle the wrapping logic: they read
the field's `ast.Type` chain (NonNull → List → Named or List → Named, etc.)
and assemble `T | null`, `T[]`, `(T | null)[]` etc. around the inner object
literal that was emitted into a child builder.

The walker is initialized and run like this:

```go
func GenerateSignature(op Operation, schema *ast.Document, known SharedTypes, cfg Config) (string, SharedTypes, error) {
    // 1. Normalize the operation in-place. astnormalization mutates op.Doc.
    report := &operationreport.Report{}
    normalizer := astnormalization.NewNormalizer(true, true)
    normalizer.NormalizeOperation(op.Doc, schema, report)
    if report.HasErrors() { return "", SharedTypes{}, report }

    // 2. Walk and emit.
    walker := astvisitor.NewWalker(48)
    e := &emitter{
        walker: &walker, op: op.Doc, schema: schema,
        cfg: cfg, known: known,
        stack: []*strings.Builder{newBuilder("{ ")},
    }
    walker.RegisterEnterFieldVisitor(e)
    walker.RegisterLeaveFieldVisitor(e)
    walker.RegisterEnterInlineFragmentVisitor(e)
    walker.RegisterLeaveInlineFragmentVisitor(e)
    walker.Walk(op.Doc, schema, report)
    if report.HasErrors() { return "", SharedTypes{}, report }

    data := e.stack[0].String() + " }"
    vars := emitVars(op, schema, known, cfg)

    entry := `{ vars: ` + vars + `; data: ` + data + ` }`
    return entry, e.usedShared(), nil
}
```

### 6.6 Discriminated unions

When `walker.EnclosingTypeDefinition.Kind` is `NodeKindInterfaceTypeDefinition`
or `NodeKindUnionTypeDefinition`, the emitter is inside an abstract selection
set. After normalization, this manifests as a sequence of inline fragments,
each with a type condition.

```go
type branchScope struct {
    typeName string
    body     *strings.Builder
}

func (e *emitter) openBranch(typeName string) {
    bs := branchScope{
        typeName: typeName,
        body:     newBuilder(`{ __typename: "` + typeName + `"`),
    }
    e.branches = append(e.branches, bs)
    e.stack = append(e.stack, bs.body)
}

func (e *emitter) closeBranch() {
    bs := e.branches[len(e.branches)-1]
    bs.body.WriteString(" }")
    e.branches = e.branches[:len(e.branches)-1]
    e.stack = e.stack[:len(e.stack)-1]
}

// Flush all branches as a TS union when leaving the abstract selection set:
//   ({ __typename: "User"; id: string } | { __typename: "Org"; id: string })
```

The router runtime is separately responsible for ensuring `__typename` is
selected on every abstract field, even when the original operation didn't
request it. This is implemented in the operation-accept path via
`astnormalization` — specifically by registering a custom normalization
visitor that adds a `__typename` selection to any selection set whose
enclosing type is an interface or union. Cosmo Router already injects
`__typename` for federation entity resolution; this extends that injection
to the response-shaping layer.

### 6.7 The `@require` directive

The directive is defined in the supergraph schema:

```graphql
directive @require on FIELD
```

(Field-position only; we deliberately do not allow `@require` on fragment
spreads or operations to keep semantics local.)

#### 6.7.1 Detection during emission

`Document.Fields[ref].Directives.Refs` is an `[]int` of indices into
`Document.Directives`. Each directive carries a `Name` (ByteSliceReference).

```go
func (e *emitter) fieldHasRequire(ref int) bool {
    f := e.op.Fields[ref]
    if !f.HasDirectives { return false }
    for _, dRef := range f.Directives.Refs {
        if e.op.DirectiveNameString(dRef) == "require" {
            return true
        }
    }
    return false
}
```

When `fieldHasRequire(ref)` returns true, the emitter:

1. Treats the field's type as if it were `NonNull` for TS emission, even if
   the schema declares it nullable. This drops `| null` from the resulting
   TS.
2. Records the field's path (joined `pathStack`) in `e.requirePaths`.

#### 6.7.2 Storage of required paths

The set of required paths is stored alongside the operation in a separate
column / KV value:

```sql
ALTER TABLE persisted_operations
  ADD COLUMN required_paths JSONB NOT NULL DEFAULT '[]';
```

Stored as a JSON array of dotted path strings — the same syntax accepted by
`opRequire` (§4.4.3). Storing it separately, rather than re-deriving from
the operation document at every execution, avoids re-walking the AST on the
hot path.

#### 6.7.3 Runtime enforcement

The router's response-shaping layer (already responsible for filtering
fields per the selection set in federation contexts) is extended with a
post-execution check:

```go
func enforceRequiredPaths(response []byte, paths []string) error {
    for _, p := range paths {
        nodes, err := jsonpath.Lookup(response, p)
        if err != nil { return fmt.Errorf("invalid required path %q: %w", p, err) }
        for _, n := range nodes {
            if n.IsNull() {
                return &RequiredFieldNullError{
                    Code: "REQUIRED_FIELD_NULL",
                    Path: p,
                }
            }
        }
    }
    return nil
}
```

The `[]` and `[]?` semantics from §4.4.3 are implemented in the path lookup:
`[]` requires non-empty + non-null elements; `[]?` allows empty but still
requires non-null elements when present.

If `enforceRequiredPaths` returns an error, the router returns a structured
error to the agent runtime instead of the response body. The runtime
surfaces it as a rejected promise with the `RequiredFieldNullError` shape
documented in §4.4.5.

#### 6.7.4 Interaction with `opRequire`

`opRequire(hash, vars, paths)` paths are layered on top of stored required
paths. The runtime takes the union and enforces the combined set. Callers
cannot relax stored requirements — that would defeat the point.

### 6.7 Aliases

GraphQL aliases override field names in the response. The formatter uses
`f.Alias` (falling back to `f.Name`) as the TS property key. When two fields
of the same name appear with different aliases (allowed), both keys appear in
the TS shape — natural and correct.

### 6.8 Default values & optionality

A variable is `?:` (optional) iff:
- its type is nullable (`T` not `T!`), OR
- it has a default value.

A variable is **non-nullable in the TS sense** (`T` not `T | null`) iff:
- its type is `T!` AND it has a default value (the default fills nullability), OR
- its type is `T!` and no default (then it's also required).

Truth table:

| GraphQL | Default? | TS rendering |
|---|---|---|
| `T!` | no | `name: T` |
| `T!` | yes | `name?: T` |
| `T` | no | `name?: T \| null` |
| `T` | yes | `name?: T \| null` |

### 6.9 Validation hook

`GenerateSignature` MUST be called only on operations that have already been
validated against the schema (existing router behavior). The formatter assumes:

- All field selections resolve.
- All variable types exist.
- All fragments resolve and are not cyclic.

If any assumption fails, return an error and reject the persist request — the
operation should never be stored without a valid signature.

### 6.10 Caching

Signatures are deterministic for `(operation, schema_version, scalar_map)`.
Cache key:

```
sha256(opHash || schemaHash || scalarMapHash)
```

Invalidate on schema change. The router already tracks schema versions; reuse
that.

## 7. Storage

### 7.1 Per-operation

Add one column / one KV value per persisted op:

```sql
ALTER TABLE persisted_operations
  ADD COLUMN ts_signature  TEXT NOT NULL DEFAULT '',
  ADD COLUMN required_paths JSONB NOT NULL DEFAULT '[]';
```

Or, if persisted ops live in object storage / a KV: store `signature.ts` and
`required_paths.json` alongside `operation.graphql` under the same key prefix.

Stored signatures are **always inlined** (no shared-type references), and
they reflect any `@require` annotations (i.e. annotated fields are non-null
in the stored TS). Inlined form is the canonical artifact; shared-type
extraction is a presentation-time transform applied during bundle/append
generation. This keeps storage self-contained and decouples it from
delivery-mode evolution.

Size budget per op: target **≤ 400 bytes** for typical operations (5-10 fields,
2-3 levels deep). Operations exceeding 4 KB should log a warning — they're
likely over-fetching and will burn agent context.

### 7.2 Per-session shared-type registry

When delivering in append mode (§4.3), the router must remember which shared
types have been delivered to each agent session, so subsequent append chunks
reference them by name without redefining.

```sql
CREATE TABLE agent_session_shared_types (
  session_id   UUID NOT NULL,
  schema_hash  TEXT NOT NULL,        -- invalidate on schema change
  type_name    TEXT NOT NULL,        -- e.g. "OrderStatus"
  ts_body      TEXT NOT NULL,        -- the RHS for verification
  delivered_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, type_name)
);
```

For ephemeral sessions, an in-memory map keyed by session ID is sufficient.

## 8. Delivery to the model

The router exposes two endpoints: a snapshot endpoint for one-shot bundles,
and a session-scoped endpoint for incremental delivery.

### 8.1 Snapshot endpoint

```
GET /persisted-ops/signatures
  ?hashes=a3f9c1,b71e08,c4d2a0
  &format=bundle | per-op
  &schema=<sha>            // optional, defaults to current
Response: text/typescript
```

When `format=bundle`, the response is a single `.d.ts` blob ready to inject
into the agent's context. When `format=per-op`, the response is a JSON map of
`hash → string`, suitable for selective context construction.

### 8.2 Session endpoint (append mode)

```
POST /persisted-ops/sessions
Body: { schema?: string }
Response: { session_id: string, initial_bundle: string }
```

The initial bundle pre-extracts every schema-known enum and input object
(per §3.8 amendment) and includes the function declaration. The router records
the session's shared-type registry.

```
GET /persisted-ops/sessions/{session_id}/since/{seq}
Response: { seq: number, chunk: string | null }
```

Returns an append chunk containing all operations persisted since the given
sequence number, formatted to reference the session's already-delivered shared
types. Returns `chunk: null` if there are no new operations.

```
DELETE /persisted-ops/sessions/{session_id}
```

Discards the session's shared-type registry.

### 8.3 Push variant

For agent runtimes that prefer push over poll, the same content can be
delivered over Server-Sent Events on `GET /persisted-ops/sessions/{id}/stream`,
emitting one chunk per persist event with monotonic `seq` IDs.

## 9. Configuration reference

```yaml
persisted_ops:
  ts_signatures:
    enabled: true
    scalars:
      DateTime: string
      JSON: unknown
      BigInt: string
    compact: true                  # strip whitespace within entries
    emit_comments: true            # `// opName — kind` headers
    bundle_header: true            # emit declare-function preamble
    max_signature_bytes: 4096      # warn above this

    # Shared-type extraction (§3.8)
    delivery_mode: bundle          # bundle | append | per-op
    extract_enums: true            # hoist enums on ≥2 uses (bundle mode)
    extract_input_objects: true    # hoist input objects on ≥2 uses (bundle mode)
    extract_output_shapes: false   # experimental; off by default

    # Append-mode session policy
    append:
      preextract_schema_enums: true       # ship all enums in initial bundle
      preextract_schema_inputs: true      # ship all input objects in initial bundle
      session_ttl_seconds: 86400          # discard idle sessions after 24h
```

## 10. Worked example

Schema:

```graphql
type Query {
  user(id: ID!): User
  search(q: String!): [SearchResult!]!
}
type Mutation {
  createOrder(input: OrderInput!): Order!
}
type User { id: ID! name: String! email: String! orders(first: Int = 10, status: OrderStatus): [Order!]! }
type Order { id: ID! total: Float! items: [OrderItem!]! }
type OrderItem { sku: String! qty: Int! }
input OrderInput { userId: ID! items: [OrderItemInput!]! }
input OrderItemInput { sku: String! qty: Int! }
enum OrderStatus { PENDING SHIPPED DELIVERED }
union SearchResult = User | Org
type Org { id: ID! slug: String! }
```

Persisted operations:

```graphql
query getUserOrders($userId: ID!, $limit: Int = 10, $status: OrderStatus) {
  user(id: $userId) { id name orders(first: $limit, status: $status) { id total items { sku qty } } }
}
mutation createOrder($input: OrderInput!) { createOrder(input: $input) { id total } }
query search($q: String!) {
  search(q: $q) { __typename ... on User { id name } ... on Org { id slug } }
}
```

### 10.1 Initial bundle (append mode, ~580 bytes)

With `delivery_mode: append`, the initial bundle pre-extracts schema enums
and input objects:

```ts
declare function op<H extends keyof Ops>(hash: H, vars: Ops[H]["vars"]): Promise<Ops[H]["data"]>;

type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";
type OrderInput = { userId: string; items: { sku: string; qty: number }[] };

interface Ops {
  // getUserOrders — query
  "a3f9c1": { vars: { userId: string; limit?: number; status?: OrderStatus|null }; data: { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } | null } };
  // createOrder — mutation
  "b71e08": { vars: { input: OrderInput }; data: { createOrder: { id: string; total: number } } };
  // search — query
  "c4d2a0": { vars: { q: string }; data: { search: ({ __typename: "User"; id: string; name: string } | { __typename: "Org"; id: string; slug: string })[] } };
}
```

### 10.2 Later: a new operation is persisted

A user persists a new operation:

```graphql
query ordersByStatus($status: OrderStatus!) { ordersByStatus(status: $status) { id } }
```

The router emits an append chunk that references the already-known `OrderStatus`:

```ts
// === persisted ops bundle (append #1 @ 2026-04-26T14:22Z) ===
interface Ops {
  // ordersByStatus — query
  "d8e211": { vars: { status: OrderStatus }; data: { ordersByStatus: { id: string }[] } };
}
```

After this chunk, the agent's `op` signature accepts any of the four hashes
with full type safety, and the model implicitly understood that `Ops` was
extended without ever being told in prose.

### 10.3 Later still: schema gains a new enum

The schema is updated to add a `PaymentMethod` enum and a new operation uses
it. The append chunk introduces the new shared type at the top:

```ts
// === persisted ops bundle (append #2 @ 2026-04-26T15:08Z) ===
type PaymentMethod = "CARD"|"BANK"|"CRYPTO";
interface Ops {
  // chargeOrder — mutation
  "f9a012": { vars: { orderId: string; method: PaymentMethod }; data: { chargeOrder: { ok: boolean } } };
}
```

Old entries are unchanged. The new `PaymentMethod` alias is now part of the
session's shared-type registry for future appends.

### 10.4 Agent's generated code

```ts
const { user } = await op("a3f9c1", { userId: "u_42", limit: 5 });
if (!user) return { error: "user not found" };
const totals = user.orders.map(o => o.total);
const sum = totals.reduce((a, b) => a + b, 0);

// Later in the same session, after append #1:
const pending = await op("d8e211", { status: "PENDING" });

return { name: user.name, lifetimeValue: sum, pendingOrders: pending.ordersByStatus.length };
```

Full type safety on every call, across the initial bundle and any number of
subsequent appends.

## 11. Open questions

1. **Schema evolution.** When the upstream schema changes a field from `T!` to
   `T`, the signature changes shape. We invalidate cache; do we also
   re-validate stored persisted ops automatically, or require manual re-persist?
   *Recommendation:* re-validate on schema publish; reject persisted ops whose
   signatures would change in a breaking way unless explicitly re-persisted.
   In append mode, a breaking change to a stored operation's signature is
   especially disruptive — the corresponding entry in `Ops` cannot be
   "updated" without violating append-only semantics. Options: (a) require
   the agent to start a new session on breaking schema change, (b) extend the
   format with an explicit revocation mechanism (e.g. a separate
   `RevokedOps` interface the model is told to avoid). Recommended default:
   option (a). Sessions are cheap; correctness is not.
2. **Federated subgraph entities.** When a field resolves through `@key`/`@requires`,
   the response shape is unaffected, but introspection of `@interfaceObject`
   types needs care. Treat them as their merged type at the supergraph level
   — already what gqltools sees post-composition.
3. **Subscriptions.** Out of scope for v1. When added, `data` becomes
   `AsyncIterable<…>` and the `op` signature gets a sibling `subscribe`.
4. **Variable descriptions.** Persisted ops sometimes carry a `# @doc("...")`
   comment. We deliberately omit these by default (token cost). Reconsider if
   one-shot accuracy drops.
5. **Output-shape extraction.** §3.8 Tier 3 is off by default. Should be
   measured on a real corpus before deciding whether to enable: question is
   whether structural sharing of selection sets saves enough tokens to justify
   the false-sharing risk.

## 12. Acceptance criteria

- [ ] `tsgen.GenerateSignature` produces correct TS for all queries in the
      Cosmo test corpus.
- [ ] Generated `.d.ts` bundle for the corpus type-checks under `tsc --strict`.
- [ ] Median signature size ≤ 400 bytes; p99 ≤ 4 KB.
- [ ] Round-trip: persist op → generate signature → execute against the runtime
      → response matches signature shape (validated by a runtime conformance
      check in dev mode).
- [ ] Discriminated unions: every abstract field in the response carries
      `__typename` at runtime even when the original op didn't request it.
- [ ] Bench: signature generation ≤ 1 ms p50 for typical ops on a single core.
- [ ] Shared-type extraction (§3.8): for a corpus where each enum is reused
      ≥3 times on average, bundle size shrinks ≥15% vs. fully-inlined.
- [ ] Append correctness: `GenerateBundle` followed by N `AppendChunk` calls
      produces a TS document that `tsc --strict` accepts as a single program
      (concatenated), with `keyof Ops` resolving to the union of all delivered
      hashes.
- [ ] Append idempotency: resending an identical append chunk does not produce
      a TS error.
- [ ] Append safety: any attempt to emit a chunk whose new entries' hashes
      collide with previously-delivered hashes returns an error from
      `AppendChunk` rather than silently producing a TS-conflicting output.
- [ ] `@require` correctness: a field annotated with `@require` produces a
      non-null TS type in the stored signature, and a runtime null at that
      path produces `RequiredFieldNullError` instead of a partial response.
- [ ] `@require` on non-nullable fields: emit a warning at persist time
      (the annotation is redundant) but do not reject.
- [ ] `opRequire` runtime: a path that is invalid for the operation's data
      shape returns a typed error before execution, not after.
- [ ] AST API conformance: the formatter compiles against the exact
      `graphql-go-tools/v2` API surface documented in §6.2 — specifically
      it uses ref-based access (`Document.Types[ref]`, `FieldDefinitionType(ref)`,
      `FieldAliasOrNameBytes(ref)`, `Index.FirstNodeByNameStr`) rather than
      pointer-based or struct-walking patterns.
