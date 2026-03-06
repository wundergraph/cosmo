# RFC: MCP Agentic Mode — Search & Execute Queries on the Graph

- **Author:** Jens Neuse
- **State:** Implemented
- **Last Updated:** 2026-02-24

---

## Abstract

This RFC describes **MCP Agentic Mode**, a mode for Cosmo Router that exposes an MCP server with two "uber-tools" — `search` and `execute` — that accept TypeScript code as input. Instead of pre-defining individual MCP tools for each GraphQL operation, this mode lets AI agents dynamically discover and execute operations against the supergraph by writing code against typed APIs in a secure sandbox.

The `search` tool generates GraphQL queries from natural language via `generateQuery()`. Search results are GraphQL queries returned as strings with variables, descriptions, and content hashes — ready to pass directly to `execute`.

The `execute` tool takes GraphQL queries (by full text or by hash) and runs them against the supergraph. For mutations, the router can require human operator approval via MCP elicitation before executing.

This is inspired by [Cloudflare's Code Mode MCP pattern](https://blog.cloudflare.com/code-mode-mcp/).

## Background

### Current State

Cosmo Router already has an MCP server (`router/pkg/mcpserver/`) that exposes tools derived from pre-defined `.graphql` operation files. Each operation becomes a separate MCP tool (e.g., `execute_operation_get_users`). While functional, this has significant limitations:

1. **Manual operation definition** — Every operation must be written and deployed upfront as a `.graphql` file.
2. **Context window pressure** — Large APIs generate hundreds of tool definitions, consuming the agent's context window. For a supergraph with 500+ operations, this can exceed model limits entirely.
3. **No dynamic discovery** — Agents cannot explore the schema or compose novel queries. They are limited to the exact set of pre-defined operations.
4. **Maintenance burden** — Adding or modifying operations requires redeployment.

### The "Uber-Tool" Pattern

Cloudflare's [Code Mode](https://blog.cloudflare.com/code-mode-mcp/) demonstrated that replacing N tool definitions with two generic tools (`search` + `execute`) that accept code reduces token consumption by 99.9% while enabling full API coverage. The key insight: instead of describing every operation as a separate tool, let the model write code against a typed SDK and execute it safely.

### Yoko: Prompt-to-Query REST API

Yoko is an existing REST API that takes a natural language prompt and returns one or more GraphQL queries to resolve it. It is an external service, deployed independently of the router, authenticated via bearer tokens.

**API contract:**

```http
POST {endpoint}/v1/generate
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
  "prompt": "Find all users who signed up in the last 30 days",
  "schema_hash": "abc123"
}

Response 200:
{
  "queries": [
    {
      "query": "query RecentUsers($since: DateTime!) {\n  users(filter: { createdAt: { gte: $since } }) {\n    id\n    name\n    email\n    createdAt\n  }\n}",
      "variables": { "since": "2026-01-23T00:00:00Z" },
      "description": "Fetches users created after the specified date"
    }
  ]
}

Response 400:
{
  "error": "Could not generate a valid query for the given prompt",
  "details": "No matching types found for 'foobar'"
}
```

**Yoko is not exposed by name to agents.** In the TypeScript API, the capability is surfaced as `generateQuery()` — a name any model can understand without prior context.

## Goals and Requirements

### In Scope

- Expose an MCP server with exactly two tools: `search` and `execute`.
- Accept TypeScript as input for both tools.
- Transpile TypeScript to JavaScript and execute it in a secure, resource-limited sandbox within the Go router process.
- Inject typed global APIs from the Go host into the JS sandbox execution context. The search sandbox injects `generateQuery()` as an asynchronous host function returning a native JS Promise (backed by the Yoko REST API). The execute sandbox injects `graphql()` as an asynchronous host function.
- Search results are GraphQL queries returned as strings with variables, descriptions, and content hashes.
- Enforce strict resource limits: CPU time, memory, wall-clock timeout, and input/output size per execution.
- Prevent sandbox escapes, data exfiltration, and denial-of-service attacks.
- Support human operator approval for mutations via MCP elicitation.
- Run agentic mode as a separate HTTP server on its own TCP listener (default `localhost:5027`), independent of the existing per-operation MCP server.
- Integrate with the Yoko REST API for prompt-to-query generation.
- Support two sandbox runtimes: QuickJS (via WASM, default) and goja (pure Go fallback), selectable via configuration.
- Support TOON-encoded responses for token efficiency.
- Provide query hash deduplication — `generateQuery()` returns hashes, `graphql()` accepts hashes instead of full query text.
- Provide OpenTelemetry tracing and metrics per tool invocation.

### Out of Scope

- Replacing the existing per-operation MCP tool mode (both modes coexist).
- Authentication/authorization for the MCP endpoint itself (handled by existing infra).
- Implementation of Yoko (assumed to exist as a REST API; we mock it for development).
- Client-side code execution (all execution happens server-side).
- Subscriptions (agents are not expected to use real-time updates).
- Schema exploration APIs (`schema.queries()`, `schema.type()`, etc.) — `generateQuery()` alone proved sufficient for agent query discovery, making programmatic schema exploration unnecessary. These can be added later if needed.
- Query validation API (`validate()`) — removed to reduce API surface. Agents rely on `generateQuery()` which produces valid queries.

### Jobs to Be Done

The TypeScript API surface is embedded in the MCP tool description and consumed as context tokens by the model. Every type and function we add costs tokens on every request. The API must be the minimum needed to cover the core agent jobs:

| # | Job | Required APIs | Tool |
|---|---|---|---|
| 1 | **Generate a query from intent** — "Find users who signed up recently" | `generateQuery(prompt)` | search |
| 2 | **Execute a query** — "Run this query and return data" | `graphql({ query, variables })` or `graphql({ hash })` | execute |
| 3 | **Chain operations** — "Get user, then fetch their orders" | `graphql()` called multiple times | execute |
| 4 | **Fan out in parallel** — "Get users, orders, and products at the same time" | `Promise.all([graphql(...), ...])` | execute |

**Deliberately excluded** to keep the type surface compact:

| API | Reason for exclusion |
|---|---|
| `schema.queries()` / `schema.mutations()` / `schema.type(name)` / `schema.search(keyword)` | Schema exploration APIs were removed to minimize API surface. `generateQuery()` handles discovery. Can be added later. |
| `validate(query)` | Removed to reduce API surface. `generateQuery()` produces valid queries. |
| `schema.sdl()` | Huge string output, wastes agent context. |
| `parse(source)` / `print(ast)` / `visit(ast, visitor)` | AST manipulation requires ~80 lines of type definitions. Agents get query strings from `generateQuery()` and pass them to `graphql()`. |

## Proposal

### Architecture Overview

```text
┌─────────────────────────────────────────────────────────┐
│                    AI Agent (Claude, etc.)               │
└──────────────┬──────────────────────┬───────────────────┘
               │ MCP: search(ts)      │ MCP: execute(ts)
               ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│        Cosmo Router - MCP Agentic Mode                  │
│        Separate HTTP server (default :5027/mcp)         │
│  ┌────────────────────┐   ┌──────────────────────────┐  │
│  │   search handler   │   │    execute handler       │  │
│  └────────┬───────────┘   └────────┬─────────────────┘  │
│           │                        │                     │
│  ┌────────▼────────────────────────▼─────────────────┐  │
│  │              esbuild (TS → JS)                    │  │
│  └────────┬────────────────────────┬─────────────────┘  │
│           │                        │                     │
│  ┌────────▼────────────┐  ┌───────▼──────────────────┐  │
│  │   JS Sandbox        │  │   JS Sandbox             │  │
│  │                     │  │                          │  │
│  │  generateQuery()    │  │  graphql()               │  │
│  └──────────┬──────────┘  └───────────┬──────────────┘  │
│             │                         │                  │
│    ┌────────▼──────────┐    ┌─────────▼────────────┐    │
│    │  Yoko REST API    │    │  Router GraphQL      │    │
│    │  (external)       │    │  Endpoint (HTTP POST)│    │
│    └───────────────────┘    │         │            │    │
│                             │  MCP Elicitation     │    │
│                             │  (mutation approval) │    │
│                             └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Execution Model

Agents write an async arrow function that uses the injected globals and returns a result. The router wraps and executes this code:

1. Agent submits TypeScript code as an async arrow function: `async () => { ... }`
2. esbuild transpiles TS → JS
3. Router wraps it: `(async function(){ <preamble> return <transpiled_code>; })()`
4. Sandbox evaluates the JS, gets a Promise
5. Awaits the Promise, JSON-serializes the result
6. Returns the serialized result to the MCP client

### Communicating Type Definitions to Agents

For an agent to write correct TypeScript against the sandbox APIs, it must know what globals are available and their types. We use two complementary mechanisms:

**1. Embedded in MCP tool descriptions** — The full TypeScript type specification is included in each tool's `description` field. When the MCP client sends the tool list to the model, the model sees the complete API surface inline. This is the primary mechanism — no extra round-trip needed.

**2. MCP resources** — The type definitions are also published as MCP resources (`agentic://search-api.d.ts` and `agentic://execute-api.d.ts`). Agents that support MCP resources can fetch these for reference. This is optional — the tool description alone is sufficient.

This approach ensures the model never has to guess at API shapes. The type definitions ARE the prompt.

### Tool 1: `search`

The `search` tool generates GraphQL queries from natural language. Search results are `QueryResult[]` — query strings with variables, descriptions, and content hashes that can be passed directly to `execute`.

**MCP Tool Definition (this is the actual tool description the model sees):**

```json
{
  "name": "search",
  "description": "Generate GraphQL queries from natural language.\nWrite a single async arrow function (ES2020, no imports). Return QueryResult[].\nSTYLE: Write compact single-line code. Avoid unnecessary whitespace and newlines. Short variable names are fine.\nRESPONSE FORMAT: Set toon=true to receive output in TOON (Token-Oriented Object Notation) instead of JSON — saves ~40% tokens on tabular data. Only use if you can parse TOON. Omit or ignore if unsure.\n\ninterface QueryResult { query: string; variables: Record<string, any>; description: string; hash: string; }\n\ndeclare function generateQuery(prompt: string): Promise<QueryResult[]>;\n\nExample:\n  const queries = await generateQuery(\"find all employees with their departments\");\n  return queries; // returns QueryResult[] with hash — pass hash to graphql() in execute tool",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "An async arrow function. Example: async () => { return await generateQuery('find all users'); }"
      },
      "toon": {
        "type": "boolean",
        "description": "Set true for compact TOON-encoded response"
      }
    },
    "required": ["code"]
  },
  "annotations": {
    "title": "Search GraphQL Supergraph",
    "readOnlyHint": true
  }
}
```

**TypeScript Type Specification (readable form of the embedded spec above):**

```typescript
// Search sandbox — write a single async arrow function (ES2020, no imports), return QueryResult[].

interface QueryResult {
  query: string;                    // GraphQL query string, ready for execute
  variables: Record<string, any>;   // Variable values (defaults/examples)
  description: string;              // What this query does
  hash: string;                     // Hash — pass to graphql() instead of query to save tokens
}

// Globals

// Generates ready-to-execute GraphQL queries from natural language.
declare function generateQuery(prompt: string): Promise<QueryResult[]>;
```

**Example Agent Usage:**

```typescript
// Generate queries from natural language
async () => {
  return await generateQuery("Get all employees with their email addresses");
}
// Returns QueryResult[] with hash — pass hash to graphql() in execute tool
```

```typescript
// Generate and immediately inspect the results
async () => {
  const queries = await generateQuery("find all employees with their departments");
  return queries;
}
```

### Tool 2: `execute`

The `execute` tool runs GraphQL queries and mutations against the supergraph. Its sole purpose is execution — query discovery and generation belong in `search`.

**MCP Tool Definition (this is the actual tool description the model sees):**

```json
{
  "name": "execute",
  "description": "Execute GraphQL queries and mutations against the supergraph.\nWrite a single async arrow function (ES2020, no imports). Return any JSON-serializable value.\nSTYLE: Write compact single-line code. Avoid unnecessary whitespace and newlines. Short variable names are fine.\nUse the search tool with generateQuery() first to get ready-to-execute queries, then pass them here.\nTOKEN-SAVING: When you have a hash from generateQuery results, pass { hash } instead of { query } to avoid resending the full query text.\nRESPONSE FORMAT: Set toon=true to receive output in TOON (Token-Oriented Object Notation) instead of JSON — saves ~40% tokens on tabular data. Only use if you can parse TOON. Omit or ignore if unsure.\n\ninterface GraphQLOptions { query?: string; variables?: Record<string, any>; operationName?: string; hash?: string; }\ninterface GraphQLResponse { data: any | null; errors: GraphQLError[] | null; declined?: { reason: string | null; }; }\ninterface GraphQLError { message: string; path: (string | number)[] | null; extensions: Record<string, any> | null; }\n\ndeclare function graphql(options: GraphQLOptions): Promise<GraphQLResponse>;\n\nIMPORTANT: graphql() takes an object, NOT a string. Response data is in result.data, not result directly.\nProvide either query (full text) or hash (from generateQuery). Prefer hash when available.\n\nMutations may require human approval. If declined, result.declined is set. Check with: if (result.declined) { ... result.declined.reason ... }",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "An async arrow function. Example: async () => { const { data } = await graphql({ query: '{ users { id } }' }); return data; }"
      },
      "toon": {
        "type": "boolean",
        "description": "Set true for compact TOON-encoded response"
      }
    },
    "required": ["code"]
  }
}
```

**TypeScript Type Specification (readable form of the embedded spec above):**

```typescript
// Execute sandbox — write a single async arrow function (ES2020, no imports), return any JSON-serializable value.

interface GraphQLOptions {
  query?: string;                     // GraphQL query or mutation string
  variables?: Record<string, any>;    // Operation variables
  operationName?: string;             // Operation name (if multiple in document)
  hash?: string;                      // Hash from generateQuery — use instead of query to save tokens
}

interface GraphQLResponse {
  data: any | null;
  errors: GraphQLError[] | null;
  declined?: {                    // Present when a mutation was declined by the operator
    reason: string | null;        // Operator's reason for declining (if provided)
  };
}

interface GraphQLError {
  message: string;
  path: (string | number)[] | null;
  extensions: Record<string, any> | null;
}

// Globals

declare function graphql(options: GraphQLOptions): Promise<GraphQLResponse>;

// IMPORTANT: graphql() takes an object, NOT a string. Response data is in result.data.
// Provide either query (full text) or hash (from generateQuery). Prefer hash when available.
```

**Example Agent Usage:**

```typescript
// Preferred — use hash from search results (saves tokens)
async () => {
  const result = await graphql({ hash: queryResult.hash, variables: queryResult.variables });
  return result.data;
}
```

```typescript
// Inline query — when no hash available
async () => {
  const result = await graphql({ query: '{ employees { id name } }' });
  return result.data.employees;
}
```

```typescript
// Chained operations — fetch employees, then update each
async () => {
  const emps = await graphql({ query: '{ employees { id } }' });
  for (const e of emps.data.employees) {
    await graphql({
      query: 'mutation($id:Int!){updateMood(employeeID:$id,mood:HAPPY){id}}',
      variables: { id: e.id }
    });
  }
  return { updated: emps.data.employees.length };
}
```

```typescript
// Parallel fan-out + local join
async () => {
  const [emps, prods] = await Promise.all([
    graphql({ query: '{ employees { id details { forename } hobbies { ... on Programming { languages } } } }' }),
    graphql({ query: '{ products { ... on SDK { upc engineers { id } } } }' })
  ]);
  // Join and filter data locally, return only the processed result
  return { employees: emps.data, products: prods.data };
}
```

```typescript
// Handle a potentially declined mutation
async () => {
  const result = await graphql({
    query: `mutation { deleteUser(id: "123") { id } }`
  });
  if (result.declined) {
    return { declined: true, reason: result.declined.reason };
  }
  return result.data;
}
```

### Query Hash Deduplication

When `generateQuery()` returns results, the server computes an xxhash64 hash of each query string and includes it in the `QueryResult` as the `hash` field. The hash-to-query mapping is stored in an in-process map (capped at 1,000 entries; cleared entirely when full).

The `graphql()` function in the execute sandbox accepts either `query` (full text) or `hash` (from `generateQuery`). When `hash` is provided, the server resolves the full query text from the store. This avoids resending large query strings between the search and execute steps, reducing token consumption.

**Flow:**

1. Agent calls `search` → `generateQuery("find employees")` → returns `[{ query: "...", hash: "a1b2c3", ... }]`
2. Agent calls `execute` → `graphql({ hash: "a1b2c3" })` → server resolves hash to query text and executes

### TOON Encoding

Both tools accept a `toon: boolean` parameter. When `true`, the sandbox result is encoded in [TOON (Token-Oriented Object Notation)](https://github.com/toon-format/toon-go) instead of JSON. TOON is a format optimized for LLM consumption that saves approximately 40% tokens on tabular/list data.

The server falls back to JSON silently if TOON encoding fails. Agents should only set `toon=true` if they can parse TOON.

### Mutation Approval via MCP Elicitation

When `require_mutation_approval` is enabled, the `graphql()` function in the execute sandbox detects mutations and pauses execution to request human operator approval via [MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).

**Mutation detection:** The server parses the GraphQL document using `astparser.ParseGraphqlDocumentString` and checks for `OperationTypeMutation`.

**Elicitation form schema:**

The elicitation uses form mode with a schema that captures both the approval decision and an optional reason. This design ensures the operator can always provide a reason — the MCP protocol only includes `content` data on the `accept` action, so we model rejection as "accept the form with `approved: false`" rather than relying on the protocol-level `decline` action.

```json
{
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "The agent wants to execute a mutation. Please review and approve or reject.\n\nMutation:\nmutation { deleteUser(id: \"123\") { id } }\n\nVariables: {}",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "approved": {
          "type": "boolean",
          "title": "Approve Mutation",
          "description": "Approve this mutation for execution?",
          "default": false
        },
        "reason": {
          "type": "string",
          "title": "Reason",
          "description": "Optional: reason for your decision",
          "maxLength": 500
        }
      },
      "required": ["approved"]
    }
  }
}
```

**Flow:**

1. Agent calls `graphql({ query: "mutation { deleteUser(id: \"123\") { id } }" })`.
2. The Go host function parses the operation and detects it is a mutation.
3. The host function sends the elicitation request to the MCP client.
4. The MCP client displays the mutation details and the approval form to the human operator.
5. Three outcomes:

| Outcome | MCP action | Form data | `graphql()` returns |
|---|---|---|---|
| **Approved** | `accept` | `{ approved: true }` | `{ data: { ... }, errors: null }` — normal execution result |
| **Rejected with reason** | `accept` | `{ approved: false, reason: "Too risky" }` | `{ data: null, errors: [...], declined: { reason: "Too risky" } }` |
| **Rejected without reason** | `accept` | `{ approved: false }` | `{ data: null, errors: [...], declined: { reason: null } }` |
| **Dismissed** | `decline` or `cancel` | (none) | `{ data: null, errors: [...], declined: { reason: null } }` |

The agent's code does not need special handling for the approval flow — it is transparent. The `await graphql(...)` call blocks until the human responds. The agent checks `if (result.declined)` to detect rejections.

When the MCP client does not support elicitation and `require_mutation_approval` is enabled, mutations are rejected with `declined: { reason: "mutation approval is required but the MCP client does not support elicitation: ..." }`.

### TypeScript Transpilation

**Chosen approach: esbuild Go API**

[esbuild](https://pkg.go.dev/github.com/evanw/esbuild/pkg/api) is written in Go and provides a native in-process Transform API. It can transpile TypeScript to JavaScript without spawning external processes.

```go
import "github.com/evanw/esbuild/pkg/api"

result := api.Transform(tsCode, api.TransformOptions{
    Loader: api.LoaderTS,
    Target: api.ES2020,
    Format: api.FormatIIFE,
})
// result.Code contains the transpiled JavaScript
```

**Why esbuild:**
- Written in Go — no external dependencies, no process spawning.
- Extremely fast — sub-millisecond transpilation for small code snippets.
- Mature, widely used, well-tested.
- Supports stripping types only (no full type-checking needed — the sandbox validates at runtime).

**Goja-specific transpilation:** When the goja runtime is selected, the transpiler additionally strips `async` and `await` keywords after esbuild compilation, since goja has no native Promise support. Async host functions are called synchronously (the goroutine blocks until the Go function returns).

### Secure JavaScript Sandbox

This is the most critical component. The sandbox must execute untrusted JavaScript safely within the Go router process.

#### Runtime Comparison

| Feature | **qjs/wazero** (QuickJS via WASM) | **goja** (pure Go) |
|---|---|---|
| CGo required | No | No |
| ECMAScript support | ES2023 | ES5.1 (+ ES2015 via transpilation) |
| Host fn injection (async → Promise) | Native via channel-based async | Synchronous blocking (async/await stripped) |
| Memory limits | Via WASM linear memory cap | No built-in |
| CPU/timeout | Go `context.WithTimeout` + WASM interrupt | `vm.Interrupt()` |
| Startup time | Fast (WASM precompiled) | Fast (pure Go) |
| Process isolation | WASM memory sandbox | Same Go process memory |
| Promise.all() concurrency | Go goroutines run concurrently; qjs resolves via channel | Sequential (no goroutine concurrency) |

#### Default: **qjs/wazero** ([fastschema/qjs](https://github.com/fastschema/qjs))

QuickJS compiled to WebAssembly, executed via Wazero. Selected via `sandbox.runtime_type: "qjs"` (default).

Rationale:
1. **No CGo** — Keeps the router build simple.
2. **WASM memory isolation** — WebAssembly provides hardware-level memory isolation. A sandbox cannot access Go heap memory.
3. **ES2023 support** — Combined with esbuild transpilation (TS → ES2020), provides full language support.
4. **Native async** — `Promise.all()` fans out Go goroutines concurrently; results flow back via channel-based mechanism.

**WASM concurrency model:** The WASM module is NOT thread-safe. `Promise.Resolve/Reject` from goroutines would cause panics. The implementation uses a channel-based async pattern: goroutines perform Go work (HTTP calls, Yoko API calls), results flow via an `asyncResult` channel, and the WASM thread resolves promises in an `awaitAsyncResults` polling loop.

#### Fallback: **goja**

Selected via `sandbox.runtime_type: "goja"`. Pure Go, widely used (Grafana k6, CockroachDB). The tradeoffs vs. qjs:
- No WASM memory isolation (shares Go heap).
- No built-in memory limits.
- No native Promise support — the transpiler strips `async`/`await` keywords and all `AsyncFunc` host functions are called synchronously (blocking the goroutine). This means `Promise.all()` provides no parallelism — calls are sequential.

### Host Function Injection (Go → JS)

The sandbox runtime interface abstracts over both qjs and goja:

```go
// From router/pkg/sandbox/runtime.go

type SyncFunc struct {
    Name string
    Fn   func(args []any) (any, error)
}

type AsyncFunc struct {
    Name string
    Fn   func(args []any) (any, error)
}

type ObjectDef struct {
    Name    string
    Methods map[string]func(args []any) (any, error)
}

type Runtime interface {
    Execute(ctx context.Context, jsCode string, syncFuncs []SyncFunc, asyncFuncs []AsyncFunc, objects []ObjectDef) (*Result, error)
}
```

#### Search Sandbox Injection

The search sandbox injects `generateQuery()` via the async function mechanism. The raw name is `__generate_query` (to avoid collision), and a preamble wraps it as `generateQuery`:

```go
// In handleSearch():
var asyncFuncs []sandbox.AsyncFunc
if s.yokoClient != nil {
    asyncFuncs = append(asyncFuncs, sandbox.AsyncFunc{
        Name: "__generate_query",
        Fn:   s.generateQueryFunc(ctx),
    })
}

jsCode = "(async function(){" + searchPreamble + "return " +
    strings.TrimRight(jsCode, "; \t\n\r") + ";})()"

result, err := s.sandboxPool.Execute(ctx, jsCode, nil, asyncFuncs, nil)
```

Where `searchPreamble` is:
```javascript
var generateQuery = function(prompt) { return __generate_query(prompt); };
```

The `generateQueryFunc` calls the Yoko REST API, computes xxhash64 hashes for each returned query, stores them in the query store, and returns `QueryResult[]` with `hash` fields.

#### Execute Sandbox Injection

The execute sandbox injects `graphql()` directly as an async function:

```go
// In handleExecute():
asyncFuncs := []sandbox.AsyncFunc{
    {
        Name: "graphql",
        Fn:   s.graphqlFunc(asyncCtx),
    },
}

result, err := s.sandboxPool.Execute(ctx, jsCode, nil, asyncFuncs, nil)
```

The `graphqlFunc` does:
1. Parses the options object (`query`, `hash`, `variables`, `operationName`)
2. Resolves `hash` to query text if needed (from the query store)
3. Checks for mutation + triggers MCP elicitation if `require_mutation_approval` is enabled
4. Sends HTTP POST to the router's GraphQL endpoint (`RouterGraphQLEndpoint`)
5. Forwards headers from the MCP request context (skipping hop-by-hop headers)
6. Returns the parsed JSON response

### Promise Combinators in the Sandbox

QuickJS (via qjs/wazero) supports ES2023 and includes all standard Promise combinators:

| Combinator | Supported | Use case |
|---|---|---|
| `Promise.all` | Yes | Fan out multiple queries, wait for all |
| `Promise.race` | Yes | Use first result that returns |
| `Promise.allSettled` | Yes | Fan out, tolerate partial failures |
| `Promise.any` | Yes | Use first success, ignore failures |

The Go goroutines backing each `graphql()` call run concurrently. The qjs WASM module itself is single-threaded — results are funneled back via a channel-based mechanism. The I/O (HTTP requests to the router) is parallelized.

**Note:** With goja, `Promise.all()` is syntactically supported (async/await is stripped) but all calls are sequential — no goroutine concurrency within the sandbox.

```typescript
// Fan out three queries in parallel (qjs: concurrent I/O; goja: sequential)
async () => {
  const [users, orders, products] = await Promise.all([
    graphql({ query: `{ users(first: 10) { id name } }` }),
    graphql({ query: `{ orders(first: 10) { id total } }` }),
    graphql({ query: `{ products(first: 10) { id name } }` }),
  ]);
  return { users: users.data, orders: orders.data, products: products.data };
}
```

### Security Model

#### Resource Limits

Every sandbox execution is bounded by:

| Limit | Default | Configurable | Enforcement |
|---|---|---|---|
| **Wall-clock timeout** | 5s | Yes | Go `context.WithTimeout` + WASM interrupt |
| **Memory** | 16MB | Yes | WASM linear memory cap |
| **CPU fuel** | 10M instructions | Yes (config) | Reserved for future use — not yet enforced at WASM level |
| **Input size** | 64KB | Yes | Checked before execution in `Pool.Execute()` |
| **Output size** | 1MB | Yes | Truncate response |

If any limit is exceeded, execution is terminated and an error is returned to the agent.

#### Sandbox Isolation Rules

1. **No network access** — The sandbox cannot make HTTP requests or open sockets. All external communication goes through injected host functions (`generateQuery()`, `graphql()`), which are Go-implemented.
2. **No filesystem access** — No `fs`, `path`, or file operations available.
3. **No environment variables** — No `process.env` or equivalent.
4. **No eval/Function constructor** — Prevent dynamic code generation within the sandbox.
5. **No timers** — No `setTimeout`, `setInterval`, or similar. Async is handled by Go host functions.
6. **Deterministic execution** — No `Math.random()`, no `Date.now()` (or frozen values). Prevents timing side-channels.

#### Attack Vectors and Mitigations

| Attack | Mitigation |
|---|---|
| Infinite loop / CPU exhaustion | Wall-clock timeout terminates execution |
| Memory bomb (e.g., growing arrays) | WASM memory cap (16MB default) |
| Oversized input code | Input size limit (64KB default) |
| Prompt injection via search results | `search` returns generated queries only, no user data |
| Data exfiltration via `graphql()` | Router's existing auth/authz applies to all operations |
| Abuse of `generateQuery()` | Yoko-side validation + sandbox timeout |
| Unauthorized mutations | MCP elicitation requires human approval |
| Sandbox escape | WASM provides hardware-enforced memory boundaries |
| Code injection via response values | All return values are JSON-serialized; no code execution on output path |
| Timing attacks | Wall-clock timeout; optionally fixed response times |

### MCP Transport

The agentic server uses MCP Streamable HTTP transport via `server.StreamableHTTPServer` from `mark3labs/mcp-go`:

- **Endpoint:** `/mcp` on the agentic server's TCP listener
- **Heartbeat interval:** 10 seconds
- **Stateless mode:** Configurable (default: true)
- **Request header injection:** MCP request HTTP headers are injected into context via `WithHTTPContextFunc(requestHeadersFromRequest)`, enabling `graphql()` to forward auth headers from the original MCP request to the router's GraphQL endpoint.
- **CORS:** When CORS is enabled on the router, the agentic server clones the CORS config and adds MCP-specific headers (`Content-Type`, `Accept`, `Authorization`, `Last-Event-ID`, `Mcp-Protocol-Version`, `Mcp-Session-Id`).

### Observability

The agentic server provides OpenTelemetry instrumentation under the meter `wundergraph.cosmo.router.mcp.agentic`:

| Instrument | Type | Description |
|---|---|---|
| `mcp.agentic.sandbox.executions` | Int64Counter | Total sandbox executions, attributed by `mcp.tool` and `mcp.status` |
| `mcp.agentic.sandbox.duration` | Float64Histogram (ms) | Duration of sandbox executions, attributed by `mcp.tool` and `mcp.status` |

Each tool invocation is wrapped in an OTel trace span (`MCP Agentic - Search` or `MCP Agentic - Execute`) with `SpanKindServer`.

### HTTP Client

The `graphql()` host function uses a retryable HTTP client (`hashicorp/go-retryablehttp`) with:
- 3 retries on transient failures
- 60-second overall timeout
- 10MB response body limit (prevents OOM from unexpectedly large responses)

### Configuration

```yaml
mcp:
  enabled: true
  # Existing per-operation MCP config...

  # Agentic Mode — separate MCP server with search + execute tools
  agentic_mode:
    enabled: false                     # MCP_AGENTIC_MODE_ENABLED
    server:
      listen_addr: "localhost:5027"    # MCP_AGENTIC_MODE_LISTEN_ADDR
    require_mutation_approval: true     # MCP_AGENTIC_MODE_REQUIRE_MUTATION_APPROVAL
    sandbox:
      runtime_type: "qjs"             # MCP_AGENTIC_MODE_SANDBOX_RUNTIME_TYPE ("qjs" or "goja")
      timeout: "5s"                    # MCP_AGENTIC_MODE_SANDBOX_TIMEOUT
      max_memory_mb: 16                # MCP_AGENTIC_MODE_SANDBOX_MAX_MEMORY_MB
      max_fuel: 10000000               # MCP_AGENTIC_MODE_SANDBOX_MAX_FUEL (reserved)
      max_input_size_bytes: 65536      # MCP_AGENTIC_MODE_SANDBOX_MAX_INPUT_SIZE_BYTES
      max_output_size_bytes: 1048576   # MCP_AGENTIC_MODE_SANDBOX_MAX_OUTPUT_SIZE_BYTES
    query_generation:
      enabled: false                   # MCP_AGENTIC_MODE_QUERY_GENERATION_ENABLED
      endpoint: ""                     # MCP_AGENTIC_MODE_QUERY_GENERATION_ENDPOINT
      auth:
        type: "static"                 # "static" or "jwt" (client credentials)
        static_token: ""               # YOKO_TOKEN
        token_endpoint: ""             # JWT token endpoint (if using client credentials)
        client_id: ""
        client_secret: ""
      timeout: "10s"                   # MCP_AGENTIC_MODE_QUERY_GENERATION_TIMEOUT
```

```go
type AgenticModeConfiguration struct {
    Enabled                 bool                         `yaml:"enabled" envDefault:"false" env:"MCP_AGENTIC_MODE_ENABLED"`
    Server                  AgenticModeServer            `yaml:"server,omitempty"`
    RequireMutationApproval bool                         `yaml:"require_mutation_approval" envDefault:"true" env:"MCP_AGENTIC_MODE_REQUIRE_MUTATION_APPROVAL"`
    Sandbox                 SandboxConfiguration         `yaml:"sandbox"`
    QueryGeneration         QueryGenerationConfiguration `yaml:"query_generation"`
}

type AgenticModeServer struct {
    ListenAddr string `yaml:"listen_addr" envDefault:"localhost:5027" env:"MCP_AGENTIC_MODE_LISTEN_ADDR"`
}

type SandboxConfiguration struct {
    RuntimeType        string        `yaml:"runtime_type" envDefault:"qjs" env:"MCP_AGENTIC_MODE_SANDBOX_RUNTIME_TYPE"`
    Timeout            time.Duration `yaml:"timeout" envDefault:"5s" env:"MCP_AGENTIC_MODE_SANDBOX_TIMEOUT"`
    MaxMemoryMB        int           `yaml:"max_memory_mb" envDefault:"16" env:"MCP_AGENTIC_MODE_SANDBOX_MAX_MEMORY_MB"`
    MaxFuel            uint64        `yaml:"max_fuel" envDefault:"10000000" env:"MCP_AGENTIC_MODE_SANDBOX_MAX_FUEL"`
    MaxInputSizeBytes  int           `yaml:"max_input_size_bytes" envDefault:"65536" env:"MCP_AGENTIC_MODE_SANDBOX_MAX_INPUT_SIZE_BYTES"`
    MaxOutputSizeBytes int           `yaml:"max_output_size_bytes" envDefault:"1048576" env:"MCP_AGENTIC_MODE_SANDBOX_MAX_OUTPUT_SIZE_BYTES"`
}

type QueryGenerationConfiguration struct {
    Enabled  bool                `yaml:"enabled" envDefault:"false" env:"MCP_AGENTIC_MODE_QUERY_GENERATION_ENABLED"`
    Endpoint string              `yaml:"endpoint" env:"MCP_AGENTIC_MODE_QUERY_GENERATION_ENDPOINT"`
    Auth     QueryGenerationAuth `yaml:"auth"`
    Timeout  time.Duration       `yaml:"timeout" envDefault:"10s" env:"MCP_AGENTIC_MODE_QUERY_GENERATION_TIMEOUT"`
}

type QueryGenerationAuth struct {
    Type          string `yaml:"type" envDefault:"static"`
    TokenEndpoint string `yaml:"token_endpoint"`
    ClientID      string `yaml:"client_id"`
    ClientSecret  string `yaml:"client_secret"`
    StaticToken   string `yaml:"static_token" env:"YOKO_TOKEN"`
}
```

### Sandbox Pool

The sandbox uses a semaphore-based concurrency limiter (default 4 slots) rather than a pre-warmed pool. Each `Execute()` call creates a fresh `Runtime` instance:

```go
type Pool struct {
    config      ExecutionConfig
    runtimeType RuntimeType
    sem         chan struct{} // semaphore for concurrency control
    closed      atomic.Bool
}
```

When all slots are in use, new requests block until a slot is available or the context is cancelled. This design avoids the complexity of pre-warming and lifecycle management while still bounding concurrent resource consumption.

### Relationship to Existing MCP Server

Agentic mode runs as a **separate HTTP server** on its own TCP listener, independent of the existing per-operation MCP server.

| | Per-operation MCP | Agentic Mode |
|---|---|---|
| Tools | One tool per `.graphql` operation file | Two tools: `search` + `execute` |
| Query discovery | Static, pre-deployed | Dynamic, via natural language |
| Server | Separate TCP listener (default `:5025`) | Separate TCP listener (default `:5027`) |
| MCP server name | `wundergraph-cosmo-mcp` | `wundergraph-cosmo-agentic` |

Both servers can run simultaneously. Clients connect to whichever server suits their use case. The separation ensures agentic mode has no impact on existing MCP functionality.

### Implementation Summary

#### Phase 1: Sandbox Infrastructure — Built

- Added `esbuild` and `fastschema/qjs` dependencies.
- Created `router/pkg/sandbox/` package:
  - `runtime.go` — `Runtime` interface, `SyncFunc`/`AsyncFunc`/`ObjectDef` abstractions.
  - `runtime_qjs.go` — QuickJS via WASM with channel-based async for thread safety.
  - `transpiler.go` — esbuild Transform API for TS → JS.
  - `pool.go` — Semaphore-based concurrency control, fresh runtime per execution.

#### Phase 2: Search Tool — Built (simplified from original design)

- Created `router/pkg/mcpserver/code_mode_server.go` and `code_mode_descriptions.go`.
- The original design included `schema.*` exploration APIs and `validate()` — these were removed. Only `generateQuery()` was implemented, which proved sufficient for agent query discovery.
- Published type definitions as MCP resources (`agentic://search-api.d.ts`).

#### Phase 3: Query Generation Integration (Yoko) — Built

- Created `router/pkg/yokoclient/` package:
  - `client.go` — HTTP client for the Yoko REST API. Supports two auth modes: `static` (bearer token) and `jwt` (client credentials flow with token caching).
  - `mock.go` — In-process mock implementation that generates queries from the schema AST.
- Created `router/cmd/yoko-mock/` — standalone mock server that delegates to the Claude CLI for development/testing.
- When `query_generation.enabled: false`, the `generateQuery()` function is not injected — the search tool returns an error.

#### Phase 4: Execute Tool — Built

- Implemented `graphql()` as an async Go host function that sends HTTP POST to the router's GraphQL endpoint (rather than calling an internal executor). This ensures the full router middleware stack (auth, rate limiting, etc.) applies.
- Added query hash resolution from the in-process store.
- Forwards headers from MCP request context to the GraphQL endpoint.

#### Phase 5: Mutation Approval & Hardening — Built

- Implemented mutation detection via `astparser`.
- Implemented MCP elicitation flow for mutation approval.
- Added OpenTelemetry metrics (execution count + duration histogram) and trace spans.
- Added CORS support (clones router CORS config with MCP-specific headers).
- Added retryable HTTP client (3 retries, 60s timeout).
- Added TOON encoding support for token-efficient responses.

## Alternative Options Considered

### 1. Client-Side Code Execution

Have the agent execute code locally (as Anthropic's Claude and Block's Goose do). Rejected because:
- Requires every MCP client to ship a secure sandbox.
- Inconsistent security posture across clients.
- Cannot enforce server-side rate limiting or auth.

### 2. Separate Process per Execution (Docker/Wasm containers)

Spawn a fresh process or container for each execution. Rejected because:
- Cold start latency too high (100ms+ per invocation).
- Operational complexity (Docker dependency).
- Overkill for sub-second script execution.

### 3. goja as Primary Runtime

Use goja instead of qjs/wazero as the default. Not rejected (it's the fallback), but qjs/wazero is preferred because:
- goja lacks memory isolation (shares Go heap).
- goja lacks built-in fuel metering.
- goja only supports ES5.1 natively (more transpilation burden).
- goja has no native Promise support — the implementation works around this by stripping `async`/`await` and calling async functions synchronously, but this means `Promise.all()` provides no parallelism.

### 4. Dynamic Tool Search (Search + Register Pattern)

Instead of code execution, provide a tool that searches operations and dynamically registers matching tools. Rejected because:
- Still consumes tokens for each discovered tool.
- Cannot compose novel queries.
- Adds round-trips (discover → register → call).

## Remaining Open Issues

1. **Schema hash for Yoko cache invalidation** — `generateQueryFunc` currently passes an empty string for `schemaHash`. Cache invalidation on schema changes is not yet implemented.
2. **Fuel metering enforcement** — `max_fuel` is present in configuration but marked as "reserved for future use" in the `ExecutionConfig` struct. Not yet enforced at the WASM level.

## Resolved Decisions

| Decision | Resolution |
|---|---|
| Schema exploration APIs | Removed from scope. `generateQuery()` alone proved sufficient for agent query discovery. Reduces API surface and token cost. |
| Module support | No. Single-file, no `import`. Communicated in the MCP tool description ("ES2020, no imports"). |
| State across calls | No. Each sandbox invocation is stateless — no shared state between calls. |
| Elicitation client support | When `require_mutation_approval` is enabled and the client doesn't support elicitation, reject the mutation with a reason explaining why. |
| Sandbox pool model | Semaphore-based concurrency control (default 4 slots) with fresh runtime per execution. Not a pre-warmed pool. |
| GraphQL execution path | HTTP POST to the router's GraphQL endpoint (not an internal executor call). Ensures the full middleware stack applies. |
| Default sandbox runtime | qjs (QuickJS via WASM). goja available as fallback via config. |
| Default auth type | `static` (bearer token). `jwt` (client credentials) available as alternative. |
