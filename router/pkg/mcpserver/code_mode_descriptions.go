package mcpserver

// Tool descriptions and schemas for the Code Mode MCP server.
// These are the exact tool descriptions that MCP clients (and thus LLMs) see.
// The TypeScript type specs are embedded inline so agents can write correct code
// without extra round-trips.

const searchToolName = "search_graphql"

const searchToolDescription = `Search the GraphQL supergraph for operations matching natural language prompts.
Returns operations with query strings, hashes, and ready-to-use JS snippets for execute_graphql.
Do NOT call this tool multiple times — pass all prompts in one call.

Each result contains:
  query: string        — the GraphQL query/mutation
  variables: object    — example variable values
  description: string  — what the operation does
  hash: string         — identifier for use with executeOperationByHash() inside your code
  execute: string      — JS expression to use inside your async arrow function in execute_graphql

Workflow: search_graphql (1 call) → execute_graphql (1 call) = done. Never revisit either tool.

Example:
  prompts: ["list all employees", "mutation to update employee department"]`

const executeToolName = "execute_graphql"

const executeToolDescription = `Execute GraphQL operations. The "code" parameter must be an async arrow function (ES2020, no imports).
Do NOT call this tool multiple times. Fetch data, inspect it, decide, mutate, and return — ALL in one function.
Do NOT fetch data in one call and process/mutate in another — combine everything into a single function.
Write compact code: no comments, no blank lines, short variable names. Every token costs money.

Your code runs in a JS sandbox with full language support: loops, conditionals, Promise.all, try/catch, array methods.
The ONLY available global is:
  executeOperationByHash(hash: string, variables?: Record<string, any>): Promise<{data, errors, declined?}>

Use hashes from search_graphql results. Do NOT pass query strings. Response data is in result.data.
Mutations may require human approval — check result.declined.

Example (fetch → inspect → mutate → analyze — all in one call):
  async () => {
    const r = await executeOperationByHash(listHash);
    const items = r.data.items;
    for (const i of items.filter(x => !x.active)) await executeOperationByHash(activateHash, {id: i.id});
    return { activated: items.filter(x => !x.active).length, byType: items.reduce((a,i) => (a[i.type]=(a[i.type]||0)+1,a), {}) };
  }`

// MCP resource URI for execute tool type definitions.
const executeAPIResourceURI = "code-mode://execute-api.d.ts"

// executeTypeDefs is served as an MCP resource for agents that support resource fetching.
const executeTypeDefs = `// The "code" parameter must be an async arrow function (ES2020, no imports).
// Do NOT call this tool multiple times. Do everything in ONE function.
// Do NOT fetch data in one call and mutate in another — combine into a single function.
// Write compact code: no comments, no blank lines, short variable names. Every token costs money.
//
// Your code has full JS: loops, conditionals, Promise.all, try/catch, array methods.
// The ONLY global function is executeOperationByHash.

declare function executeOperationByHash(hash: string, variables?: Record<string, any>): Promise<GraphQLResponse>;

// hash: from search_graphql results. Do NOT pass GraphQL query strings.
// variables: optional. Example: executeOperationByHash("abc123", { id: 1 })
// Response data is in result.data. Check result.declined for rejected mutations.

interface GraphQLResponse {
  data: any | null;
  errors: GraphQLError[] | null;
  declined?: { reason: string | null };
}

interface GraphQLError {
  message: string;
  path: (string | number)[] | null;
  extensions: Record<string, any> | null;
}

// Example (fetch → inspect → mutate → analyze — all in one call):
//   async () => {
//     const r = await executeOperationByHash(listHash);
//     const items = r.data.items;
//     for (const i of items.filter(x => !x.active)) await executeOperationByHash(activateHash, {id: i.id});
//     return { activated: items.filter(x => !x.active).length, byType: items.reduce((a,i) => (a[i.type]=(a[i.type]||0)+1,a), {}) };
//   }
`
