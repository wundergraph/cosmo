# Code Mode Connect Demo

This demo runs the Code Mode router against an external `yoko` Connect supergraph instead of the local employees federation used by `make code-mode-demo`.
It is useful when you want to exercise Code Mode against a richer set of plugins (Pylon, Linear, PostHog, Circleback, Slack, Notion) served by the `yoko` project.

It is designed to coexist with `make code-mode-demo`: it uses different router/MCP ports (router 3012, MCP 5037), and both demos share the same external Yoko service at `http://127.0.0.1:3400` (override with `YOKO_URL=...`).

## Prerequisites

- A local checkout of the `yoko` Connect supergraph project (separate repository).
  Inside that checkout you must already have built the plugins and composed the supergraph so that the directory contains:
  - `config.json` — the composed router config for the yoko supergraph.
  - `plugins/` — the plugin binaries the router will load.
- Go (toolchain matching the repo `go.mod`).
- A running Yoko service reachable at `http://127.0.0.1:3400` (override with `YOKO_URL=...`).
  The router calls Yoko for query generation; without it, `code_mode_search_tools` cannot generate operations.

## Run

From the repository root, set `YOKO_DIR` to your local yoko checkout and run:

```sh
make code-mode-connect-demo YOKO_DIR=/path/to/yoko
```

`YOKO_DIR` is required.
The target fails fast with a clear error if it is missing or if the directory does not contain `config.json`.

What the target does:

1. Builds `router/router`.
2. Health-checks the external Yoko service at `$YOKO_URL/health` (default `http://127.0.0.1:3400`).
3. Starts the router with `YOKO_DIR` as its working directory and `demo/code-mode-connect/router-config.yaml` as its config.
   The router resolves `config.json` and `plugins/` relative to that CWD, which is why `YOKO_DIR` must be a real composed yoko checkout.

Expected ports:

- Router GraphQL: `http://localhost:3012/graphql`
- Code Mode MCP: `http://127.0.0.1:5037/mcp`
- Yoko (external): `http://127.0.0.1:3400`

## Tearing down

Press Ctrl-C in the foreground terminal.
If anything is left behind, run:

```sh
make code-mode-connect-demo-down
```

The process logs for background services are written to `/tmp/cosmo-code-mode-connect-demo-logs`.

## Auth headers

`router-config.yaml` propagates the auth headers expected by the yoko plugins (`X-Pylon-Token`, `X-Linear-Token`, `X-Posthog-Token`, `X-Circleback-Token`, `X-Slack-Token`, `X-Notion-Token`, etc.).
Provide values for these on the request side when calling the router so the plugins can reach their upstream services.
