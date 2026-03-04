// Package custom_forbidden_handler standardizes 403 auth failure responses from subgraphs.
//
// Requirements addressed:
//  1. Replaces the default subgraph 403 response with a uniform format:
//     {"errors":[{"message":"...","extensions":{"code":"FORBIDDEN"}}]}
//  2. If any subgraph returns 403, the entire response is replaced — no partial data.
//
// How it works:
//   - OnOriginResponse (EnginePostOriginHandler) runs per-subgraph and flags 403s on the context.
//     It detects 403 in two ways:
//     a. HTTP status code 403 on the subgraph response.
//     b. GraphQL-level error with extensions.code == 403 (number or string) in the response body,
//        even when the HTTP status is 200. The body is read, inspected, and restored so
//        downstream handlers can still consume it.
//   - Middleware buffers the response. After the engine finishes, if a 403 was flagged,
//     the buffered response is discarded and replaced with the standardized error.
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

// OnOriginResponse detects 403 from any subgraph and flags it on the context.
// It checks both the HTTP status code and the GraphQL response body for
// errors with extensions.code == 403.
func (m *ForbiddenHandlerModule) OnOriginResponse(resp *http.Response, ctx core.RequestContext) *http.Response {
	if resp == nil {
		return nil
	}

	if resp.StatusCode == http.StatusForbidden {
		ctx.Set("forbidden_encountered", true)
		return nil
	}

	// Also check if the response body contains a GraphQL error with code 403
	if resp.Body != nil {
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		// Always restore the body so downstream can still read it
		resp.Body = io.NopCloser(bytes.NewReader(body))
		if err == nil && hasForbiddenGraphQLError(body) {
			ctx.Set("forbidden_encountered", true)
		}
	}

	return nil
}

// hasForbiddenGraphQLError checks if a GraphQL response body contains an error
// with extensions.code == 403 (as a number).
func hasForbiddenGraphQLError(body []byte) bool {
	var result struct {
		Errors []struct {
			Extensions struct {
				Code json.RawMessage `json:"code"`
			} `json:"extensions"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false
	}
	for _, e := range result.Errors {
		if len(e.Extensions.Code) == 0 {
			continue
		}
		// Check as number
		var code float64
		if json.Unmarshal(e.Extensions.Code, &code) == nil && code == 403 {
			return true
		}
		// Check as string
		var codeStr string
		if json.Unmarshal(e.Extensions.Code, &codeStr) == nil && codeStr == "403" {
			return true
		}
	}
	return false
}

// Middleware buffers the engine's response. After all subgraph calls complete,
// it checks the forbidden flag: on 403, the buffer is discarded and replaced
// with the standardized error; otherwise the buffered response is flushed.
func (m *ForbiddenHandlerModule) Middleware(ctx core.RequestContext, next http.Handler) {
	// Skip for streaming subscriptions (SSE/multipart) — they require
	// http.Flusher and deliver data incrementally, so buffering does not apply.
	if isStreamingRequest(ctx.Request()) {
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	bw := &bufferedWriter{
		header: make(http.Header),
		code:   http.StatusOK,
	}

	next.ServeHTTP(bw, ctx.Request())

	if ctx.GetBool("forbidden_encountered") {
		core.WriteResponseError(ctx, core.NewHttpGraphqlError(
			"Insufficient permissions to fulfill the request.",
			"FORBIDDEN",
			http.StatusForbidden,
		))
		return
	}

	// Flush buffered response to the real writer
	real := ctx.ResponseWriter()
	maps.Copy(real.Header(), bw.header)
	real.WriteHeader(bw.code)
	_, _ = real.Write(bw.body.Bytes())
}

func isStreamingRequest(r *http.Request) bool {
	accept := r.Header.Get("Accept")
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

func (w *bufferedWriter) Header() http.Header      { return w.header }
func (w *bufferedWriter) WriteHeader(code int)      { w.code = code }
func (w *bufferedWriter) Write(b []byte) (int, error) { return w.body.Write(b) }

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
	_ core.EnginePostOriginHandler = (*ForbiddenHandlerModule)(nil)
	_ core.Provisioner             = (*ForbiddenHandlerModule)(nil)
	_ core.Cleaner                 = (*ForbiddenHandlerModule)(nil)
)
