# Yoko Mock

This is a demo implementation of the Code Mode `YokoService` Connect RPC. It indexes a supergraph SDL in memory, then shells out to the host `codex` CLI to generate GraphQL operations for natural-language prompts.

## Run

From the repository root:

```sh
go run ./demo/code-mode/yoko-mock --listen-addr :5028
```

Flags:

- `--listen-addr` defaults to `localhost:5028`.
- `--codex-bin` defaults to `codex` and is resolved through `PATH` unless an absolute path is supplied.
- `--codex-timeout` defaults to `60s`.

The service calls:

```sh
codex exec --full-auto --skip-git-repo-check -
```

with the generated prompt on stdin. The host must have a real `codex` CLI installed and authenticated.

## Behavior

- `POST /wundergraph.cosmo.code_mode.yoko.v1.YokoService/Index` stores the SDL in memory and returns `schema_id`, the first 16 hex characters of `sha256(schema_sdl)`.
- `POST /wundergraph.cosmo.code_mode.yoko.v1.YokoService/Search` looks up `schema_id`, invokes `codex`, parses its stdout as a JSON array, and returns the generated operations without local deduping or ranking.
- `/health` returns `200 OK`.

If `Search` receives an unknown `schema_id`, it returns Connect `NOT_FOUND`; the router client is expected to re-index and retry once. If `codex` returns invalid JSON, the service logs a warning, writes the raw stdout to `/tmp/yoko-mock-last-bad-output.log`, and returns Connect `INTERNAL`.

Expected codex stdout:

```json
[
  {
    "name": "getViewer",
    "body": "query getViewer { viewer { id } }",
    "kind": "query",
    "description": "Fetches the current viewer."
  }
]
```
