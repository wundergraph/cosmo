//go:build wasip1 || wasm

package sdk

import (
	"github.com/extism/go-pdk"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// The functions below are the Extism ABI entrypoints. Each dispatches to the
// registered module and writes its JSON output with pdk.OutputJSON. HTTP hooks
// take no (or a tiny) input: the module reaches the live request, response and
// context through the host functions in host_wasm.go. They are always compiled into the guest; the
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
	m, ok := registered.(EnginePreOriginHandler)
	if !ok {
		return output(wire.HTTPHookOutput{})
	}
	return output(wire.HTTPHookOutput{
		Response: m.OnOriginRequest(&Request{}, &RequestContext{}),
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
		return output(wire.HTTPHookOutput{})
	}
	var resp *Response
	if in.HasResponse {
		resp = &Response{}
	}
	return output(wire.HTTPHookOutput{
		Response: m.OnOriginResponse(resp, &RequestContext{}),
	})
}

//export router_on_request
//go:wasmexport router_on_request
func _routerOnRequest() int32 {
	m, ok := registered.(RouterOnRequestHandler)
	if !ok {
		return output(wire.HTTPHookOutput{})
	}
	return output(wire.HTTPHookOutput{
		Response: m.RouterOnRequest(&Request{}, &RequestContext{}),
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
	emit, err := m.SubscriptionOnStart(&RequestContext{}, in.EventConfig)
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
	cfg := in.EventConfig
	out := wire.SubscriptionOnCreateOutput{EventConfig: &cfg}
	if err := m.SubscriptionOnCreate(&RequestContext{}, &cfg); err != nil {
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
	events, err, implemented := call(registered, &RequestContext{}, in.EventConfig, in.Events)
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
