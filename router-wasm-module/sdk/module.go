// Package sdk is the guest-side SDK for writing Cosmo router WASM modules in
// Go. Its interfaces mirror the router's core.Module handler interfaces, so a
// WASM module reads almost identically to an in-process custom module.
//
// A module is a struct that implements one or more of the handler interfaces
// below and is registered with Register:
//
//	func init() { sdk.Register(&MyModule{}) }
//	func main() {}
//
// Build it for the router with the standard Go toolchain:
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm .
//
// or with TinyGo:
//
//	tinygo build -o module.wasm -target wasip1 -buildmode=c-shared .
//
// Hooks do not receive copies of the router's request, response or request
// context. Request, Response and RequestContext are thin handles: every method
// is a call into the router that reads or mutates the live object, so a module
// only pays for the data it touches, and mutations take effect immediately.
//
// This file contains only the parts that are safe to compile on any platform
// (interfaces, registration). The //go:wasmexport entrypoints and the host
// function imports live in exports_wasm.go and host_wasm.go and only build for
// the wasip1 target.
package sdk

import "github.com/wundergraph/cosmo/router-wasm-module/wire"

// Provisioner is called once per plugin instance before it serves traffic. Use
// it to validate configuration; returning an error aborts router startup. The
// config argument is the raw JSON of the `config:` block of the wasm_modules
// entry.
type Provisioner interface {
	Provision(config []byte) error
}

// EnginePreOriginHandler mirrors core.EnginePreOriginHandler. Mutate req
// (headers, body) to change the outgoing subgraph request. Return a non-nil
// response to short-circuit the request and skip the origin call.
type EnginePreOriginHandler interface {
	OnOriginRequest(req *Request, ctx *RequestContext) *wire.HTTPResponse
}

// EnginePostOriginHandler mirrors core.EnginePostOriginHandler. Mutate resp
// (status, headers, body) in place and return nil to keep it; later modules see
// the changes. Return a non-nil response to replace it, which also stops later
// post-origin handlers. resp is nil when the origin round trip failed (inspect
// ctx.Error()); the request is read-only in this hook.
type EnginePostOriginHandler interface {
	OnOriginResponse(resp *Response, ctx *RequestContext) *wire.HTTPResponse
}

// RouterOnRequestHandler mirrors core.RouterOnRequestHandler. It runs early on
// the incoming client request, before tracing/authentication and before the
// GraphQL operation is parsed (so ctx.Operation() is empty here). Mutate req
// headers to change the request; the client body is not readable here. Return
// a non-nil response to short-circuit and answer the client directly.
type RouterOnRequestHandler interface {
	RouterOnRequest(req *Request, ctx *RequestContext) *wire.HTTPResponse
}

// SubscriptionOnStartHandler mirrors core.SubscriptionOnStartHandler. Return
// JSON event payloads to emit into the client's stream, or an error to close
// the subscription.
type SubscriptionOnStartHandler interface {
	SubscriptionOnStart(ctx *RequestContext, cfg *wire.EventConfig) (emit [][]byte, err error)
}

// StreamPublishEventHandler mirrors core.StreamPublishEventHandler. It receives
// the batch of JSON event payloads about to be published and returns the
// (possibly rewritten or filtered) batch to send.
type StreamPublishEventHandler interface {
	OnPublishEvents(ctx *RequestContext, cfg *wire.EventConfig, events [][]byte) ([][]byte, error)
}

// StreamReceiveEventHandler mirrors core.StreamReceiveEventHandler. It receives
// the batch of JSON event payloads received from a provider and returns the
// (possibly rewritten or filtered) batch to deliver.
type StreamReceiveEventHandler interface {
	OnReceiveEvents(ctx *RequestContext, cfg *wire.EventConfig, events [][]byte) ([][]byte, error)
}

// SubscriptionOnCreateHandler mirrors core.SubscriptionOnCreateHandler
// (experimental). Mutate cfg (e.g. cfg.Raw) to change the concrete event
// configuration, or return an error to reject the subscription.
type SubscriptionOnCreateHandler interface {
	SubscriptionOnCreate(ctx *RequestContext, cfg *wire.EventConfig) error
}

// registered holds the module registered by Register. There is one module per
// WASM guest.
var registered any

// Register registers the module implementation for this guest. Call it from an
// init function so it runs during instance initialization, before the host
// invokes any hook.
func Register(m any) {
	registered = m
}

// capabilities returns the hook names implemented by the registered module. The
// host calls the exported capabilities function once at load to decide which
// handler interfaces the WASM module participates in.
func capabilities() []string {
	if registered == nil {
		return nil
	}
	var hooks []string
	if _, ok := registered.(Provisioner); ok {
		hooks = append(hooks, wire.HookProvision)
	}
	if _, ok := registered.(EnginePreOriginHandler); ok {
		hooks = append(hooks, wire.HookOnOriginRequest)
	}
	if _, ok := registered.(EnginePostOriginHandler); ok {
		hooks = append(hooks, wire.HookOnOriginResponse)
	}
	if _, ok := registered.(RouterOnRequestHandler); ok {
		hooks = append(hooks, wire.HookRouterOnRequest)
	}
	if _, ok := registered.(SubscriptionOnStartHandler); ok {
		hooks = append(hooks, wire.HookSubscriptionOnStart)
	}
	if _, ok := registered.(StreamPublishEventHandler); ok {
		hooks = append(hooks, wire.HookOnPublishEvents)
	}
	if _, ok := registered.(StreamReceiveEventHandler); ok {
		hooks = append(hooks, wire.HookOnReceiveEvents)
	}
	if _, ok := registered.(SubscriptionOnCreateHandler); ok {
		hooks = append(hooks, wire.HookSubscriptionOnCreate)
	}
	return hooks
}
