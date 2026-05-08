# Code Mode Demo

This demo starts a local federation of all non-EDFS demo subgraphs (`employees`, `family`, `hobbies`, `products`, `test1`, `availability`, `mood`, `countries`, plus the `products_fg` feature graph under feature flag `myff`) and a local Cosmo Router with Code Mode and named operations enabled. The router talks to an external Yoko service for query generation — start that separately before running the demo.

The set mirrors `demo/graph-no-edg.yaml`. The `employeeupdated` subgraph is intentionally excluded because it relies on EDFS (NATS) streams.

## Prerequisites

- Go (toolchain matching the repo `go.mod`).
- Node + `pnpm` (used by `wgc` to compose `demo/code-mode/graph.yaml`).
- A running Yoko service reachable at `http://127.0.0.1:3400` (override with `YOKO_URL=...`).
  The router calls Yoko for `code_mode_search_tools`; without it, query generation will fail.

## Quick start

Run it from the repository root:

```sh
make code-mode-demo
```

The root target builds `router/router`, builds `demo/code-mode/mcp-stdio-proxy/mcp-stdio-proxy` (used by stdio-only MCP clients like Claude Desktop), composes `demo/code-mode/graph.yaml` into `demo/code-mode/config.json`, then starts the demo processes.
The router stays in the foreground. `start.sh` health-checks the external Yoko service before the router starts.

Expected ports:

- Router GraphQL: `http://localhost:3002/graphql`
- Code Mode MCP: `http://localhost:5027/mcp`
- Yoko (external): `http://127.0.0.1:3400`
- Employees subgraph: `http://localhost:4001/graphql`
- Family subgraph: `http://localhost:4002/graphql`
- Hobbies subgraph: `http://localhost:4003/graphql`
- Products subgraph: `http://localhost:4004/graphql`
- Test1 subgraph: `http://localhost:4006/graphql`
- Availability subgraph: `http://localhost:4007/graphql`
- Mood subgraph: `http://localhost:4008/graphql`
- Countries subgraph: `http://localhost:4009/graphql`
- Products_fg feature graph: `http://localhost:4010/graphql`

## Tearing down

To stop the demo, press Ctrl-C in the foreground terminal.
If anything is left behind (background subgraphs), run:

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

The subset runner is `demo/code-mode/run_subgraphs_subset.sh`. It starts every non-EDFS subgraph used by this demo (`employees`, `family`, `hobbies`, `products`, `test1`, `availability`, `mood`, `countries`, `products_fg`) via `npx concurrently`. The full demo `demo/run_subgraphs.sh` additionally starts the EDFS-dependent `employeeupdated` subgraph and is intentionally not used here.

Client configuration for Code Mode MCP clients (Claude Code, Claude Desktop, Codex CLI) lives under `demo/code-mode/mcp-configs/` — see the README there.

For the alternate "Connect" variant of this demo, which runs the same Code Mode router against an external `yoko` Connect supergraph instead of the local employees federation, see `demo/code-mode-connect/README.md`.
