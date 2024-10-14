package trace

import (
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	semconv12 "go.opentelemetry.io/otel/semconv/v1.12.0"
	semconv17 "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
	"net/http"
)

type MiddlewareOption func(h *Middleware)

type Middleware struct {
	otelOpts   []otelhttp.Option
	preHandler func(r *http.Request, w http.ResponseWriter, graphqlExecutionSpan trace.Span)
}

// SensitiveAttributes that should be redacted by the OTEL http instrumentation package.
// Take attention to the right version of the semconv package.
var SensitiveAttributes = []attribute.Key{
	// Both can contain external IP addresses
	semconv17.HTTPClientIPKey,
	semconv17.NetSockPeerAddrKey,
}

func NewMiddleware(options ...MiddlewareOption) *Middleware {
	h := &Middleware{}
	for _, option := range options {
		option(h)
	}

	return h
}

func (h *Middleware) Handler(next http.Handler) http.Handler {

	fn := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		span := trace.SpanFromContext(r.Context())

		// Add custom attributes to the span
		if h.preHandler != nil {
			h.preHandler(r, w, span)
		}

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

func WithTracePreHandler(preHandler func(r *http.Request, w http.ResponseWriter, graphqlExecutionSpan trace.Span)) MiddlewareOption {
	return func(h *Middleware) {
		h.preHandler = preHandler
	}
}

func WithOtelHttp(otelOpts ...otelhttp.Option) MiddlewareOption {
	return func(h *Middleware) {
		h.otelOpts = otelOpts
	}
}
