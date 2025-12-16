package context_error

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

func init() {
	core.RegisterModule(&ContextErrorModule{})
}

const myModuleID = "contextErrorModule"

type ContextErrorModule struct {
	ErrorValue error
}

type headerCapturingWriter struct {
	http.ResponseWriter
	ctx             core.RequestContext
	statusCode      int
	moduleReference *ContextErrorModule
	hasError        bool
	headerWritten   bool
}

func (w *headerCapturingWriter) checkAndSetError() {
	if !w.hasError {
		if err := w.ctx.Error(); err != nil {
			w.moduleReference.ErrorValue = err
			w.hasError = true
			w.Header().Set("X-Has-Error", "true")
		}
	}
}

func (w *headerCapturingWriter) WriteHeader(statusCode int) {
	if !w.headerWritten {
		w.statusCode = statusCode
		w.checkAndSetError()
		w.headerWritten = true
		w.ResponseWriter.WriteHeader(statusCode)
	}
}

func (w *headerCapturingWriter) Write(b []byte) (int, error) {
	if !w.headerWritten {
		w.checkAndSetError()
		w.headerWritten = true
	}

	return w.ResponseWriter.Write(b)
}

// Flush implements http.Flusher to support streaming responses
func (w *headerCapturingWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (m *ContextErrorModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	// Wrap the response writer to intercept writes
	wrappedWriter := &headerCapturingWriter{
		ResponseWriter:  ctx.ResponseWriter(),
		ctx:             ctx,
		statusCode:      0,
		moduleReference: m,
	}

	// Call the next handler with the wrapped writer
	// This wrapped writer will be passed through to all subsequent handlers,
	// including the pre-handler where authentication happens
	next.ServeHTTP(wrappedWriter, ctx.Request())
}

func (m *ContextErrorModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &ContextErrorModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterOnRequestHandler = (*ContextErrorModule)(nil)
)
