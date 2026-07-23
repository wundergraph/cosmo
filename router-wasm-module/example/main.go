// Command example is a runnable Cosmo router WASM module built with the guest
// SDK. It demonstrates provisioning, mutating origin requests/responses, an
// early router-on-request hook, and a stream event hook.
//
// Build it with the standard Go toolchain:
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm .
//
// or with TinyGo:
//
//	tinygo build -o module.wasm -target wasip1 -buildmode=c-shared .
package main

import (
	"encoding/json"
	"fmt"

	"github.com/wundergraph/cosmo/router-wasm-module/sdk"
	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// ExampleModule mirrors how an in-process custom module looks. It implements a
// handful of the SDK handler interfaces; the router only wires up the ones it
// implements (discovered via the capabilities export).
type ExampleModule struct {
	// Value is populated from the module `config:` block at provision time.
	Value string `json:"value"`
}

// config is the shape of the `config:` block for this module.
type config struct {
	Value string `json:"value"`
}

func (m *ExampleModule) Provision(raw []byte) error {
	var c config
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &c); err != nil {
			return fmt.Errorf("invalid config: %w", err)
		}
	}
	if c.Value == "" {
		return fmt.Errorf("value must be set")
	}
	m.Value = c.Value
	sdk.Log(sdk.LogInfo, "example module provisioned with value="+m.Value)
	return nil
}

// OnOriginRequest adds a header to every subgraph request and stores a value on
// the request context for OnOriginResponse to read.
func (m *ExampleModule) OnOriginRequest(req *wire.HTTPRequest, ctx *sdk.RequestContext) *wire.HTTPResponse {
	if req.Header == nil {
		req.Header = wire.Header{}
	}
	req.Header.Set("X-Wasm-Module", m.Value)
	_ = ctx.Set("wasmValue", m.Value)
	return nil
}

// OnOriginResponse reads the value stored in OnOriginRequest and adds a
// response header with it.
func (m *ExampleModule) OnOriginResponse(resp *wire.HTTPResponse, ctx *sdk.RequestContext) *wire.HTTPResponse {
	if resp == nil {
		return nil
	}
	if resp.Header == nil {
		resp.Header = wire.Header{}
	}
	resp.Header.Set("X-Wasm-Origin-Value", ctx.GetString("wasmValue"))
	return resp
}

// RouterOnRequest short-circuits requests carrying the X-Wasm-Ping header with
// a canned response, otherwise tags the request with a header.
func (m *ExampleModule) RouterOnRequest(req *wire.HTTPRequest, ctx *sdk.RequestContext) *wire.HTTPResponse {
	if req.Header.Get("X-Wasm-Ping") != "" {
		return &wire.HTTPResponse{
			StatusCode: 418,
			Header:     wire.Header{"Content-Type": {"application/json"}},
			Body:       []byte(`{"pong":"` + m.Value + `"}`),
		}
	}
	if req.Header == nil {
		req.Header = wire.Header{}
	}
	req.Header.Set("X-Wasm-Router", m.Value)
	return nil
}

// OnPublishEvents passes events through unchanged (demonstration hook).
func (m *ExampleModule) OnPublishEvents(ctx *sdk.RequestContext, cfg *wire.EventConfig, events [][]byte) ([][]byte, error) {
	return events, nil
}

func init() {
	sdk.Register(&ExampleModule{})
}

func main() {}
