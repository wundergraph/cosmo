package wasm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	extism "github.com/extism/go-sdk"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// ContextStore is the router RequestContext key/value store a guest reads and
// writes through the context host functions. core.RequestContext satisfies it.
type ContextStore interface {
	Get(key string) (value any, exists bool)
	Set(key string, value any)
}

// CallState is the per-call state the host functions operate on. The guest
// never receives a copy of the HTTP messages; it reads and mutates the live
// Request/Response held here. A nil field makes the host functions that need
// it trap the guest.
type CallState struct {
	// Request is the request the hook runs for.
	Request *http.Request
	// RequestReadOnly rejects request mutations (e.g. on_origin_response, where
	// the request has already been sent).
	RequestReadOnly bool
	// RequestBodyReadable allows reading the request body. It is false for
	// router_on_request: consuming the client body there would make it
	// unavailable to the rest of the router.
	RequestBodyReadable bool
	// Response is the origin response (on_origin_response only).
	Response *http.Response
	// Info lazily builds the read-only request context view. It is only called
	// if the guest asks for it.
	Info func() wire.ContextInfo
	// Store is the request context key/value store, if one is available.
	Store ContextStore

	requestBody  []byte
	requestRead  bool
	responseBody []byte
	responseRead bool
}

type callStateKey struct{}

func withCallState(ctx context.Context, s *CallState) context.Context {
	if s == nil {
		return ctx
	}
	return context.WithValue(ctx, callStateKey{}, s)
}

// errNoCallState is raised when a host function is called outside a hook that
// carries HTTP/context state (e.g. from provision).
var errNoCallState = errors.New("host function is not available in this hook")

func callState(ctx context.Context) *CallState {
	s, _ := ctx.Value(callStateKey{}).(*CallState)
	if s == nil {
		panic(errNoCallState)
	}
	return s
}

func (s *CallState) request() *http.Request {
	if s.Request == nil {
		panic(errors.New("no request is available in this hook"))
	}
	return s.Request
}

func (s *CallState) mutableRequest() *http.Request {
	if s.RequestReadOnly {
		panic(errors.New("the request is read-only in this hook"))
	}
	return s.request()
}

func (s *CallState) response() *http.Response {
	if s.Response == nil {
		panic(errors.New("no response is available in this hook"))
	}
	return s.Response
}

func (s *CallState) header(kind int32, mutate bool) http.Header {
	switch kind {
	case wire.KindRequest:
		req := s.request()
		if mutate {
			req = s.mutableRequest()
		}
		if req.Header == nil {
			req.Header = http.Header{}
		}
		return req.Header
	case wire.KindResponse:
		resp := s.response()
		if resp.Header == nil {
			resp.Header = http.Header{}
		}
		return resp.Header
	default:
		panic(fmt.Errorf("invalid message kind %d", kind))
	}
}

// readBody reads a body once, restores it so the router can still consume it,
// and caches the bytes for subsequent reads in the same call.
func readBody(body *io.ReadCloser) ([]byte, error) {
	if *body == nil || *body == http.NoBody {
		return nil, nil
	}
	data, err := io.ReadAll(*body)
	_ = (*body).Close()
	*body = io.NopCloser(bytes.NewReader(data))
	return data, err
}

func (s *CallState) readBody(kind int32) []byte {
	switch kind {
	case wire.KindRequest:
		if !s.RequestBodyReadable {
			panic(errors.New("the request body is not available in this hook"))
		}
		req := s.request()
		if !s.requestRead {
			data, err := readBody(&req.Body)
			if err != nil {
				panic(fmt.Errorf("read request body: %w", err))
			}
			s.requestBody, s.requestRead = data, true
		}
		return s.requestBody
	case wire.KindResponse:
		resp := s.response()
		if !s.responseRead {
			data, err := readBody(&resp.Body)
			if err != nil {
				panic(fmt.Errorf("read response body: %w", err))
			}
			s.responseBody, s.responseRead = data, true
		}
		return s.responseBody
	default:
		panic(fmt.Errorf("invalid message kind %d", kind))
	}
}

func (s *CallState) writeBody(kind int32, body []byte) {
	switch kind {
	case wire.KindRequest:
		req := s.mutableRequest()
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(body)), nil
		}
		// The Content-Length header (if any) is now stale; the transport uses
		// req.ContentLength instead.
		req.Header.Del("Content-Length")
		s.requestBody, s.requestRead = body, true
	case wire.KindResponse:
		resp := s.response()
		resp.Body = io.NopCloser(bytes.NewReader(body))
		resp.ContentLength = int64(len(body))
		resp.Header.Del("Content-Length")
		s.responseBody, s.responseRead = body, true
	default:
		panic(fmt.Errorf("invalid message kind %d", kind))
	}
}

// EncodeContextValue JSON-encodes a context value for the guest. It reports
// false for values that cannot be represented as JSON.
func EncodeContextValue(v any) ([]byte, bool) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, false
	}
	return raw, true
}

// DecodeContextValue decodes a JSON value written by the guest. Numbers are
// decoded with UseNumber so large integers keep their precision (a plain
// any-decode would coerce every number to float64 and lose precision beyond
// 2^53). Values are therefore JSON-typed on the receiving side (json.Number/
// string/bool/map/slice); the router's typed getters handle json.Number.
// Invalid JSON is stored as the raw string.
func DecodeContextValue(raw []byte) any {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var val any
	if err := dec.Decode(&val); err != nil {
		return string(raw)
	}
	return val
}

// --- Extism host functions ---

var (
	i32 = extism.ValueTypeI32
	i64 = extism.ValueTypeI64
)

