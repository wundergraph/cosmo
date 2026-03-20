package trace

import (
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"net/http"
)

type MiddlewareOption func(h *Middleware)

type Middleware struct {
	otelOpts   []otelhttp.Option
	preHandler func(r *http.Request, w http.ResponseWriter)
}

// SensitiveAttributes that should be redacted by the OTEL http instrumentation package.
// The semconv compat processor renames new attribute keys to old names before
// redaction runs, so these use the old semconv key names.
var SensitiveAttributes = []attribute.Key{
	// Both can contain external IP addresses
	"http.client_ip",
	"net.sock.peer.addr",
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
			h.preHandler(r, w)
		}

		// Add request target as attribute, so we can filter by path and query
		span.SetAttributes(attribute.String("http.target", r.RequestURI))

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

func WithTracePreHandler(preHandler func(r *http.Request, w http.ResponseWriter)) MiddlewareOption {
	return func(h *Middleware) {
		h.preHandler = preHandler
	}
}

func WithOtelHttp(otelOpts ...otelhttp.Option) MiddlewareOption {
	return func(h *Middleware) {
		h.otelOpts = otelOpts
	}
}
