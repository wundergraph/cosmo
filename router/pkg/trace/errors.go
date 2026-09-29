package trace

import (
	"context"
	"errors"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
)

// invalidUTF8Error matches the InvalidUTF8() method exposed by
// google.golang.org/protobuf/internal/impl.errInvalidUTF8.
type invalidUTF8Error interface {
	InvalidUTF8() bool
}

// hasInvalidUTF8Error walks the error chain looking for an error
// that implements the invalidUTF8Error interface.
func hasInvalidUTF8Error(err error) bool {
	var target invalidUTF8Error
	if errors.As(err, &target) {
		return target.InvalidUTF8()
	}
	return false
}

// NewOtelErrorHandler returns a function that handles OTEL export errors by
// logging them. Invalid UTF-8 errors include a hint about sanitizing trace attributes.
func NewOtelErrorHandler(logger *zap.Logger) func(error) {
	return func(err error) {
		if hasInvalidUTF8Error(err) {
			logger.Error(
				"otel error: string field contains invalid UTF-8. Ensure telemetry attributes are valid UTF-8; for trace attributes, enable 'telemetry.tracing.sanitize_utf8.enabled' in your config.",
				zap.Error(err))
			return
		}
		logger.Error("otel error", zap.Error(err))
	}
}

// errorLoggingExporter wraps a SpanExporter and handles export errors locally
// instead of relying on the global otel.SetErrorHandler.
type errorLoggingExporter struct {
	wrapped sdktrace.SpanExporter
	handler func(error)
}

func (e *errorLoggingExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	err := e.wrapped.ExportSpans(ctx, spans)
	if err != nil {
		e.handler(err)
	}
	return err
}

func (e *errorLoggingExporter) Shutdown(ctx context.Context) error {
	return e.wrapped.Shutdown(ctx)
}
