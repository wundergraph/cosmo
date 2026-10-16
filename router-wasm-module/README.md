# Cosmo Router WASM Modules

Write Cosmo router modules in Go, compile them to WebAssembly, and load them
into the router **purely from configuration** — no need to fork or recompile the
router binary.

WASM modules are the sandboxed, config-loadable counterpart to
[custom modules](https://cosmo-docs.wundergraph.com/router/custom-modules). They
implement the same handler interfaces and run through the same router module
lifecycle; the router loads them with [Extism](https://extism.org/) on top of
the [wazero](https://wazero.io/) runtime.

## Packages

| Package    | Purpose                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| `wire`     | The ABI shared by the router host and the guest: guest exports, host functions and JSON messages. Single source of truth, no imports beyond `encoding/json`. |
| `sdk`      | The guest SDK. Interfaces mirroring the router's `core.Module` handlers, handles to the live request/response/context, and the Extism entrypoints. |
| `example`  | A runnable example module.                                                                |

## Writing a module

```go
package main

import (
	"github.com/wundergraph/cosmo/router-wasm-module/sdk"
	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

type MyModule struct {
	value string
}

// Provision validates config and initializes the module (optional).
func (m *MyModule) Provision(config []byte) error {
	// config is the raw JSON of the `config:` block in wasm_modules.
	return nil
}

// OnOriginRequest mutates outgoing subgraph requests (optional).
func (m *MyModule) OnOriginRequest(req *sdk.Request, ctx *sdk.RequestContext) *wire.HTTPResponse {
	req.Header().Set("X-My-Header", ctx.Operation().Name)
	return nil // return a *wire.HTTPResponse to short-circuit the request
}

func init() { sdk.Register(&MyModule{}) }
func main() {}
```

Implement any subset of these SDK interfaces — the router only wires up the ones
your module implements:

| SDK interface                 | Router equivalent                | When it runs                                  |
| ----------------------------- | -------------------------------- | --------------------------------------------- |
| `Provisioner`                 | `core.Provisioner`               | Once per instance, at startup                 |
| `EnginePreOriginHandler`      | `core.EnginePreOriginHandler`    | Before each subgraph request                  |
| `EnginePostOriginHandler`     | `core.EnginePostOriginHandler`   | After each subgraph response                  |
| `RouterOnRequestHandler`      | `core.RouterOnRequestHandler`    | Early on the client request (no operation yet)|
| `SubscriptionOnStartHandler`  | `core.SubscriptionOnStartHandler`| At subscription start                         |
| `StreamPublishEventHandler`   | `core.StreamPublishEventHandler` | Before publishing stream events               |
| `StreamReceiveEventHandler`   | `core.StreamReceiveEventHandler` | After receiving stream events                 |
| `SubscriptionOnCreateHandler` | `core.SubscriptionOnCreateHandler` (experimental) | At subscription creation      |

The `Middleware` (router-level) hook is intentionally not supported for WASM
modules.

## Building

With the standard Go toolchain (Go 1.24+):

```bash
GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm .
```

or with [TinyGo](https://tinygo.org/) (smaller output):

```bash
tinygo build -o module.wasm -target wasip1 -buildmode=c-shared .
```

## Loading in the router

```yaml
# config.yaml
wasm_modules:
  - id: my_module
    path: ./modules/module.wasm
    priority: 5
    config:
      value: hello
```

See the router documentation for the full set of `wasm_modules` options.

## How it works

Hooks do not receive copies of router objects. `sdk.Request`, `sdk.Response`
and `sdk.RequestContext` are handles: each method is a host function call that
reads or mutates the live `*http.Request`, `*http.Response` or router
`RequestContext`. A module only pays for the data it touches (a module that
sets one header never serializes the body), and mutations take effect
immediately, so later modules and the router see them.

JSON only crosses the boundary for configuration, stream event batches and
guest-built short-circuit responses (`*wire.HTTPResponse`).

Some operations are only valid in certain hooks. Calling one elsewhere fails
the hook call, which the router logs before falling back to its default
behavior:

| Operation                    | Available in                              |
| ---------------------------- | ----------------------------------------- |
| `Request.Body` / `SetBody`   | `OnOriginRequest`                         |
| Request header mutation      | `OnOriginRequest`, `RouterOnRequest`      |
| `Response` (status/headers/body) | `OnOriginResponse`                    |
| `RequestContext.Set`         | HTTP hooks (not subscription/stream hooks) |

`OnOriginResponse` should mutate the response in place and return `nil`.
Returning a response replaces it and stops the remaining post-origin handlers.
