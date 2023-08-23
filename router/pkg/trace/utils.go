package trace

import (
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// TracerFromContext returns a tracer in ctx, otherwise returns a global tracer.
func TracerFromContext(ctx context.Context) (tracer trace.Tracer) {
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		tracer = span.TracerProvider().Tracer(TraceName)
	} else {
		tracer = otel.Tracer(TraceName)
	}

	return
}

// SpanNameFormatter formats the span name based on the http request
func SpanNameFormatter(_operation string, r *http.Request) string {
	return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
}

func RequestFilter(req *http.Request) bool {
	if req.URL.Path == "/health" || req.URL.Path == "/favicon.ico" || req.Method == "OPTIONS" {
		return false
	}
	return true
}

func GetClientInfo(c *gin.Context, primaryHeader, fallbackHeader, defaultValue string) string {
	value := c.GetHeader(primaryHeader)
	if value == "" {
		value = c.GetHeader(fallbackHeader)
		if value == "" {
			value = defaultValue
		}
	}
	return value
}
