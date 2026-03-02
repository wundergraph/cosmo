package mcpserver

// Tool descriptions and schemas for the Code Mode MCP server.
// These are the exact tool descriptions that MCP clients (and thus LLMs) see.
// The TypeScript type specs are embedded inline so agents can write correct code
// without extra round-trips.

const searchToolName = "search"

const searchToolDescription = `Generate GraphQL queries from natural language. Returns QueryResult[].
Write a single async arrow function (ES2020, no imports). Write compact code.

interface QueryResult { query: string; variables: Record<string, any>; description: string; hash: string; }
declare function generateQueries(...prompts: string[]): Promise<QueryResult[]>;

Pass multiple prompts to generate queries in parallel (faster than separate calls).
Results include a hash — pass it to graphql() in the execute tool to save tokens.

Example:
  return await generateQueries("find items matching criteria", "mutation to update item status");`

const executeToolName = "execute"

const executeToolDescription = `Execute GraphQL operations against the supergraph. Returns any JSON-serializable value.
Write a single async arrow function (ES2020, no imports). Write compact code.

This tool runs your code in a sandbox with one global function: graphql(options).
  await graphql({ hash: "abc123" })                           // by hash (preferred)
  await graphql({ query: "{ users { id } }", variables: {} }) // by query string
There is no execute() function — graphql() is the only way to run operations.
Response data is in result.data. Prefer hash (from search) over query to save tokens.

Use search first to get queries with hashes, then solve all tasks in one call to this tool.
Write all logic in the function — loops, conditionals, filtering, aggregation.
When given multiple tasks, fetch all data with Promise.all(), process each task, return all results.

interface GraphQLOptions { query?: string; variables?: Record<string, any>; operationName?: string; hash?: string; }
interface GraphQLResponse { data: any | null; errors: GraphQLError[] | null; declined?: { reason: string | null; }; }
interface GraphQLError { message: string; path: (string | number)[] | null; extensions: Record<string, any> | null; }

Example (multiple tasks in one call):
  const [a, b] = await Promise.all([graphql({ hash: h1 }), graphql({ hash: h2 })]);
  for (const x of a.data.items.filter(i => !i.ok)) await graphql({ hash: fixHash, variables: { id: x.id } });
  return { task1: a.data.items.length, task2: b.data.items.map(i => i.name) };

Example (read → filter → mutate — single call):
  const r = await graphql({ hash: listHash });
  const targets = r.data.items.filter(i => !i.active);
  for (const t of targets) await graphql({ hash: updateHash, variables: { id: t.id, active: true } });
  return { updated: targets.map(t => t.id) };

Mutations may require human approval. If result.declined is set, the operator declined the mutation.`

// MCP resource URIs for type definitions.
const searchAPIResourceURI = "code-mode://search-api.d.ts"
const executeAPIResourceURI = "code-mode://execute-api.d.ts"

// searchTypeDefs is served as an MCP resource for agents that support resource fetching.
const searchTypeDefs = `// Search sandbox — write a single async arrow function (ES2020, no imports), return QueryResult[].

interface QueryResult {
  query: string;                    // GraphQL query string, ready for execute
  variables: Record<string, any>;   // Variable values (defaults/examples)
  description: string;              // What this query does
  hash: string;                     // Hash — pass to graphql() instead of query to save tokens
}

// Globals

// Generates ready-to-execute GraphQL queries from natural language.
// Pass multiple prompts to generate queries in parallel.
declare function generateQueries(...prompts: string[]): Promise<QueryResult[]>;
`

// executeTypeDefs is served as an MCP resource for agents that support resource fetching.
const executeTypeDefs = `// Execute sandbox — write a single async arrow function (ES2020, no imports), return any JSON-serializable value.
//
// The sandbox provides one global function:

declare function graphql(options: GraphQLOptions): Promise<GraphQLResponse>;

// Call with hash:  await graphql({ hash: "abc123" })
// Call with query: await graphql({ query: "{ ... }", variables: { ... } })
// Response data is in result.data. Prefer hash over query to save tokens.
// There is no execute() function — graphql() is the only way to run operations.

interface GraphQLOptions {
  query?: string;                     // GraphQL query or mutation string
  variables?: Record<string, any>;    // Operation variables
  operationName?: string;             // Operation name (if multiple in document)
  hash?: string;                      // Hash from search — use instead of query to save tokens
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

// Solve the entire task in ONE call to this tool.
// Read data, inspect it, decide what to do, mutate, and return — all in one function.
// For multiple tasks, fetch all data with Promise.all(), process each, return all results.
//
// Example (multiple tasks in one call):
//   const [a, b] = await Promise.all([graphql({ hash: h1 }), graphql({ hash: h2 })]);
//   for (const x of a.data.items.filter(i => !i.ok)) await graphql({ hash: fixHash, variables: { id: x.id } });
//   return { task1: a.data.items.length, task2: b.data.items.map(i => i.name) };
//
// Example (read → filter → mutate — single call):
//   const r = await graphql({ hash: listHash });
//   const targets = r.data.items.filter(i => !i.active);
//   for (const t of targets) await graphql({ hash: updateHash, variables: { id: t.id, active: true } });
//   return { updated: targets.map(t => t.id) };
//
// Mutations may require human approval. A declined mutation returns:
// { data: null, declined: { reason: "..." } }
// Check with: if (result.declined) { ... result.declined.reason ... }
`
