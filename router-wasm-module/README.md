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
| `wire`     | The JSON ABI shared by the router host and the guest. Single source of truth, no imports beyond `encoding/json`. |
| `sdk`      | The guest SDK. Interfaces mirroring the router's `core.Module` handlers plus the Extism entrypoints. |
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
func (m *MyModule) OnOriginRequest(req *wire.HTTPRequest, ctx *sdk.RequestContext) *wire.HTTPResponse {
	req.Header.Set("X-My-Header", "value")
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

Each hook receives a JSON snapshot of the request/response and the request
context, and returns the mutations to apply. The guest never holds a live
reference to router objects; it works on the snapshot and returns changes, which
keeps modules safe to run concurrently behind a pool of WASM instances.
