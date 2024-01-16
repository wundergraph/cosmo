package trace

import (
	"context"
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
	if r.URL.Path == "/favicon.ico" || r.Method == "OPTIONS" {
		return false
	}
	// Ignore websocket connections
	if r.Header.Get("Upgrade") != "" {
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
