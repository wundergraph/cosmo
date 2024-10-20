package trace

import (
	"context"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/codes"
	"net/http"
	"strings"

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

func PrefixRequestFilter(prefixes []string) func(r *http.Request) bool {
	return func(r *http.Request) bool {
		for _, prefix := range prefixes {
			if strings.HasPrefix(r.URL.Path, prefix) {
				return false
			}
		}
		return true
	}
}

func CommonRequestFilter(r *http.Request) bool {
	// Ignore favicon requests
	if r.URL.Path == "/favicon.ico" {
		return false
	}
	// Ignore other methods that aren't part of GraphQL over HTTP spec
	if r.Method != "GET" && r.Method != "POST" {
		return false
	}
	// Ignore websocket upgrade requests over GET
	if r.Method == "GET" && r.Header.Get("Upgrade") != "" {
		return false
	}
	// Ignore if client disables tracing through header
	if r.Header.Get("X-WG-DISABLE-TRACING") == "true" {
		return false
	}
	return true
}

func GetClientHeader(h http.Header, headerNames []string, defaultValue string) string {
	for _, headerName := range headerNames {
		value := h.Get(headerName)
		if value != "" {
			return value
		}
	}
	return defaultValue
}

// AttachErrToSpan attaches an error to a span if it is not nil.
// If called multiple times, every error will be attached.
func AttachErrToSpan(span trace.Span, err error) {
	if err != nil {
		span.SetStatus(codes.Error, err.Error())
		span.SetAttributes(rotel.WgRequestError.Bool(true))
		span.RecordError(err)
	}
}
