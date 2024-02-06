package trace

import (
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	semconv12 "go.opentelemetry.io/otel/semconv/v1.12.0"
	semconv17 "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
	"net/http"
)

type Middleware struct {
	otelOpts []otelhttp.Option
}

func NewMiddleware(opts ...otelhttp.Option) *Middleware {
	h := &Middleware{
		otelOpts: opts,
	}

	return h
}

func (h *Middleware) Handler(next http.Handler) http.Handler {

	fn := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		span := trace.SpanFromContext(r.Context())

		// Add request target as attribute, so we can filter by path and query
		span.SetAttributes(semconv17.HTTPTarget(r.RequestURI))

		// Add the host request header to the span
		span.SetAttributes(semconv12.HTTPHostKey.String(r.Host))

		// Process request
		next.ServeHTTP(w, r)
	})

	mh := otelhttp.NewHandler(
		fn,
		"",
		h.otelOpts...,
	)

	return mh
}