func mustRead(p *extism.CurrentPlugin, offset uint64) []byte {
	if offset == 0 {
		return nil
	}
	b, err := p.ReadBytes(offset)
	if err != nil {
		panic(fmt.Errorf("read guest memory: %w", err))
	}
	// ReadBytes returns a view of guest memory; copy it so it outlives the call.
	return bytes.Clone(b)
}

func mustReadString(p *extism.CurrentPlugin, offset uint64) string {
	return string(mustRead(p, offset))
}

// mustWrite copies b into guest memory and returns its offset (0 for empty).
func mustWrite(p *extism.CurrentPlugin, b []byte) uint64 {
	if len(b) == 0 {
		return 0
	}
	off, err := p.WriteBytes(b)
	if err != nil {
		panic(fmt.Errorf("write guest memory: %w", err))
	}
	return off
}

func mustWriteJSON(p *extism.CurrentPlugin, v any) uint64 {
	b, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Errorf("encode host function result: %w", err))
	}
	return mustWrite(p, b)
}

func hostFunction(name string, params, returns []extism.ValueType, fn extism.HostFunctionStackCallback) extism.HostFunction {
	f := extism.NewHostFunctionWithStack(name, fn, params, returns)
	f.SetNamespace(wire.HostNamespace)
	return f
}

// hostFunctions returns the router host functions exposed to every guest.
func hostFunctions() []extism.HostFunction {
	return []extism.HostFunction{
		hostFunction(wire.HostRequestInfo, nil, []extism.ValueType{i64},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				req := callState(ctx).request()
				info := wire.RequestInfo{Method: req.Method, Host: req.Host}
				if req.URL != nil {
					info.URL = req.URL.String()
				}
				stack[0] = mustWriteJSON(p, info)
			}),
		hostFunction(wire.HostHeaderNames, []extism.ValueType{i32}, []extism.ValueType{i64},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				h := callState(ctx).header(extism.DecodeI32(stack[0]), false)
				names := make([]string, 0, len(h))
				for name := range h {
					names = append(names, name)
				}
				stack[0] = mustWriteJSON(p, names)
			}),
		hostFunction(wire.HostHeaderValues, []extism.ValueType{i32, i64}, []extism.ValueType{i64},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				h := callState(ctx).header(extism.DecodeI32(stack[0]), false)
				values := h.Values(mustReadString(p, stack[1]))
				if len(values) == 0 {
					stack[0] = 0
					return
				}
				stack[0] = mustWriteJSON(p, values)
			}),
		hostFunction(wire.HostHeaderSet, []extism.ValueType{i32, i64, i64}, nil,
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				h := callState(ctx).header(extism.DecodeI32(stack[0]), true)
				h.Set(mustReadString(p, stack[1]), mustReadString(p, stack[2]))
			}),
		hostFunction(wire.HostHeaderAdd, []extism.ValueType{i32, i64, i64}, nil,
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				h := callState(ctx).header(extism.DecodeI32(stack[0]), true)
				h.Add(mustReadString(p, stack[1]), mustReadString(p, stack[2]))
			}),
		hostFunction(wire.HostHeaderDel, []extism.ValueType{i32, i64}, nil,
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				h := callState(ctx).header(extism.DecodeI32(stack[0]), true)
				h.Del(mustReadString(p, stack[1]))
			}),
		hostFunction(wire.HostBodyRead, []extism.ValueType{i32}, []extism.ValueType{i64},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				stack[0] = mustWrite(p, callState(ctx).readBody(extism.DecodeI32(stack[0])))
			}),
		hostFunction(wire.HostBodyWrite, []extism.ValueType{i32, i64}, nil,
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				body := mustRead(p, stack[1])
				if body == nil {
					body = []byte{}
				}
				callState(ctx).writeBody(extism.DecodeI32(stack[0]), body)
			}),
		hostFunction(wire.HostStatusGet, nil, []extism.ValueType{i32},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				stack[0] = extism.EncodeI32(int32(callState(ctx).response().StatusCode))
			}),
		hostFunction(wire.HostStatusSet, []extism.ValueType{i32}, nil,
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				status := int(extism.DecodeI32(stack[0]))
				if status < 100 || status > 999 {
					panic(fmt.Errorf("invalid status code %d", status))
				}
				resp := callState(ctx).response()
				resp.StatusCode = status
				resp.Status = fmt.Sprintf("%d %s", status, http.StatusText(status))
			}),
		hostFunction(wire.HostContextInfo, nil, []extism.ValueType{i64},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				var info wire.ContextInfo
				if s := callState(ctx); s.Info != nil {
					info = s.Info()
				}
				stack[0] = mustWriteJSON(p, info)
			}),
		hostFunction(wire.HostContextGet, []extism.ValueType{i64}, []extism.ValueType{i64},
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				s := callState(ctx)
				if s.Store == nil {
					stack[0] = 0
					return
				}
				v, ok := s.Store.Get(mustReadString(p, stack[0]))
				if !ok {
					stack[0] = 0
					return
				}
				raw, ok := EncodeContextValue(v)
				if !ok {
					// Values that cannot be represented as JSON are invisible to
					// the guest.
					stack[0] = 0
					return
				}
				stack[0] = mustWrite(p, raw)
			}),
		hostFunction(wire.HostContextSet, []extism.ValueType{i64, i64}, nil,
			func(ctx context.Context, p *extism.CurrentPlugin, stack []uint64) {
				s := callState(ctx)
				if s.Store == nil {
					panic(errors.New("the request context store is not available in this hook"))
				}
				s.Store.Set(mustReadString(p, stack[0]), DecodeContextValue(mustRead(p, stack[1])))
			}),
	}
}
