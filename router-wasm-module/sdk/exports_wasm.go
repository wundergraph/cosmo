//go:build wasip1 || wasm

package sdk

import (
	"bytes"

	"github.com/extism/go-pdk"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// The functions below are the Extism ABI entrypoints. Each reads its JSON
// input with pdk.InputJSON, dispatches to the registered module, and writes its
// JSON output with pdk.OutputJSON. They are always compiled into the guest; the
// host uses the capabilities export to learn which handlers are actually
// implemented, so unimplemented hooks simply return an empty result.

//export capabilities
//go:wasmexport capabilities
func _capabilities() int32 {
	return output(wire.CapabilitiesOutput{Hooks: capabilities()})
}

//export provision
//go:wasmexport provision
func _provision() int32 {
	var in wire.ProvisionInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	m, ok := registered.(Provisioner)
	if !ok {
		return output(wire.ProvisionOutput{})
	}
	var out wire.ProvisionOutput
	if err := m.Provision(in.Config); err != nil {
		out.Error = err.Error()
	}
	return output(out)
}

//export on_origin_request
//go:wasmexport on_origin_request
func _onOriginRequest() int32 {
	var in wire.OnOriginRequestInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	m, ok := registered.(EnginePreOriginHandler)
	if !ok {
		return output(wire.OnOriginRequestOutput{})
	}
	ctx := newRequestContext(in.Context)
	// Copy the original body up front so an in-place mutation by the guest
	// (which shares the backing array with req.Body) is still detected.
	originalBody := append([]byte(nil), in.Request.Body...)
	req := in.Request
	resp := m.OnOriginRequest(&req, ctx)
	return output(wire.OnOriginRequestOutput{
		Request:     requestMutation(&req, originalBody),
		Response:    resp,
		ContextSets: ctx.contextSets(),
	})
}

//export on_origin_response
//go:wasmexport on_origin_response
func _onOriginResponse() int32 {
	var in wire.OnOriginResponseInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	m, ok := registered.(EnginePostOriginHandler)
	if !ok {
		return output(wire.OnOriginResponseOutput{})
	}
	ctx := newRequestContext(in.Context)
	resp := m.OnOriginResponse(in.Response, ctx)
	return output(wire.OnOriginResponseOutput{
		Response:    resp,
		ContextSets: ctx.contextSets(),
	})
}

//export router_on_request
//go:wasmexport router_on_request
func _routerOnRequest() int32 {
	var in wire.RouterOnRequestInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	m, ok := registered.(RouterOnRequestHandler)
	if !ok {
		return output(wire.RouterOnRequestOutput{})
	}
	ctx := newRequestContext(in.Context)
	// Copy the original body up front so an in-place mutation by the guest
	// (which shares the backing array with req.Body) is still detected.
	originalBody := append([]byte(nil), in.Request.Body...)
	req := in.Request
	resp := m.RouterOnRequest(&req, ctx)
	return output(wire.RouterOnRequestOutput{
		Request:     requestMutation(&req, originalBody),
		Response:    resp,
		ContextSets: ctx.contextSets(),
	})
}

//export subscription_on_start
//go:wasmexport subscription_on_start
func _subscriptionOnStart() int32 {
	var in wire.SubscriptionOnStartInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	m, ok := registered.(SubscriptionOnStartHandler)
	if !ok {
		return output(wire.SubscriptionOnStartOutput{})
	}
	ctx := newRequestContext(in.Context)
	emit, err := m.SubscriptionOnStart(ctx, in.EventConfig)
	out := wire.SubscriptionOnStartOutput{EmitEvents: emit}
	if err != nil {
		out.Error = err.Error()
	}
	return output(out)
}

//export on_publish_events
//go:wasmexport on_publish_events
func _onPublishEvents() int32 {
	return onEvents(func(m any, ctx *RequestContext, cfg *wire.EventConfig, events [][]byte) ([][]byte, error, bool) {
		h, ok := m.(StreamPublishEventHandler)
		if !ok {
			return nil, nil, false
		}
		out, err := h.OnPublishEvents(ctx, cfg, events)
		return out, err, true
	})
}

//export on_receive_events
//go:wasmexport on_receive_events
func _onReceiveEvents() int32 {
	return onEvents(func(m any, ctx *RequestContext, cfg *wire.EventConfig, events [][]byte) ([][]byte, error, bool) {
		h, ok := m.(StreamReceiveEventHandler)
		if !ok {
			return nil, nil, false
		}
		out, err := h.OnReceiveEvents(ctx, cfg, events)
		return out, err, true
	})
}

//export subscription_on_create
//go:wasmexport subscription_on_create
func _subscriptionOnCreate() int32 {
	var in wire.SubscriptionOnCreateInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	m, ok := registered.(SubscriptionOnCreateHandler)
	if !ok {
		return output(wire.SubscriptionOnCreateOutput{})
	}
	ctx := newRequestContext(in.Context)
	cfg := in.EventConfig
	out := wire.SubscriptionOnCreateOutput{EventConfig: &cfg}
	if err := m.SubscriptionOnCreate(ctx, &cfg); err != nil {
		out.Error = err.Error()
	}
	return output(out)
}

// onEvents is the shared body for on_publish_events / on_receive_events.
func onEvents(call func(m any, ctx *RequestContext, cfg *wire.EventConfig, events [][]byte) ([][]byte, error, bool)) int32 {
	var in wire.OnEventsInput
	if err := pdk.InputJSON(&in); err != nil {
		return fail(err)
	}
	ctx := newRequestContext(in.Context)
	events, err, implemented := call(registered, ctx, in.EventConfig, in.Events)
	if !implemented {
		// Pass the batch through unchanged.
		return output(wire.OnEventsOutput{Events: in.Events})
	}
	out := wire.OnEventsOutput{Events: events}
	if err != nil {
		out.Error = err.Error()
	}
	return output(out)
}

// requestMutation builds a RequestMutation from a (possibly) mutated request.
// The header is always sent back (it is cheap and the guest received the full
// set); the body is only sent when it actually changed, so we avoid needlessly
// rewriting the request body.
func requestMutation(req *wire.HTTPRequest, originalBody []byte) *wire.RequestMutation {
	mut := &wire.RequestMutation{Header: req.Header}
	if !bytes.Equal(originalBody, req.Body) {
		body := req.Body
		if body == nil {
			// A non-nil empty slice signals "clear the body"; a nil pointer
			// (omitempty) would instead mean "no change".
			body = []byte{}
		}
		mut.Body = &body
	}
	return mut
}

func output(v any) int32 {
	if err := pdk.OutputJSON(v); err != nil {
		return fail(err)
	}
	return 0
}

func fail(err error) int32 {
	pdk.SetError(err)
	return 1
}
