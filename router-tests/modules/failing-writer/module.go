package failing_writer

import (
	"errors"
	"net/http"
	"strings"
	"syscall"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const moduleID = "failingWriterModule"

type ErrorType string

const (
	ErrorTypeBrokenPipe          ErrorType = "broken_pipe"
	ErrorTypeGeneric             ErrorType = "generic"
	ErrorTypeBrokenPipeOnBody    ErrorType = "broken_pipe_on_body"
	ErrorTypeGenericOnBody       ErrorType = "generic_on_body"
	ErrorTypeBrokenPipeMultipart ErrorType = "broken_pipe_multipart"
	ErrorTypeGenericMultipart    ErrorType = "generic_multipart"
)

type failingWriter struct {
	http.ResponseWriter
	errorType ErrorType
}

func (w *failingWriter) Write(b []byte) (int, error) {
	shouldFail := false
	switch w.errorType {
	case ErrorTypeBrokenPipe, ErrorTypeGeneric:
		shouldFail = true
	case ErrorTypeBrokenPipeOnBody, ErrorTypeGenericOnBody:
		if len(b) > 0 && b[0] == '{' {
			shouldFail = true
		}
	case ErrorTypeBrokenPipeMultipart, ErrorTypeGenericMultipart:
		content := string(b)
		if strings.Contains(content, "--graphql") || strings.Contains(content, "Content-Type: application/json") {
			shouldFail = true
		}
	}

	if !shouldFail {
		return w.ResponseWriter.Write(b)
	}

	switch w.errorType {
	case ErrorTypeBrokenPipe, ErrorTypeBrokenPipeOnBody, ErrorTypeBrokenPipeMultipart:
		return 0, syscall.EPIPE
	case ErrorTypeGeneric, ErrorTypeGenericOnBody, ErrorTypeGenericMultipart:
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
