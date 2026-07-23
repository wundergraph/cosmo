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
// Because this type lives in the core package it can read the private
// requestContext key/value store to snapshot it for the guest (see
// snapshotContextValues).
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

	reqSnap, err := httpRequestSnapshot(req, true)
	if err != nil {
		m.logger.Error("wasm: failed to snapshot origin request", zap.Error(err))
		return req, nil
	}
	snap := m.contextSnapshot(ctx, true, ctx.ActiveSubgraph(req))

	out, ok := call[wire.OnOriginRequestOutput](m, req.Context(), wire.HookOnOriginRequest, wire.OnOriginRequestInput{
		Request: reqSnap,
		Context: snap,
	})
	if !ok {
		return req, nil
	}
	applyContextSets(ctx, out.ContextSets)
	if out.Response != nil {
		return req, buildHTTPResponse(out.Response, req)
	}
	applyRequestMutation(req, out.Request)
	return req, nil
}

// --- EnginePostOriginHandler ---

func (m *wasmModule) OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response {
	if !m.module.HasCapability(wire.HookOnOriginResponse) {
		return nil
	}

	respSnap, err := httpResponseSnapshot(resp)
	if err != nil {
		m.logger.Error("wasm: failed to snapshot origin response", zap.Error(err))
		return nil
	}

	var activeSubgraph *Subgraph
	var originReq *http.Request
	if resp != nil && resp.Request != nil {
		originReq = resp.Request
		activeSubgraph = ctx.ActiveSubgraph(resp.Request)
	}
	snap := m.contextSnapshot(ctx, true, activeSubgraph)

	sendError := ""
	if mc, ok := ctx.(ModuleRequestContext); ok {
		if e := mc.SendError(); e != nil {
			sendError = e.Error()
		}
	}

	out, ok := call[wire.OnOriginResponseOutput](m, ctx.Request().Context(), wire.HookOnOriginResponse, wire.OnOriginResponseInput{
		Response:  respSnap,
		SendError: sendError,
		Context:   snap,
	})
	if !ok {
		return nil
	}
	applyContextSets(ctx, out.ContextSets)
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
	// The body is intentionally not read here: consuming the incoming client
	// body would make it unavailable to the rest of the router.
	reqSnap, err := httpRequestSnapshot(req, false)
	if err != nil {
		m.logger.Error("wasm: failed to snapshot request", zap.Error(err))
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}
	// The GraphQL operation has not been parsed yet at this point, so it is not
	// included in the snapshot.
	snap := m.contextSnapshot(ctx, false, nil)

	out, ok := call[wire.RouterOnRequestOutput](m, req.Context(), wire.HookRouterOnRequest, wire.RouterOnRequestInput{
		Request: reqSnap,
		Context: snap,
	})
	if !ok {
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}
	applyContextSets(ctx, out.ContextSets)
	if out.Request != nil && out.Request.Header != nil {
		ctx.Request().Header = http.Header(out.Request.Header)
	}
	if out.Response != nil {
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
	snap := operationContextSnapshot(ctx.Operation())
	out, ok := call[wire.SubscriptionOnStartOutput](m, subscriptionCallContext(ctx.Request()), wire.HookSubscriptionOnStart, wire.SubscriptionOnStartInput{
		Context:     snap,
		EventConfig: subscriptionEventConfig(ctx.SubscriptionEventConfiguration()),
	})
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
		Context:     operationContextSnapshot(ctx.Operation()),
		EventConfig: publishEventConfig(ctx.PublishEventConfiguration()),
		Events:      eventPayloads(events),
	})
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
		Context:     operationContextSnapshot(ctx.Operation()),
		EventConfig: subscriptionEventConfig(ctx.SubscriptionEventConfiguration()),
		Events:      eventPayloads(events),
	})
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
		Context:     operationContextSnapshot(ctx.Operation()),
		EventConfig: *ec,
	})
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

