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
	ErrorTypeBrokenPipe       ErrorType = "broken_pipe"
	ErrorTypeGeneric          ErrorType = "generic"
	ErrorTypeBrokenPipeOnBody ErrorType = "broken_pipe_on_body"
	ErrorTypeGenericOnBody    ErrorType = "generic_on_body"
)

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

// failingWriter wraps http.ResponseWriter and makes Write operations fail
type failingWriter struct {
	http.ResponseWriter
	errorType  ErrorType
	writeCount int
}

func (w *failingWriter) Write(b []byte) (int, error) {
	w.writeCount++

	// Determine if we should fail based on error type and write content
	shouldFail := false
	switch w.errorType {
	case ErrorTypeBrokenPipe, ErrorTypeGeneric:
		// Fail on first write (for SSE header tests - the "event: next\ndata: " write)
		shouldFail = w.writeCount == 1
	case ErrorTypeBrokenPipeOnBody, ErrorTypeGenericOnBody:
		// Fail on JSON body writes (skip SSE header "event: next\ndata: " if present)
		// SSE header is "event: next\ndata: " which doesn't contain '{'
		// Response bodies always start with '{'
		if len(b) > 0 && b[0] == '{' {
			shouldFail = true
		}
	}

	if !shouldFail {
		return w.ResponseWriter.Write(b)
	}

	// Return the appropriate error
	switch w.errorType {
	case ErrorTypeBrokenPipe, ErrorTypeBrokenPipeOnBody:
		return 0, syscall.EPIPE
	case ErrorTypeGeneric, ErrorTypeGenericOnBody:
		return 0, errors.New("simulated write error")
	default:
		return 0, errors.New("unknown error type")
	}
}

// Implement http.Flusher interface (needed for subscriptions)
func (w *failingWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
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
