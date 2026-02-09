package failing_writer

import (
	"errors"
	"net/http"
	"syscall"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const moduleID = "failingWriterModule"

type ErrorType string

const (
	ErrorTypeBrokenPipe ErrorType = "broken_pipe"
	ErrorTypeGeneric    ErrorType = "generic"
)

type failingWriter struct {
	http.ResponseWriter
	errorType ErrorType
}

func (w *failingWriter) Write(b []byte) (int, error) {
	// Simply fail on every write - the test controls what scenario triggers the write
	switch w.errorType {
	case ErrorTypeBrokenPipe:
		return 0, syscall.EPIPE
	case ErrorTypeGeneric:
		return 0, errors.New("simulated write error")
	default:
		return 0, errors.New("unknown error type")
	}
}

func (w *failingWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

type FailingWriterModule struct {
	Logger    *zap.Logger
	ErrorType ErrorType
}

func (m *FailingWriterModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *FailingWriterModule) Cleanup() error {
	return nil
}

func (m *FailingWriterModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	// Wrap the response writer to make it fail on Write
	wrappedWriter := &failingWriter{
		ResponseWriter: ctx.ResponseWriter(),
		errorType:      m.ErrorType,
	}

	// Call the next handler with the wrapped writer
	next.ServeHTTP(wrappedWriter, ctx.Request())
}

func (m *FailingWriterModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &FailingWriterModule{}
		},
	}
}

// Interface guards
var (
	_ core.RouterOnRequestHandler = (*FailingWriterModule)(nil)
	_ core.Provisioner            = (*FailingWriterModule)(nil)
	_ core.Cleaner                = (*FailingWriterModule)(nil)
)
