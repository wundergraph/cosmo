package trace

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/contextx"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// TracerFromContext returns a tracer in ctx, otherwise returns a global tracer.
func TracerFromContext(ctx context.Context) (tracer trace.Tracer) {
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		tracer = span.TracerProvider().Tracer(ServerName)
	} else {
		tracer = otel.Tracer(ServerName)
	}

	return
}

// SpanNameFormatter formats the span name based on the http request
// Note: High cardinality should be avoided because it can be expensive
func SpanNameFormatter(operation string, r *http.Request) string {
	if operation != "" {
		return operation
	}

	opCtx := contextx.GetOperationContext(r.Context())
	if opCtx != nil && opCtx.Name != "" {
		if opCtx.Name != "" {
			return opCtx.Name
		}
		return "unnamed"
	}

	return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
}

func RequestFilter(r *http.Request) bool {
	if r.URL.Path == "/health" || r.URL.Path == "/favicon.ico" || r.Method == "OPTIONS" {
		return false
	}
	return true
}

func GetClientInfo(h http.Header, primaryHeader, fallbackHeader, defaultValue string) string {
	value := h.Get(primaryHeader)
	if value == "" {
		value = h.Get(fallbackHeader)
		if value == "" {
			value = defaultValue
		}
	}
	return value
}
