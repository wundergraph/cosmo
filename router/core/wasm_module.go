package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
	"github.com/wundergraph/cosmo/router/internal/wasm"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// wasmModule adapts a loaded WASM guest (wasm.Module) to the router module
// interfaces. One wasmModule exists per configured WASM module. It implements
// every v1 hook interface; each hook is capability-gated, so hooks the guest
// does not implement fall through to the router's default behavior without a
// WASM call.
//
// Guests do not receive copies of router objects: each hook passes a
// wasm.CallState pointing at the live request/response and RequestContext, and
// the guest reads and mutates them through host functions.
type wasmModule struct {
	id       ModuleID
	priority int
	module   *wasm.Module
	logger   *zap.Logger
}

func newWasmModule(id string, priority int, module *wasm.Module, logger *zap.Logger) *wasmModule {
	return &wasmModule{
		id:       ModuleID(id),
		priority: priority,
		module:   module,
		logger:   logger,
	}
}

func (m *wasmModule) Module() ModuleInfo {
	return ModuleInfo{
		ID:       m.id,
		Priority: m.priority,
		New: func() Module {
			// WASM modules are stateful (they own a compiled plugin and an
			// instance pool), so there is exactly one instance per module.
			return m
		},
	}
}

// Provision captures the per-module logger. Compilation, capability probing and
// guest provisioning already happened when the module was loaded, so a failure
// there aborts startup before this runs.
func (m *wasmModule) Provision(ctx *ModuleContext) error {
	if ctx != nil && ctx.Logger != nil {
		m.logger = ctx.Logger
	}
	return nil
}

// Cleanup closes the underlying WASM module (all pooled instances + the
// compiled plugin).
func (m *wasmModule) Cleanup() error {
	return m.module.Close(context.Background())
}

// --- EnginePreOriginHandler ---

func (m *wasmModule) OnOriginRequest(req *http.Request, ctx RequestContext) (*http.Request, *http.Response) {
	if !m.module.HasCapability(wire.HookOnOriginRequest) {
		return req, nil
	}

	out, ok := call[wire.HTTPHookOutput](m, req.Context(), wire.HookOnOriginRequest, nil, &wasm.CallState{
		Request:             req,
		RequestBodyReadable: true,
		Info: func() wire.ContextInfo {
			return requestContextInfo(ctx, true, ctx.ActiveSubgraph(req), ctx.Error())
		},
		Store: ctx,
	})
	if !ok {
		return req, nil
	}
	if out.Response != nil {
		return req, buildHTTPResponse(out.Response, req)
	}
	return req, nil
}

// --- EnginePostOriginHandler ---

func (m *wasmModule) OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response {
	if !m.module.HasCapability(wire.HookOnOriginResponse) {
		return nil
	}

	var originReq *http.Request
	var activeSubgraph *Subgraph
	if resp != nil && resp.Request != nil {
		originReq = resp.Request
		activeSubgraph = ctx.ActiveSubgraph(resp.Request)
	}

	// For a failed round trip, expose the send error as the context error.
	reqErr := ctx.Error()
	if mc, ok := ctx.(ModuleRequestContext); ok && mc.SendError() != nil {
		reqErr = mc.SendError()
	}

	out, ok := call[wire.HTTPHookOutput](m, ctx.Request().Context(), wire.HookOnOriginResponse, wire.OnOriginResponseInput{
		HasResponse: resp != nil,
	}, &wasm.CallState{
		Request:         originReq,
		RequestReadOnly: true,
		Response:        resp,
		Info: func() wire.ContextInfo {
			return requestContextInfo(ctx, true, activeSubgraph, reqErr)
		},
		Store: ctx,
	})
	if !ok {
		return nil
	}
	// In-place mutations were applied to resp during the call. Only return a
	// response when the guest replaced it: a non-nil return stops the
	// remaining post-origin handlers.
	if out.Response != nil {
		return buildHTTPResponse(out.Response, originReq)
	}
	return nil
}

