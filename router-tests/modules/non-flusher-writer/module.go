package non_flusher_writer

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const moduleID = "nonFlusherWriterModule"

type NonFlusherWriterModule struct {
	Logger *zap.Logger
}

func (m *NonFlusherWriterModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *NonFlusherWriterModule) Cleanup() error {
	return nil
}

// nonFlusherWriter wraps http.ResponseWriter but explicitly does NOT implement http.Flusher
// This will cause GetSubscriptionResponseWriter to return false, triggering the error path
type nonFlusherWriter struct {
	http.ResponseWriter
}

// Explicitly delegate Header() to ensure headers are accessible
func (w *nonFlusherWriter) Header() http.Header {
	return w.ResponseWriter.Header()
}

// Explicitly delegate WriteHeader to ensure status codes are passed through
func (w *nonFlusherWriter) WriteHeader(statusCode int) {
	w.ResponseWriter.WriteHeader(statusCode)
}

// Explicitly delegate Write to ensure body is passed through
func (w *nonFlusherWriter) Write(b []byte) (int, error) {
	return w.ResponseWriter.Write(b)
}

func (m *NonFlusherWriterModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	// Wrap the response writer to remove the Flusher interface
	wrappedWriter := &nonFlusherWriter{
		ResponseWriter: ctx.ResponseWriter(),
	}

	// Call the next handler with the wrapped writer
	next.ServeHTTP(wrappedWriter, ctx.Request())
}

func (m *NonFlusherWriterModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &NonFlusherWriterModule{}
		},
	}
}

// Interface guards
var (
	_ core.RouterOnRequestHandler = (*NonFlusherWriterModule)(nil)
	_ core.Provisioner            = (*NonFlusherWriterModule)(nil)
	_ core.Cleaner                = (*NonFlusherWriterModule)(nil)
)
