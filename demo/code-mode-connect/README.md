# Code Mode Connect Demo

This demo runs the Code Mode router against an external `yoko` Connect supergraph instead of the local employees federation used by `make code-mode-demo`.
It is useful when you want to exercise Code Mode against a richer set of plugins (Pylon, Linear, PostHog, Circleback, Slack, Notion) served by the `yoko` project.

It is designed to coexist with `make code-mode-demo`: it uses different ports (router 3012, MCP 5037, yoko-mock 5038), so both demos can run side-by-side.

## Prerequisites

- A local checkout of the `yoko` Connect supergraph project (separate repository).
  Inside that checkout you must already have built the plugins and composed the supergraph so that the directory contains:
  - `config.json` — the composed router config for the yoko supergraph.
  - `plugins/` — the plugin binaries the router will load.
- Go (toolchain matching the repo `go.mod`).
- The `codex` CLI on `PATH`, authenticated. The Yoko mock shells out to `codex` for query generation.

## Run

From the repository root, set `YOKO_DIR` to your local yoko checkout and run:

```sh
make code-mode-connect-demo YOKO_DIR=/path/to/yoko
```

`YOKO_DIR` is required.
The target fails fast with a clear error if it is missing or if the directory does not contain `config.json`.

What the target does:

1. Builds `router/router`.
2. Builds `demo/code-mode/yoko-mock/yoko-mock`.
3. Starts `yoko-mock` on `localhost:5038`.
4. Starts the router with `YOKO_DIR` as its working directory and `demo/code-mode-connect/router-config.yaml` as its config.
   The router resolves `config.json` and `plugins/` relative to that CWD, which is why `YOKO_DIR` must be a real composed yoko checkout.

Expected ports:

- Router GraphQL: `http://localhost:3012/graphql`
- Code Mode MCP: `http://127.0.0.1:5037/mcp`
- Yoko mock: `http://localhost:5038`

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
