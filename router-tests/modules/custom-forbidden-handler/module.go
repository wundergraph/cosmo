// Package custom_forbidden_handler standardizes 403 auth failure responses from subgraphs.
//
// When a subgraph returns a 403 (either via HTTP status code or a GraphQL error with
// a forbidden indicator in extensions), the module:
//  1. Rewrites the subgraph response body to a uniform error format so the router's
//     error pipeline (ALLOWED_EXTENSION_FIELDS, etc.) processes a clean input.
//  2. Short-circuits subsequent subgraph calls via OnOriginRequest once a 403 is detected.
//  3. Replaces the entire router response (via middleware) with a standardized error
//     and data:null — no partial data is returned.
//
// # Acceptance Criteria
//
//   - Subgraph returns HTTP 403 → single standardized forbidden error.
//   - Subgraph returns 200 with GraphQL error code 403 → detected as forbidden.
//   - Subgraph returns 200 with GraphQL errorCode "FORBIDDEN" → detected as forbidden.
//   - One subgraph forbidden, others succeed → no partial data, single error.
//   - All subgraphs forbidden → single error, not one per subgraph.
//   - Sequential subgraph fetches after a 403 → subsequent calls are skipped.
//   - Parallel subgraph fetches both forbidden → single error, no duplicates.
//   - Non-403 errors → pass through normally, not intercepted.
//   - Non-forbidden extension field filtering → unaffected by the module.
//   - Streaming requests → not affected by the module.
package custom_forbidden_handler

import (
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const myModuleID = "forbiddenHandlerModule"

// forbiddenErrorBody is the standardised GraphQL error body written by the module
// when any subgraph returns a 403.
var forbiddenErrorBody = []byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"errorCode":"FORBIDDEN"}}],"data":null}`)

type ForbiddenHandlerModule struct {
	Logger *zap.Logger
}

func (m *ForbiddenHandlerModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *ForbiddenHandlerModule) Cleanup() error {
	return nil
}

// OnOriginRequest short-circuits subgraph calls when a 403 has already been
// detected from a previous subgraph. This avoids unnecessary network round-trips.
func (m *ForbiddenHandlerModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	if ctx.GetBool("streaming_request") {
		return req, nil
	}
	if ctx.GetBool("forbidden_encountered") {
		// Return an empty data response. The middleware will replace the entire
		// response anyway, so the body content here does not matter much — it
		// just needs to be valid JSON so the resolver does not panic.
		return req, &http.Response{
			StatusCode:    http.StatusOK,
			Header:        http.Header{"Content-Type": []string{"application/json"}},
			Body:          io.NopCloser(strings.NewReader(`{"data":null}`)),
			ContentLength: 13,
		}
	}
	return req, nil
}

// OnOriginResponse detects 403 from any subgraph and rewrites the response body
// to a standardised GraphQL error so the router's error pipeline processes clean
// input. It also flags the request context so the middleware and OnOriginRequest
// can act on it.
func (m *ForbiddenHandlerModule) OnOriginResponse(resp *http.Response, ctx core.RequestContext) *http.Response {
	if resp == nil || ctx.GetBool("streaming_request") {
		return nil
	}

	// If already flagged, still rewrite the body so the resolver does not
	// process stale subgraph errors.
	if ctx.GetBool("forbidden_encountered") {
		resp.Body = io.NopCloser(bytes.NewReader(forbiddenErrorBody))
		resp.ContentLength = int64(len(forbiddenErrorBody))
		resp.StatusCode = http.StatusOK
		return nil
	}

	isForbidden := resp.StatusCode == http.StatusForbidden

	if !isForbidden && resp.Body != nil {
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(body))
		if err == nil && hasForbiddenGraphQLError(body) {
			isForbidden = true
		}
	}

	if isForbidden {
		ctx.Set("forbidden_encountered", true)
		resp.Body = io.NopCloser(bytes.NewReader(forbiddenErrorBody))
		resp.ContentLength = int64(len(forbiddenErrorBody))
		// Normalise to 200 so the resolver reads the body as a regular GraphQL
		// response and processes the error through its pipeline.
		resp.StatusCode = http.StatusOK
	}

	return nil
}

// hasForbiddenGraphQLError checks if a GraphQL response body contains an error
// whose extensions indicate a 403/FORBIDDEN status. It inspects both "code" and
// "errorCode" extension fields and accepts the numeric value 403 as well as the
// strings "403" and "FORBIDDEN" (case-insensitive).
func hasForbiddenGraphQLError(body []byte) bool {
	var result struct {
		Errors []struct {
			Extensions map[string]json.RawMessage `json:"extensions"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false
	}
	for _, e := range result.Errors {
		if isForbiddenCode(e.Extensions["code"]) || isForbiddenCode(e.Extensions["errorCode"]) {
			return true
		}
	}
	return false
}

