# @wundergraph/wgc-plugin-forge

`wgc forge` builds a Cosmo Router with your own Go modules compiled in, and tests a new router release against those modules before you adopt it. It is the wgc entry point to Forge, WunderGraph's CLI for custom router workspaces.

```sh
wgc plugins install forge
wgc forge --help
```

## Which Forge runs

`wgc forge` is a thin layer. When the Forge CLI is installed, wgc hands every `wgc forge …` invocation to it unchanged: the arguments (including `--json`), stdin, stdout, stderr and the exit code.

1. `WGC_FORGE_BINARY=/path/to/forge` runs that binary.
2. Otherwise the first executable `forge` on `PATH` runs.
3. Otherwise wgc runs its builtin implementation of the Forge commands.

Set `WGC_FORGE_BINARY=builtin` to use the builtin commands even when another `forge` is on `PATH`, such as Foundry's.

## The builtin implementation is temporary

The Forge CLI has no release yet. Until it does, `src/builtin/` implements the Forge v0.1 specification: the eight commands, the `forge.yaml` and `forge.lock` formats, and output that adapts to the caller (readable text for a person at a terminal, JSON for agents, CI and `--json`). It also implements two commands from the v0.2 draft, `forge check` and `forge source add`.

Both implementations sit behind the `ForgeEngine` interface in `src/engine.ts`. When Forge ships, delete `src/builtin/`, `test/builtin/` and `gomodules/`, and drop the builtin branch in `src/index.ts`. `wgc forge` then always runs the Forge binary.

## Router upgrades run every module's behaviour tests

`wgc forge router upgrade --check --config router.yaml <candidate>` builds the candidate in `.forge/candidate` and runs the Go tests of every registered module against it. The tests that ship with a module run from the candidate build, so they compile against the candidate router. That covers remote modules too. Tests the workspace keeps for a module in `tests/<Go package path>` run from that directory. Every test run receives `FORGE_ROUTER_BINARY` (the candidate binary) and `FORGE_ROUTER_CONFIG` (the `--config` file).

The result lists each module as `passed`, `failed` or `untested`. A module with no Go test is `untested` and blocks adoption like a failed one. A `test:` command in `forge.yaml`, or `--test <command>`, runs in addition. Nothing in `forge.yaml`, `forge.lock` or the working binary changes unless every check passes and the change is accepted.

Forge cannot tell a thorough test from a shallow one. A module counts as tested when it has at least one Go test.

## `wgc forge check`

`wgc forge check` reads the subgraphs from `graph.yaml` (the input file of `wgc router compose`, or `check.graph` in `forge.yaml`, or `--graph`), composes them and evaluates the rules. It exits non-zero on a finding of an `error` rule and when the check is incomplete because a schema is missing or the graph does not compose. Text and `--json` report the same findings.

The rules are Cosmo's schema lint rules under their Cosmo IDs, reimplemented on the GraphQL AST so each finding carries a schema coordinate, plus `pagination.forward-connection`. The lint rules run on each subgraph schema. The pagination rule runs on the composed client schema and covers the fields of `Query` that return a list of objects or a `…Connection` type. Its findings carry the found and expected signature and a conforming field elsewhere in the graph.

```yaml
# forge.yaml
check:
  graph: graph.yaml
  rules:
    pagination.forward-connection: error
    FIELD_NAMES_SHOULD_BE_CAMEL_CASE: error
    ORDER_FIELDS: off
  exceptions:
    - rule: pagination.forward-connection
      coordinate: Query.auditEvents
      reason: Predates the convention.
```

Without configuration the naming, enum, typename-prefix and deprecation rules warn, and the ordering, description and pagination rules are off. The policy lives in `forge.yaml` because the v0.2 draft leaves the `FORGE.md` rule syntax open.

## `wgc forge source add`

`wgc forge source add <openapi-url-or-file>` turns an OpenAPI 3 description into a Cosmo Connect subgraph. Every GET operation with an `application/json` response for status 200 becomes a field on `Query`. `@wundergraph/protographic` compiles the schema to `service.proto` and `mapping.json`, the same contract `wgc grpc-service generate` writes. The command creates `modules/<name>`, registers it in `forge.yaml` and adds the subgraph to `graph.yaml`. Its result has the subgraph SDL, the module path and a `skipped` list of every operation, parameter and property it left out.

### What runs in the router process

The router has no way for a compiled module to hand it a gRPC client for a subgraph. `setupConnector` in `router/core/graph_server.go` registers a remote gRPC provider or a plugin provider that starts an executable, and the connector is private to the graph server. The generated module therefore uses the path that exists today:

- The module is compiled into the router binary by `wgc forge build`, like any other module.
- When the router provisions it, it starts a gRPC server inside the router process on a loopback address (`127.0.0.1:4011` by default) and serves the generated service from the embedded `service.proto` with dynamic messages.
- `graph.yaml` declares the subgraph as a standalone gRPC subgraph with that address as its routing URL, so the router's existing remote provider dials its own process.
- Each RPC makes one HTTP call to the REST API with a client the module owns.

One binary and one process serve the graph field and call the REST API. No plugin executable is started and no bridge service is deployed. It is not an in-memory connection. Each call crosses a loopback TCP socket and is encoded as gRPC, and the listen address is configured in two places, the graph file and `modules.<name>.listen_addr`. Removing that hop needs a router change that lets a module register a `grpcconnector.ClientProvider` for a named subgraph.

```yaml
# router.yaml
modules:
  catalog:
    base_url: https://catalog.example.com
    listen_addr: 127.0.0.1:4011
    timeout: 5s
    headers:
      Authorization: Bearer ${CATALOG_TOKEN}
```

### Limits

- Only OpenAPI 3.0 and 3.1 documents are read. A proto file and a Postgres URL are rejected with what is missing: Cosmo has no tool that derives a graph schema from a proto service, and Forge neither introspects a database nor generates SQL.
- Only GET operations are generated. Path and query parameters must be plain strings, numbers or booleans.
- Response objects, arrays, `$ref` and `allOf` are translated. `oneOf`, `anyOf`, maps, enums as enums and lists of lists are skipped and listed.
- A 404 from the REST API is a null field. Other failures are gRPC errors. The caller's identity is not forwarded. Only the configured static headers are sent.
- The listener is bound once per process. A config reload updates the REST settings, and a new listen address needs a restart.
