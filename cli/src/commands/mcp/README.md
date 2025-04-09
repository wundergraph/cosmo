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
      "args": [
        "mcp"
      ],
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

## Available Tools

The MCP server exposes several tools that an AI model can utilize:

### Subgraph Management

-   **`mcp_cosmo_list_subgraphs`**: Lists all subgraphs registered in your Cosmo Platform instance.
    -   *Use Case*: Discovering available subgraphs.
-   **`mcp_cosmo_get_subgraphs`**: Retrieves detailed information for specified subgraphs, including their GraphQL Schema Definition Language (SDL).
    -   *Use Case*: Inspecting the schema or configuration of specific subgraphs.
-   **`mcp_cosmo_introspect_subgraph`**: Introspects a running subgraph endpoint to retrieve its current GraphQL schema.
    -   *Use Case*: Fetching the latest schema directly from a subgraph instance, useful for verifying deployments or comparing against registered schemas.
-   **`mcp_cosmo_subgraph_verify_schema_changes`**: Validates proposed changes to a subgraph's schema. It checks for valid GraphQL SDL, composition compatibility with other subgraphs, and potential breaking changes against client traffic (optional).
    -   *Use Case*: Safely validating schema modifications before deployment.

### Supergraph (Federated Graph) Management

-   **`mcp_cosmo_list_supergraphs`**: Lists all federated graphs (Supergraphs) in your Cosmo Platform instance, optionally filtered by namespace.
    -   *Use Case*: Discovering available Supergraphs.
-   **`mcp_cosmo_fetch_supergraph`**: Fetches the composed schema (SDL and client schema) and configuration details for a specific Supergraph.
    -   *Use Case*: Examining the structure and configuration of a Supergraph.
-   **`mcp_cosmo_fetch_supergraph_router_config`**: Retrieves the router configuration (e.g., for WunderGraph Cosmo Router) for a specific Supergraph.
    -   *Use Case*: Obtaining the necessary configuration to run a compatible router instance.
-   **`mcp_cosmo_fetch_supergraph_subgraphs`**: Fetches a list of all subgraphs that are part of a specific Supergraph, including their individual schemas and routing information.
    -   *Use Case*: Understanding the composition of a Supergraph and its constituent subgraphs.

### Schema Evolution & Query Workflows

-   **`mcp_cosmo_schema_change_proposal_workflow`**: Generates a step-by-step guide or set of instructions for making a specific schema change to a Supergraph safely and effectively.
    -   *Use Case*: Assisting developers in planning and executing schema changes.
-   **`mcp_cosmo_dream_query_workflow`**: Takes a desired GraphQL query and generates instructions on the necessary schema modifications across relevant subgraphs to support that query within a Supergraph.
    -   *Use Case*: Streamlining the process of evolving the Supergraph schema to meet new data requirements expressed via GraphQL queries.
-   **`mcp_cosmo_verify_query_against_remote_schema`**: Validates a given GraphQL query against the schema of a deployed Supergraph in your Cosmo Platform instance.
    -   *Use Case*: Checking if a query is valid before integrating it into an application.
-   **`mcp_cosmo_verify_query_against_in_memory_schema`**: Validates a given GraphQL query against a provided Supergraph schema string (e.g., a locally composed schema).
    -   *Use Case*: Testing queries against local or proposed schema changes without needing a deployed Supergraph.

### Supergraph Changelog

-   **`mcp_cosmo_supergraph_changelog`**: Fetches the changelog for a federated graph / Supergraph.
    -   *Use Case*: Reviewing the history of schema changes and composition updates for a Supergraph.

These tools enable AI models to interact with and manage your federated GraphQL architecture through the MCP server interface.
