package trace

import (
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// NewTransport wraps the provided http.RoundTripper. It accepts a handler function that is called before the request is processed.
// Internally it uses otelhttp.NewTransport to instrument the request.
func NewTransport(base http.RoundTripper, handler func(r *http.Request), opts ...otelhttp.Option) http.RoundTripper {
	transport := &transport{
		rt:      base,
		handler: handler,
	}
	// ignore health check requests, favicon browser requests or OPTIONS request
	opts = append(opts, otelhttp.WithFilter(RequestFilter))

	return otelhttp.NewTransport(
		transport, opts...,
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

	res, err := t.rt.RoundTrip(r)

	// In case of a roundtrip error the span status is set to error by the otelhttp.RoundTrip function.
	// Also, status code >= 500 is considered an error

	return res, err
}
