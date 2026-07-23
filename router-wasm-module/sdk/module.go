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
// This file contains only the parts that are safe to compile on any platform
// (interfaces, the request context helper, registration). The //go:wasmexport
// entrypoints that talk to the Extism host live in exports_wasm.go and only
// build for the wasip1 target.
package sdk

import (
	"encoding/json"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// Provisioner is called once per plugin instance before it serves traffic. Use
// it to validate configuration; returning an error aborts router startup. The
// config argument is the raw JSON of the `config:` block of the wasm_modules
// entry.
type Provisioner interface {
	Provision(config []byte) error
}

// EnginePreOriginHandler mirrors core.EnginePreOriginHandler. Mutate req in
// place (headers/body) to change the outgoing subgraph request. Return a
// non-nil response to short-circuit the request and skip the origin call.
type EnginePreOriginHandler interface {
	OnOriginRequest(req *wire.HTTPRequest, ctx *RequestContext) *wire.HTTPResponse
}

// EnginePostOriginHandler mirrors core.EnginePostOriginHandler. resp is nil
// when the origin round trip failed (inspect ctx.Error()). Return a non-nil
// response to replace it, or nil to keep the current response.
type EnginePostOriginHandler interface {
	OnOriginResponse(resp *wire.HTTPResponse, ctx *RequestContext) *wire.HTTPResponse
}

// RouterOnRequestHandler mirrors core.RouterOnRequestHandler. It runs early on
// the incoming client request, before tracing/authentication and before the
// GraphQL operation is parsed (so ctx.Operation() is empty here). Mutate req
// headers in place to change the request; return a non-nil response to
// short-circuit and answer the client directly.
type RouterOnRequestHandler interface {
	RouterOnRequest(req *wire.HTTPRequest, ctx *RequestContext) *wire.HTTPResponse
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

// RequestContext is the guest-side view of the router RequestContext for a
// single hook invocation. It exposes the immutable snapshot fields and a
// key/value store whose writes are propagated back to the router.
type RequestContext struct {
	snapshot wire.ContextSnapshot
	sets     map[string]json.RawMessage
}

func newRequestContext(s wire.ContextSnapshot) *RequestContext {
	return &RequestContext{snapshot: s}
}

// Operation returns the GraphQL operation snapshot. It is empty for
// RouterOnRequest (parsing has not happened yet).
func (c *RequestContext) Operation() wire.Operation {
	if c.snapshot.Operation == nil {
		return wire.Operation{}
	}
	return *c.snapshot.Operation
}

// ClientInfo returns the client information derived from request headers.
func (c *RequestContext) ClientInfo() wire.ClientInfo {
	if c.snapshot.ClientInfo == nil {
		return wire.ClientInfo{}
	}
	return *c.snapshot.ClientInfo
}

// ActiveSubgraph returns the subgraph the current origin request targets, or
// nil when not applicable (e.g. router_on_request).
func (c *RequestContext) ActiveSubgraph() *wire.Subgraph {
	return c.snapshot.ActiveSubgraph
}

// Error returns the request error (or the origin send error for
// OnOriginResponse), if any.
func (c *RequestContext) Error() string {
	return c.snapshot.Error
}

// Get unmarshals the context value stored under key into out. It reports
// whether the key was present.
func (c *RequestContext) Get(key string, out any) (bool, error) {
	raw, ok := c.snapshot.Values[key]
	if !ok {
		return false, nil
	}
	return true, json.Unmarshal(raw, out)
}

// GetString returns the context value stored under key as a string, or "".
func (c *RequestContext) GetString(key string) string {
	var s string
	_, _ = c.Get(key, &s)
	return s
}

// Set stores value under key. The value is JSON-encoded and written back into
// the router RequestContext store after the hook returns, so later modules and
// the router can read it.
func (c *RequestContext) Set(key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if c.sets == nil {
		c.sets = make(map[string]json.RawMessage)
	}
	c.sets[key] = raw
	return nil
}

func (c *RequestContext) contextSets() map[string]json.RawMessage {
	return c.sets
}
