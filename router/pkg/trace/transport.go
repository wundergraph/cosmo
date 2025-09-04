package trace

import (
	"net/http"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/internal/context"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
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
	// Also, status code >= 500 is considered an error

	return res, err
}

// WithPreHandler allows to set a pre handler function that is called before the request is sent.
func WithPreHandler(handler func(r *http.Request)) TransportOption {
	return func(svr *transport) {
		svr.handler = handler
	}
}