// --- RouterOnRequestHandler ---

func (m *wasmModule) RouterOnRequest(ctx RequestContext, next http.Handler) {
	if !m.module.HasCapability(wire.HookRouterOnRequest) {
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	req := ctx.Request()
	out, ok := call[wire.HTTPHookOutput](m, req.Context(), wire.HookRouterOnRequest, nil, &wasm.CallState{
		Request: req,
		// The body is intentionally not readable here: consuming the incoming
		// client body would make it unavailable to the rest of the router.
		RequestBodyReadable: false,
		Info: func() wire.ContextInfo {
			// The GraphQL operation has not been parsed yet at this point.
			return requestContextInfo(ctx, false, nil, ctx.Error())
		},
		Store: ctx,
	})
	if ok && out.Response != nil {
		writeWasmResponse(ctx.ResponseWriter(), out.Response)
		return
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

// --- SubscriptionOnStartHandler ---

func (m *wasmModule) SubscriptionOnStart(ctx SubscriptionOnStartHandlerContext) error {
	if !m.module.HasCapability(wire.HookSubscriptionOnStart) {
		return nil
	}
	out, ok := call[wire.SubscriptionOnStartOutput](m, subscriptionCallContext(ctx.Request()), wire.HookSubscriptionOnStart, wire.SubscriptionOnStartInput{
		EventConfig: subscriptionEventConfig(ctx.SubscriptionEventConfiguration()),
	}, operationCallState(ctx.Operation()))
	if !ok {
		return nil
	}
	if out.Error != "" {
		return &StreamHandlerError{Message: out.Error}
	}
	for _, data := range out.EmitEvents {
		ctx.EmitEvent(ctx.NewEvent(data))
	}
	return nil
}

// --- StreamPublishEventHandler ---

func (m *wasmModule) OnPublishEvents(ctx StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	if !m.module.HasCapability(wire.HookOnPublishEvents) {
		return events, nil
	}
	out, ok := call[wire.OnEventsOutput](m, subscriptionCallContext(ctx.Request()), wire.HookOnPublishEvents, wire.OnEventsInput{
		EventConfig: publishEventConfig(ctx.PublishEventConfiguration()),
		Events:      eventPayloads(events),
	}, operationCallState(ctx.Operation()))
	if !ok {
		return events, nil
	}
	if out.Error != "" {
		return events, fmt.Errorf("wasm module %q: %s", m.id, out.Error)
	}
	return rebuildEvents(out.Events, events, ctx.NewEvent), nil
}

// --- StreamReceiveEventHandler ---

func (m *wasmModule) OnReceiveEvents(ctx StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	if !m.module.HasCapability(wire.HookOnReceiveEvents) {
		return events, nil
	}
	out, ok := call[wire.OnEventsOutput](m, ctx.Context(), wire.HookOnReceiveEvents, wire.OnEventsInput{
		EventConfig: subscriptionEventConfig(ctx.SubscriptionEventConfiguration()),
		Events:      eventPayloads(events),
	}, operationCallState(ctx.Operation()))
	if !ok {
		return events, nil
	}
	if out.Error != "" {
		return events, fmt.Errorf("wasm module %q: %s", m.id, out.Error)
	}
	return rebuildEvents(out.Events, events, ctx.NewEvent), nil
}

// --- SubscriptionOnCreateHandler ---

func (m *wasmModule) SubscriptionOnCreate(ctx SubscriptionOnCreateHandlerContext) error {
	if !m.module.HasCapability(wire.HookSubscriptionOnCreate) {
		return nil
	}
	cfg := ctx.SubscriptionEventConfiguration()
	ec := subscriptionEventConfig(cfg)
	if ec == nil {
		ec = &wire.EventConfig{}
	}
	out, ok := call[wire.SubscriptionOnCreateOutput](m, subscriptionCallContext(ctx.Request()), wire.HookSubscriptionOnCreate, wire.SubscriptionOnCreateInput{
		EventConfig: *ec,
	}, operationCallState(ctx.Operation()))
	if !ok {
		return nil
	}
	if out.Error != "" {
		return &StreamHandlerError{Message: out.Error}
	}
	// Apply a modified configuration back onto the concrete (pointer) config.
	if out.EventConfig != nil && len(out.EventConfig.Raw) > 0 && cfg != nil {
		if err := json.Unmarshal(out.EventConfig.Raw, cfg); err != nil {
			m.logger.Error("wasm: failed to apply modified subscription event configuration", zap.Error(err))
		}
	}
	return nil
}

// --- helpers ---

// call marshals input (nil sends no input), invokes the guest hook with the
// given call state and unmarshals the output into T. It centralizes the
// fail-open behavior: on any error it logs and returns ok=false so the caller
// applies the router's default behavior. Mutations the guest made to the live
// objects in state before failing are kept.
func call[T any](m *wasmModule, ctx context.Context, hook string, input any, state *wasm.CallState) (T, bool) {
	var out T
	var payload []byte
	if input != nil {
		var err error
		if payload, err = json.Marshal(input); err != nil {
			m.logger.Error("wasm: failed to encode hook input", zap.String("hook", hook), zap.Error(err))
			return out, false
		}
	}
	res, err := m.module.Call(ctx, hook, payload, state)
	if err != nil {
		m.logger.Error("wasm: hook call failed", zap.String("hook", hook), zap.Error(err))
		return out, false
	}
	if len(res) == 0 {
		return out, true
	}
	if err := json.Unmarshal(res, &out); err != nil {
		m.logger.Error("wasm: failed to decode hook output", zap.String("hook", hook), zap.Error(err))
		return out, false
	}
	return out, true
}

func subscriptionCallContext(req *http.Request) context.Context {
	if req != nil && req.Context() != nil {
		return req.Context()
	}
	return context.Background()
}

// requestContextInfo builds the read-only context view for a RequestContext
// hook. When includeOperation is false (router_on_request) the operation is
// omitted because it has not been parsed yet.
func requestContextInfo(ctx RequestContext, includeOperation bool, activeSubgraph *Subgraph, reqErr error) wire.ContextInfo {
	info := wire.ContextInfo{}
	if includeOperation {
		info.Operation, info.ClientInfo = safeOperationSnapshot(ctx.Operation())
	}
	if activeSubgraph != nil {
		info.ActiveSubgraph = &wire.Subgraph{
			ID:   activeSubgraph.Id,
			Name: activeSubgraph.Name,
			URL:  activeSubgraph.UrlString,
		}
	}
	if reqErr != nil {
		info.Error = reqErr.Error()
	}
	return info
}

// operationCallState builds the call state for subscription/stream hooks,
// which expose the operation but no HTTP message or context store.
func operationCallState(op OperationContext) *wasm.CallState {
	return &wasm.CallState{
		Info: func() wire.ContextInfo {
			info := wire.ContextInfo{}
			info.Operation, info.ClientInfo = safeOperationSnapshot(op)
			return info
		},
	}
}

// safeOperationSnapshot reads an OperationContext defensively. ctx.Operation()
// can return a typed-nil interface (e.g. before parsing), so method calls are
// guarded with recover to avoid a nil-pointer panic.
func safeOperationSnapshot(op OperationContext) (operation *wire.Operation, clientInfo *wire.ClientInfo) {
	defer func() {
		if r := recover(); r != nil {
			operation = nil
			clientInfo = nil
		}
	}()
	if op == nil {
		return nil, nil
	}
	operation = &wire.Operation{
		Name:       op.Name(),
		Type:       op.Type(),
		Hash:       strconv.FormatUint(op.Hash(), 10),
		Content:    op.Content(),
		Sha256Hash: op.Sha256Hash(),
	}
	ci := op.ClientInfo()
	clientInfo = &wire.ClientInfo{
		Name:           ci.Name,
		Version:        ci.Version,
		WGRequestToken: ci.WGRequestToken,
	}
	return operation, clientInfo
}

func buildHTTPResponse(resp *wire.HTTPResponse, req *http.Request) *http.Response {
	if resp == nil {
		return nil
	}
	header := canonicalHeader(resp.Header)
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	body := resp.Body
	return &http.Response{
		Status:        http.StatusText(status),
		StatusCode:    status,
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}
}

// canonicalHeader converts a guest-built header map into an http.Header with
// canonical keys, so e.g. "content-type" and "Content-Type" are not both sent.
func canonicalHeader(h wire.Header) http.Header {
	header := make(http.Header, len(h))
	for k, values := range h {
		for _, v := range values {
			header.Add(k, v)
		}
	}
	return header
}

func writeWasmResponse(w http.ResponseWriter, resp *wire.HTTPResponse) {
	header := w.Header()
	for k, values := range canonicalHeader(resp.Header) {
		header[k] = values
	}
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	if len(resp.Body) > 0 {
		_, _ = w.Write(resp.Body)
	}
}

func eventPayloads(events datasource.StreamEvents) [][]byte {
	if events.Len() == 0 {
		return nil
	}
	payloads := make([][]byte, 0, events.Len())
	for _, e := range events.All() {
		payloads = append(payloads, e.GetData())
	}
	return payloads
}

// rebuildEvents reconstructs the event batch from the payloads returned by the
// guest. The WASM ABI only carries each event's data payload, not
// provider-specific metadata (e.g. Kafka key/headers, NATS headers). To avoid
// silently dropping that metadata, the event at each index is cloned from the
// original batch and only its data is replaced, so an unchanged or in-place
// data edit preserves metadata. Extra events the guest appended (beyond the
// original count) are created data-only via newEvent.
func rebuildEvents(payloads [][]byte, original datasource.StreamEvents, newEvent func([]byte) datasource.MutableStreamEvent) datasource.StreamEvents {
	origin := original.Unsafe()
	events := make([]datasource.StreamEvent, 0, len(payloads))
	for i, data := range payloads {
		if i < len(origin) {
			ev := origin[i].Clone()
			ev.SetData(data)
			events = append(events, ev)
			continue
		}
		events = append(events, newEvent(data))
	}
	return datasource.NewStreamEvents(events)
}

func subscriptionEventConfig(cfg datasource.SubscriptionEventConfiguration) *wire.EventConfig {
	if cfg == nil {
		return nil
	}
	ec := &wire.EventConfig{
		ProviderID:    cfg.ProviderID(),
		ProviderType:  string(cfg.ProviderType()),
		RootFieldName: cfg.RootFieldName(),
	}
	if raw, err := json.Marshal(cfg); err == nil {
		ec.Raw = raw
	}
	return ec
}

func publishEventConfig(cfg datasource.PublishEventConfiguration) *wire.EventConfig {
	if cfg == nil {
		return nil
	}
	ec := &wire.EventConfig{
		ProviderID:    cfg.ProviderID(),
		ProviderType:  string(cfg.ProviderType()),
		RootFieldName: cfg.RootFieldName(),
	}
	if raw, err := json.Marshal(cfg); err == nil {
		ec.Raw = raw
	}
	return ec
}

// Interface guards.
var (
	_ Module                      = (*wasmModule)(nil)
	_ Provisioner                 = (*wasmModule)(nil)
	_ Cleaner                     = (*wasmModule)(nil)
	_ EnginePreOriginHandler      = (*wasmModule)(nil)
	_ EnginePostOriginHandler     = (*wasmModule)(nil)
	_ RouterOnRequestHandler      = (*wasmModule)(nil)
	_ SubscriptionOnStartHandler  = (*wasmModule)(nil)
	_ StreamPublishEventHandler   = (*wasmModule)(nil)
	_ StreamReceiveEventHandler   = (*wasmModule)(nil)
	_ SubscriptionOnCreateHandler = (*wasmModule)(nil)
)