// call marshals input, invokes the guest hook and unmarshals the output into T.
// It centralizes the fail-open behavior: on any error it logs and returns
// ok=false so the caller applies the router's default behavior.
func call[T any](m *wasmModule, ctx context.Context, hook string, input any) (T, bool) {
	var out T
	payload, err := json.Marshal(input)
	if err != nil {
		m.logger.Error("wasm: failed to encode hook input", zap.String("hook", hook), zap.Error(err))
		return out, false
	}
	res, err := m.module.Call(ctx, hook, payload)
	if err != nil {
		m.logger.Error("wasm: hook call failed", zap.String("hook", hook), zap.Error(err))
		return out, false
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

// contextSnapshot builds the ContextSnapshot for a RequestContext hook. When
// includeOperation is false (e.g. router_on_request) the operation is omitted
// because it has not been parsed yet.
func (m *wasmModule) contextSnapshot(ctx RequestContext, includeOperation bool, activeSubgraph *Subgraph) wire.ContextSnapshot {
	snap := wire.ContextSnapshot{}
	if includeOperation {
		if op, ci := safeOperationSnapshot(ctx.Operation()); op != nil {
			snap.Operation = op
			snap.ClientInfo = ci
		}
	}
	if activeSubgraph != nil {
		snap.ActiveSubgraph = &wire.Subgraph{
			ID:   activeSubgraph.Id,
			Name: activeSubgraph.Name,
			URL:  activeSubgraph.UrlString,
		}
	}
	if err := ctx.Error(); err != nil {
		snap.Error = err.Error()
	}
	snap.Values = m.snapshotContextValues(ctx)
	return snap
}

// operationContextSnapshot builds a snapshot from a bare OperationContext (used
// by subscription hooks, which do not expose the full RequestContext).
func operationContextSnapshot(op OperationContext) wire.ContextSnapshot {
	snap := wire.ContextSnapshot{}
	if o, ci := safeOperationSnapshot(op); o != nil {
		snap.Operation = o
		snap.ClientInfo = ci
	}
	return snap
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

// snapshotContextValues serializes the JSON-encodable subset of the request
// context key/value store. It reaches into the concrete requestContext because
// the RequestContext interface has no way to enumerate keys.
func (m *wasmModule) snapshotContextValues(ctx RequestContext) map[string]json.RawMessage {
	var rc *requestContext
	switch c := ctx.(type) {
	case *requestContext:
		rc = c
	case *moduleRequestContext:
		rc = c.requestContext
	}
	if rc == nil {
		return nil
	}

	rc.mu.RLock()
	defer rc.mu.RUnlock()
	if len(rc.keys) == 0 {
		return nil
	}
	values := make(map[string]json.RawMessage, len(rc.keys))
	for k, v := range rc.keys {
		raw, err := json.Marshal(v)
		if err != nil {
			// Skip values that cannot be represented as JSON.
			continue
		}
		values[k] = raw
	}
	return values
}

// applyContextSets writes values the guest produced back into the request
// context so later modules and the router can read them. Numbers are decoded
// with UseNumber so large integers keep their precision (a plain any-decode
// would coerce every number to float64 and lose precision beyond 2^53). Values
// are therefore JSON-typed on the receiving side (json.Number/string/bool/
// map/slice); the router's typed getters (GetInt, GetString, ...) handle
// json.Number.
func applyContextSets(ctx RequestContext, sets map[string]json.RawMessage) {
	for k, raw := range sets {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var val any
		if err := dec.Decode(&val); err != nil {
			ctx.Set(k, string(raw))
			continue
		}
		ctx.Set(k, val)
	}
}

func httpRequestSnapshot(req *http.Request, includeBody bool) (wire.HTTPRequest, error) {
	snap := wire.HTTPRequest{
		Method: req.Method,
		Host:   req.Host,
		Header: wire.Header(req.Header.Clone()),
	}
	if req.URL != nil {
		snap.URL = req.URL.String()
	}
	if includeBody && req.Body != nil {
		body, err := io.ReadAll(req.Body)
		_ = req.Body.Close()
		if err != nil {
			return snap, err
		}
		// Restore the body so downstream handlers can read it.
		req.Body = io.NopCloser(bytes.NewReader(body))
		snap.Body = body
	}
	return snap, nil
}

func applyRequestMutation(req *http.Request, mut *wire.RequestMutation) {
	if mut == nil {
		return
	}
	if mut.Header != nil {
		req.Header = http.Header(mut.Header)
	}
	if mut.Body != nil {
		body := *mut.Body
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(body)), nil
		}
		// The Content-Length header (if any) is now stale; rely on
		// req.ContentLength instead.
		req.Header.Del("Content-Length")
	}
}

func httpResponseSnapshot(resp *http.Response) (*wire.HTTPResponse, error) {
	if resp == nil {
		return nil, nil
	}
	snap := &wire.HTTPResponse{
		StatusCode: resp.StatusCode,
		Header:     wire.Header(resp.Header.Clone()),
	}
	if resp.Body != nil {
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return nil, err
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
		snap.Body = body
	}
	return snap, nil
}

func buildHTTPResponse(resp *wire.HTTPResponse, req *http.Request) *http.Response {
	if resp == nil {
		return nil
	}
	header := http.Header(resp.Header)
	if header == nil {
		header = http.Header{}
	}
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

func writeWasmResponse(w http.ResponseWriter, resp *wire.HTTPResponse) {
	header := w.Header()
	for k, values := range resp.Header {
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
