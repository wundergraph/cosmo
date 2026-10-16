package sdk

import (
	"encoding/json"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// Headers is a handle to the live header set of a request or response. Every
// method calls into the router; names are matched case-insensitively, like
// http.Header.
type Headers struct {
	kind int32
}

// Get returns the first value for name, or "".
func (h Headers) Get(name string) string {
	if v := h.Values(name); len(v) > 0 {
		return v[0]
	}
	return ""
}

// Values returns all values for name.
func (h Headers) Values(name string) []string {
	var values []string
	decodeHostJSON(host.headerValues(h.kind, name), &values)
	return values
}

// Names returns the canonical names of all headers that are set.
func (h Headers) Names() []string {
	var names []string
	decodeHostJSON(host.headerNames(h.kind), &names)
	return names
}

// Set replaces any existing values for name with value.
func (h Headers) Set(name, value string) {
	host.headerSet(h.kind, name, value)
}

// Add appends value to name.
func (h Headers) Add(name, value string) {
	host.headerAdd(h.kind, name, value)
}

// Del removes all values for name.
func (h Headers) Del(name string) {
	host.headerDel(h.kind, name)
}

// Request is a handle to the live request of the current hook: the outgoing
// subgraph request in OnOriginRequest/OnOriginResponse, or the incoming client
// request in RouterOnRequest.
type Request struct {
	info *wire.RequestInfo
}

func (r *Request) requestInfo() *wire.RequestInfo {
	if r.info == nil {
		r.info = &wire.RequestInfo{}
		decodeHostJSON(host.requestInfo(), r.info)
	}
	return r.info
}

// Method returns the HTTP method.
func (r *Request) Method() string { return r.requestInfo().Method }

// URL returns the request URL.
func (r *Request) URL() string { return r.requestInfo().URL }

// Host returns the request host.
func (r *Request) Host() string { return r.requestInfo().Host }

// Header returns the request headers.
func (r *Request) Header() Headers { return Headers{kind: wire.KindRequest} }

// Body returns the request body. The router buffers the body on first access
// and keeps it readable for the rest of the request. It is only available in
// OnOriginRequest; calling it in RouterOnRequest fails the hook.
func (r *Request) Body() []byte { return host.bodyRead(wire.KindRequest) }

// SetBody replaces the request body (and its Content-Length). Only available in
// OnOriginRequest.
func (r *Request) SetBody(body []byte) { host.bodyWrite(wire.KindRequest, body) }

// Response is a handle to the live origin response in OnOriginResponse.
type Response struct{}

// StatusCode returns the response status code.
func (r *Response) StatusCode() int { return int(host.statusGet()) }

// SetStatusCode changes the response status code.
func (r *Response) SetStatusCode(code int) { host.statusSet(int32(code)) }

// Header returns the response headers.
func (r *Response) Header() Headers { return Headers{kind: wire.KindResponse} }

// Body returns the response body. The router buffers it on first access and
// keeps it readable for the rest of the request.
func (r *Response) Body() []byte { return host.bodyRead(wire.KindResponse) }

// SetBody replaces the response body (and its Content-Length).
func (r *Response) SetBody(body []byte) { host.bodyWrite(wire.KindResponse, body) }

// RequestContext is a handle to the router RequestContext of the current hook.
// The read-only part (operation, client info, subgraph, error) is fetched once,
// on first use. The key/value store is read and written directly: values set
// here are visible immediately to later modules and the router.
type RequestContext struct {
	info *wire.ContextInfo
}

func (c *RequestContext) contextInfo() *wire.ContextInfo {
	if c.info == nil {
		c.info = &wire.ContextInfo{}
		decodeHostJSON(host.contextInfo(), c.info)
	}
	return c.info
}

// Operation returns the GraphQL operation. It is empty in RouterOnRequest
// (parsing has not happened yet).
func (c *RequestContext) Operation() wire.Operation {
	if op := c.contextInfo().Operation; op != nil {
		return *op
	}
	return wire.Operation{}
}

// ClientInfo returns the client information derived from request headers.
func (c *RequestContext) ClientInfo() wire.ClientInfo {
	if ci := c.contextInfo().ClientInfo; ci != nil {
		return *ci
	}
	return wire.ClientInfo{}
}

// ActiveSubgraph returns the subgraph the current origin request targets, or
// nil when not applicable (e.g. RouterOnRequest).
func (c *RequestContext) ActiveSubgraph() *wire.Subgraph {
	return c.contextInfo().ActiveSubgraph
}

// Error returns the request error, or in OnOriginResponse the error that made
// the origin round trip fail.
func (c *RequestContext) Error() string {
	return c.contextInfo().Error
}

// Get unmarshals the context value stored under key into out. It reports
// whether the key was present. Values that cannot be represented as JSON are
// reported as absent. The store is not available in subscription and stream
// hooks, where Get always reports false.
func (c *RequestContext) Get(key string, out any) (bool, error) {
	raw := host.contextGet(key)
	if raw == nil {
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

// Set stores value under key. The value is JSON-encoded, so in-process custom
// modules read numbers back as json.Number. Calling Set in subscription and
// stream hooks, which have no context store, fails the hook.
func (c *RequestContext) Set(key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	host.contextSet(key, raw)
	return nil
}

func decodeHostJSON(raw []byte, out any) {
	if len(raw) == 0 {
		return
	}
	if err := json.Unmarshal(raw, out); err != nil {
		panic("sdk: invalid host response: " + err.Error())
	}
}
