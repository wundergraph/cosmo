// Package custom_forbidden_handler standardizes 403 auth failure responses from subgraphs.
//
// Requirements addressed:
//  1. Replaces the default subgraph 403 response with a uniform format:
//     {"errors":[{"message":"...","extensions":{"code":"FORBIDDEN"}}]}
//  2. If any subgraph returns 403, the entire response is replaced — no partial data.
//  3. Uses a deferred-write pattern so the happy path (no 403) has zero buffering overhead.
//
// How it works:
//   - OnOriginResponse (EnginePostOriginHandler) runs per-subgraph and flags 403s on the context.
//   - Middleware wraps the ResponseWriter to defer writes until the engine is done.
//     By the first Write call, all subgraph requests have completed and the flag is known.
//     On 403, writes are discarded and WriteResponseError produces the standardized error.
package custom_forbidden_handler

import (
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
func (m *ForbiddenHandlerModule) OnOriginResponse(resp *http.Response, ctx core.RequestContext) *http.Response {
	if resp != nil && resp.StatusCode == http.StatusForbidden {
		ctx.Set("forbidden_encountered", true)
	}
	return nil
}

// Middleware uses a deferred-write wrapper so the happy path (no 403) writes
// directly to the real ResponseWriter with zero buffering. Only WriteHeader is
// deferred until the first Write, at which point all OnOriginResponse hooks
// have already fired and the forbidden flag is known.
func (m *ForbiddenHandlerModule) Middleware(ctx core.RequestContext, next http.Handler) {
	// Skip for streaming subscriptions (SSE/multipart) — they require
	// http.Flusher and deliver data incrementally, so the deferred-write
	// pattern does not apply.
	if isStreamingRequest(ctx.Request()) {
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	dw := &deferredWriter{
		real:   ctx.ResponseWriter(),
		ctx:    ctx,
		header: make(http.Header),
		code:   http.StatusOK,
	}

	next.ServeHTTP(dw, ctx.Request())

	if dw.discarded {
		// 403 was detected — write the standardized error to the real writer
		core.WriteResponseError(ctx, core.NewHttpGraphqlError(
			"Insufficient permissions to fulfill the request.",
			"FORBIDDEN",
			http.StatusForbidden,
		))
	}
}

func isStreamingRequest(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "text/event-stream") ||
		strings.Contains(accept, "multipart/mixed")
}

// deferredWriter defers WriteHeader until the first Write call. By that point
// the engine has finished all subgraph requests, so the forbidden flag is set.
// On the happy path, headers and body flow straight to the real writer.
// On 403, all writes are silently discarded.
type deferredWriter struct {
	real      http.ResponseWriter
	ctx       core.RequestContext
	header    http.Header
	code      int
	flushed   bool
	discarded bool
}

func (w *deferredWriter) Header() http.Header { return w.header }

func (w *deferredWriter) WriteHeader(code int) {
	if !w.flushed {
		w.code = code
	}
}

func (w *deferredWriter) Write(b []byte) (int, error) {
	if !w.flushed {
		w.flushed = true
		if w.ctx.GetBool("forbidden_encountered") {
			w.discarded = true
			return len(b), nil
		}
		// Happy path: flush deferred headers + status to real writer
		for k, v := range w.header {
			w.real.Header()[k] = v
		}
		w.real.WriteHeader(w.code)
	}
	if w.discarded {
		return len(b), nil
	}
	return w.real.Write(b)
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
	_ core.EnginePostOriginHandler = (*ForbiddenHandlerModule)(nil)
	_ core.Provisioner             = (*ForbiddenHandlerModule)(nil)
	_ core.Cleaner                 = (*ForbiddenHandlerModule)(nil)
)
