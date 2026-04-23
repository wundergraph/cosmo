package trace

import (
	gocontext "context"
	"errors"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/internal/context"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type TransportOption func(svr *transport)

// NewTransport wraps the provided http.RoundTripper. Internally it uses otelhttp.NewTransport to instrument the request.
func NewTransport(base http.RoundTripper, otelHttpOptions []otelhttp.Option, options ...TransportOption) http.RoundTripper {
	transport := &transport{
		rt: base,
	}

	for _, opt := range options {
		opt(transport)
	}

	otelHttpOptions = append(otelHttpOptions, otelhttp.WithFilter(CommonRequestFilter))

	return otelhttp.NewTransport(
		transport, otelHttpOptions...,
	)
}

type transport struct {
	rt      http.RoundTripper
	handler func(r *http.Request)
}

func (t *transport) RoundTrip(r *http.Request) (*http.Response, error) {

	if t.handler != nil {
		t.handler(r)
	}

	startTime := time.Now()

	res, err := t.rt.RoundTrip(r)

	if value := r.Context().Value(context.FetchTimingKey); value != nil {
		if fetchTiming, ok := value.(*atomic.Int64); ok {
			fetchTiming.Add(int64(time.Since(startTime)))
		}
	}

	// In case of a roundtrip error the span status is set to error by the otelhttp.RoundTrip function.
	// Also, status code >= 500 is considered an error.
	// Client disconnections (context.Canceled) are not server-side errors. Pre-set the span
	// status to Ok so that otelhttp cannot override it with Error (per OTel spec, Ok is final).
	if err != nil && errors.Is(err, gocontext.Canceled) {
		span := trace.SpanFromContext(r.Context())
		span.SetStatus(codes.Ok, "client disconnected")
	}

	return res, err
}

// WithPreHandler allows to set a pre handler function that is called before the request is sent.
func WithPreHandler(handler func(r *http.Request)) TransportOption {
	return func(svr *transport) {
		svr.handler = handler
	}
}
