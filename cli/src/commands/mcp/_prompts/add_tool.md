# Add Tool Workflow

Instructions to add a new tool to the Cosmo MCP server

## Step 1: Add the tool to the `tools` directory

Add a new file to the `tools` directory, e.g. `cli/src/commands/mcp/tools/my-tool.ts`.
The tool name should be in snake_case and can be typically derived from the instructions of the use case.

Tool name template: `<use_case>`

## Step 2: Implement the tool

Typically, the tool can be implemented by copying the logic from existing cli commands.
You can find them in the `cli/src/commands/` directory.

## Step 3: Export the tool

Add an entry to the `cli/src/commands/mcp/tools/index.ts` file to export the tool.

## Step 4: Register the tool

Add the tool to the `registerTools` function in the `cli/src/commands/mcp/index.ts` file.

## Step 5: Update the README

Update the `cli/src/commands/mcp/README.md` file to reflect the new tool.

Example:

```md
- **`schema-change-proposal-workflow`**: Generates a step-by-step guide or set of instructions for making a specific schema change to a Supergraph safely and effectively.
  - _Use Case_: Assisting developers in planning and executing schema changes.
```

# Add an Analytics Tool

Analytics tools are read-only and live in `cli/src/commands/mcp/analytics/tools/`, one file per tool, each exporting a `register<Name>Tool(ctx: AnalyticsToolContext)` function.

## Step 1: Check the RPCs

`ctx.client` exposes only the RPCs in `ANALYTICS_READ_RPCS` (`shared/src/analytics/read-rpcs.ts`). To call another RPC, add it there. The controlplane tests then require a request for it in `controlplane/test/analytics/read-only.test.ts` (which fails if it writes to Postgres, blob storage or webhooks), and `controlplane/test/analytics/analytics-read-rpcs.test.ts` checks that it rate-limits MCP clients, which its handler gets by authenticating with `authenticateAnalyticsRead`.

## Step 2: Register the tool

Use `registerAnalyticsTool(ctx, name, { title, description, inputSchema }, handler)` from `analytics/context.ts`. It marks the tool read-only and turns a thrown error into an error result. Pass the handler's `headers` to every RPC call.

Build the input from the shared pieces:

- `graphInput` (`context.ts`) for one graph, or `graphsInput` with `toGraphRefs` (`query-rpc.ts`) for several.
- `windowInput` (`window.ts`) for a time window.
- `filterInput` with `toPredicate` (`query-rpc.ts`) for the query RPCs, `metricsFilterInput` with `metricsFilters` (`metrics-rpc.ts`) for the metrics RPCs.

Convert the window with the helper for the RPC's family, all in `window.ts`:

- The query RPCs (`QueryAnalytics`, `GetAnalyticsDimensionValues`, `SearchTraces`): `queryWindow(input)`. The server clamps the window to retention and reports it.
- The metrics RPCs: `retainedWindow(ctx, input, family)`, then `metricsWindow(window)` or `dashboardWindow(window)`. These RPCs cut a window to retention without saying so, so report the warnings `retainedWindow` returns.
- RPCs that take only dates: `absoluteWindow(input, defaultRange, ctx.now())`.

## Step 3: Return the result

Return `ok(data, meta)` from `envelope.ts`, and `fail(message)` with the message `checkResponse` gives for a non-OK response. For the query RPCs, `rowsToObjects` and `serverMeta` (`query-rpc.ts`) map the rows and the server's provenance. Cut long telemetry strings with `truncateValue` (`format.ts`), and link the matching Studio page with `studioUrl` (`links.ts`).

## Step 4: Register, test and document it

Call the register function from `registerAnalyticsTools` in `analytics/server.ts` and add the tool name to the list in `cli/test/mcp/analytics/server.test.ts`. Test it with `fakeContext` (`cli/test/mcp/analytics/fake-context.ts`), which serves the RPCs from a fake platform. List the tool under Analytics in `cli/src/commands/mcp/README.md`.
