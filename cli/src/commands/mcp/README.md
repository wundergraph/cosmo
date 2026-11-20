# WunderGraph Cosmo Model Context Protocol (MCP) Server

This directory contains the implementation for the `wgc mcp` command, which starts a Model Context Protocol (MCP) server. This server allows AI models (like large language models) to interact with your WunderGraph Cosmo Platform data and perform specific actions related to your GraphQL APIs.

## Note

The MCP server is currently in beta and may change at any time. Please be aware that features and functionality might be updated frequently or even be removed.

## Setup

The MCP server is designed to be run directly via the WunderGraph Cosmo CLI.
Ensure you have the CLI installed and configured to connect to your Cosmo Platform instance.

To configure Cosmo MCP, e.g. for tools like Cursor, you need to modify your Cursor settings (`~/.cursor/mcp.json`) as follows:

```json
{
  "mcpServers": {
    "cosmo": {
      "command": "npx wgc",
      "args": ["mcp"],
      "env": {
        "COSMO_API_KEY": "cosmo_<redacted>"
      }
    }
  }
}
```

The server will start, connect using standard input/output (stdio),
and register the available tools for the connected AI model to use.
The runs fully locally in the context of the CLI,
which means that you'll need an API key to connect to the Cosmo Platform.

## Analytics

The analytics tools answer questions about traffic, latency, errors, clients, field usage, traces, routers, checks and request usage. They are read-only: they call only the RPCs in `ANALYTICS_READ_RPCS` (`@wundergraph/cosmo-shared`), and none of those write to Postgres, ClickHouse, blob storage or webhooks.

### Options

- `--auth user|api-key`: how every tool authenticates. `user` uses your `wgc auth login` session and refreshes it as needed; namespace login-method restrictions apply. `api-key` uses `COSMO_API_KEY`, whose group permissions apply but which bypasses namespace login-method restrictions. Defaults to `api-key` when `COSMO_API_KEY` is set, otherwise `user`.
- `--toolsets schema,analytics`: which tools to register. Both by default; an unknown name is an error.

When you use an API key, give it a group with only the roles and namespaces it needs; for analytics alone, `graph-viewer` is enough.

### Tools

- **`get_analytics_context`**: Organization, principal, retention per data family, trace sampling ceiling and request limit.
- **`get_graph_overview`** / **`get_subgraph_overview`**: Request rate, latency and error rate, with the previous period and top operations.
- **`list_operations`**: Operations ranked by requests, latency or errors, with deprecated-field usage.
- **`get_operation`**: Document, clients, deprecated fields and metrics of one operation.
- **`get_field_usage`**: Clients and operations using a field, argument or input field.
- **`search_traces`**: Sampled requests by any request field or root-span attribute (`attr:<key>`), and by span conditions (e.g. a fetch to subgraph `products` over 50 s). Each operation of a batched request is matched on its own. Paged with a cursor.
- **`get_trace`**: One trace: a summary (time per router phase and per subgraph, the critical path, every error with downstream error codes) and the spans, or the full spans with events and resource attributes.
- **`query_analytics`**: Any question one dataset can answer: dimensions, measures, filters, `having`, sorting and time buckets, across one graph, several or all readable graphs. Datasets: `operation_metrics`, `subgraph_metrics`, `planning_metrics`, `request_volume`, `requests`, `spans`, `field_usage`, `schema_presence`, `router_runtime`, `operation_documents`.
- **`list_dimension_values`**: The values of one dimension with counts, or (`attributeKeys`) every span attribute key stored.
- **`compare_periods`**: A window against the previous period or a custom baseline, with `<measure>Baseline`, `Delta` and `DeltaPct`.
- **`analyze_spans`**: Where the time goes, per span name, subgraph or span attribute.
- **`get_error_breakdown`**: Exact error counts from metrics, or failing sampled requests grouped by message, status, client, operation or subgraph, each with an example trace.
- **`list_clients`**: Client names and versions with traffic, and registered clients without traffic.
- **`search_operation_documents`**: Operations whose normalized document contains a text.
- **`get_change_timeline`**: Compositions and their schema changes, newest first.
- **`list_routers`**: Router instances, versions, compositions and resource usage.
- **`get_usage_and_quota`**: Monthly request usage per graph, a forecast and the plan limit (organization admins).
- **`get_check_impact`**: Schema checks and the operations their changes affect.