// isForbiddenCode returns true when raw represents the numeric value 403 or the
// strings "403" / "FORBIDDEN" (case-insensitive).
func isForbiddenCode(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var code float64
	if json.Unmarshal(raw, &code) == nil && code == 403 {
		return true
	}
	var codeStr string
	if json.Unmarshal(raw, &codeStr) == nil {
		return codeStr == "403" || strings.EqualFold(codeStr, "FORBIDDEN")
	}
	return false
}

// Middleware buffers the engine's response. After all subgraph calls complete,
// it checks the forbidden flag: on 403, the buffered response is discarded and
// replaced with the standardised forbiddenErrorBody (no partial data, no
// pipeline-decorated extensions — always the same clean error).
func (m *ForbiddenHandlerModule) Middleware(ctx core.RequestContext, next http.Handler) {
	// Skip for streaming subscriptions (SSE/multipart) — they require
	// http.Flusher and deliver data incrementally, so buffering does not apply.
	// The flag is set before calling next so that OnOriginRequest and
	// OnOriginResponse also skip their forbidden-handling logic.
	if isStreamingRequest(ctx.Request()) {
		ctx.Set("streaming_request", true)
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	// Save the real writer before calling next — the wrapper propagates the
	// writer passed to ServeHTTP into reqContext.responseWriter, so after
	// next.ServeHTTP(bw, ...) returns, ctx.ResponseWriter() may point to bw.
	w := ctx.ResponseWriter()

	bw := &bufferedWriter{
		header: make(http.Header),
	}

	next.ServeHTTP(bw, ctx.Request())

	if ctx.GetBool("forbidden_encountered") {
		// A subgraph returned 403 — discard whatever the engine produced
		// (which may contain pipeline-decorated errors with serviceName,
		// statusCode, DOWNSTREAM_SERVICE_ERROR, etc.) and write the
		// standardised forbidden response directly.
		maps.Copy(w.Header(), bw.header)
		w.Header().Del("Content-Length")
		w.Header().Del("Content-Encoding")
		w.Header().Del("Transfer-Encoding")
		w.Header().Del("ETag")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(forbiddenErrorBody)
		return
	}

	// Flush buffered response to the real writer
	maps.Copy(w.Header(), bw.header)
	if bw.code != 0 {
		w.WriteHeader(bw.code)
	}
	_, _ = w.Write(bw.body.Bytes())
}

func isStreamingRequest(r *http.Request) bool {
	accept := strings.ToLower(strings.TrimSpace(r.Header.Get("Accept")))
	return strings.Contains(accept, "text/event-stream") ||
		strings.Contains(accept, "multipart/mixed")
}

// bufferedWriter captures the full response (headers, status, body) in memory
// so the middleware can decide whether to flush it or replace it.
type bufferedWriter struct {
	header http.Header
	code   int
	body   bytes.Buffer
}

func (w *bufferedWriter) Header() http.Header { return w.header }
func (w *bufferedWriter) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
}
func (w *bufferedWriter) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return w.body.Write(b)
}

func (m *ForbiddenHandlerModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &ForbiddenHandlerModule{}
		},
	}
}

// Interface guards
var (
	_ core.RouterMiddlewareHandler = (*ForbiddenHandlerModule)(nil)
	_ core.EnginePreOriginHandler  = (*ForbiddenHandlerModule)(nil)
	_ core.EnginePostOriginHandler = (*ForbiddenHandlerModule)(nil)
	_ core.Provisioner             = (*ForbiddenHandlerModule)(nil)
	_ core.Cleaner                 = (*ForbiddenHandlerModule)(nil)
)
