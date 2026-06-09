# Code Mode Demo

This demo starts a small local federation (`employees`, `family`, `availability`, and `mood`), the Code Mode Yoko mock, and a local Cosmo Router with Code Mode and named operations enabled.

## Prerequisites

- Go (toolchain matching the repo `go.mod`).
- Node + `pnpm` (used by `wgc` to compose `demo/code-mode/graph.yaml`).
- The `codex` CLI on `PATH`, authenticated.
  The Yoko mock shells out to `codex` for query generation;
  without it, `code_mode_search_tools` cannot generate operations.

## Quick start

Run it from the repository root:

```sh
make code-mode-demo
```

The root target builds `router/router`, builds `demo/code-mode/yoko-mock/yoko-mock`, builds `demo/code-mode/mcp-stdio-proxy/mcp-stdio-proxy` (used by stdio-only MCP clients like Claude Desktop), composes `demo/code-mode/graph.yaml` into `demo/code-mode/config.json`, then starts the demo processes.
The router stays in the foreground.

Expected ports:

- Router GraphQL: `http://localhost:3002/graphql`
- Code Mode MCP: `http://localhost:5027/mcp`
- Yoko mock: `http://localhost:5028`
- Employees subgraph: `http://localhost:4001/graphql`
- Family subgraph: `http://localhost:4002/graphql`
- Availability subgraph: `http://localhost:4007/graphql`
- Mood subgraph: `http://localhost:4008/graphql`

## Tearing down

To stop the demo, press Ctrl-C in the foreground terminal.
If anything is left behind (background subgraphs, yoko-mock), run:

```sh
make code-mode-demo-down
```

The process logs for background services are written to `/tmp/cosmo-code-mode-demo-logs`.

## Manual smoke check

```sh
make code-mode-demo
curl -sS http://localhost:3002/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ employees { id details { forename surname } } }"}'
```

## Other notes

The subset runner is `demo/code-mode/run_subgraphs_subset.sh`. It starts only `employees`, `family`, `availability`, and `mood` via `npx concurrently` for a fast demo. `availability` and `mood` are included because the `employees` schema has federation references to fields owned by those subgraphs. The full demo `demo/run_subgraphs.sh` starts all subgraphs and is intentionally not used here.

Client configuration for Code Mode MCP clients (Claude Code, Claude Desktop, Codex CLI) lives under `demo/code-mode/mcp-configs/` — see the README there.

For the alternate "Connect" variant of this demo, which runs the same Code Mode router against an external `yoko` Connect supergraph instead of the local employees federation, see `demo/code-mode-connect/README.md`.