The server also serves three resources, `cosmo://analytics/guide` (what each number means), `cosmo://analytics/datasets` (every dataset, dimension and measure) and `cosmo://analytics/context` (the caller's retention and datasets), and seven prompts: `investigate-slow-operation`, `incident-triage`, `deprecation-cleanup-report`, `unused-schema-report`, `client-adoption-report`, `release-impact` and `weekly-graph-health`.

Generic queries are bounded: the controlplane estimates the rows a query reads before running it and refuses one above `ANALYTICS_QUERY_ROW_BUDGET` (default 200,000,000).

Requests from these tools carry `x-cosmo-client: wgc-mcp/<version>`, which the controlplane rate-limits per organization (`ANALYTICS_MCP_RATE_LIMIT_PER_MINUTE`, default 120).

## Available Tools

The MCP server exposes several tools that an AI model can utilize:

### Subgraph Management

- **`list_subgraphs`**: Lists all subgraphs registered in your Cosmo Platform instance.
  - _Use Case_: Discovering available subgraphs.
- **`get_subgraphs`**: Retrieves detailed information for specified subgraphs, including their GraphQL Schema Definition Language (SDL).
  - _Use Case_: Inspecting the schema or configuration of specific subgraphs.
- **`introspect_subgraph`**: Introspects a running subgraph endpoint to retrieve its current GraphQL schema.
  - _Use Case_: Fetching the latest schema directly from a subgraph instance, useful for verifying deployments or comparing against registered schemas.
- **`subgraph_verify_schema_changes`**: Validates proposed changes to a subgraph's schema. It checks for valid GraphQL SDL, composition compatibility with other subgraphs, and potential breaking changes against client traffic (optional).
  - _Use Case_: Safely validating schema modifications before deployment.

### Supergraph (Federated Graph) Management

- **`list_supergraphs`**: Lists all federated graphs (Supergraphs) in your Cosmo Platform instance, optionally filtered by namespace.
  - _Use Case_: Discovering available Supergraphs.
- **`fetch_supergraph`**: Fetches the composed schema (SDL and client schema) and configuration details for a specific Supergraph.
  - _Use Case_: Examining the structure and configuration of a Supergraph.
- **`fetch_supergraph_router_config`**: Retrieves the router configuration (e.g., for WunderGraph Cosmo Router) for a specific Supergraph.
  - _Use Case_: Obtaining the necessary configuration to run a compatible router instance.
- **`fetch_supergraph_subgraphs`**: Fetches a list of all subgraphs that are part of a specific Supergraph, including their individual schemas and routing information.
  - _Use Case_: Understanding the composition of a Supergraph and its constituent subgraphs.

### Schema Evolution & Query Workflows

- **`schema_change_proposal_workflow`**: Generates a step-by-step guide or set of instructions for making a specific schema change to a Supergraph safely and effectively.
  - _Use Case_: Assisting developers in planning and executing schema changes.
- **`dream_query_workflow`**: Takes a desired GraphQL query and generates instructions on the necessary schema modifications across relevant subgraphs to support that query within a Supergraph.
  - _Use Case_: Streamlining the process of evolving the Supergraph schema to meet new data requirements expressed via GraphQL queries.
- **`verify_query_against_remote_schema`**: Validates a given GraphQL query against the schema of a deployed Supergraph in your Cosmo Platform instance.
  - _Use Case_: Checking if a query is valid before integrating it into an application.
- **`verify_query_against_in_memory_schema`**: Validates a given GraphQL query against a provided Supergraph schema string (e.g., a locally composed schema).
  - _Use Case_: Testing queries against local or proposed schema changes without needing a deployed Supergraph.

### Supergraph Changelog

- **`supergraph_changelog`**: Fetches the changelog for a federated graph / Supergraph.
  - _Use Case_: Reviewing the history of schema changes and composition updates for a Supergraph.

### Router Configuration Verification

- **`verify_router_config`**: Verifies a provided Cosmo Router configuration (JSON or YAML) for validity.
  - _Use Case_: Ensuring a proposed router configuration is syntactically correct and valid before deployment.
- **`cosmo_router_config_reference`**: Provides a reference for the Cosmo Router configuration.
  - _Use Case_: Understanding the syntax and structure of the Cosmo Router configuration.

### Documentation Search

- **`search_docs`**: Searches the official WunderGraph Cosmo documentation for a given query.
  - _Use Case_: Finding relevant documentation pages for specific features, concepts, or troubleshooting steps.

These tools enable AI models to interact with and manage your federated GraphQL architecture through the MCP server interface.
