package factoryresolver

import (
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	otrace "go.opentelemetry.io/otel/trace"
	"net/http"
	"net/url"
	"time"
)

type TransportFactory struct{}

var _ ApiTransportFactory = TransportFactory{}

func New() *TransportFactory {
	return &TransportFactory{}
}

func (t TransportFactory) RoundTripper(transport *http.Transport, enableStreamingMode bool) http.RoundTripper {
	return trace.NewTransport(
		transport,
		otelhttp.WithSpanOptions(otrace.WithAttributes(otel.EngineTransportAttribute)),
	)
}

func (t TransportFactory) DefaultTransportTimeout() time.Duration {
	return time.Duration(60) * time.Second
}

func (t TransportFactory) DefaultHTTPProxyURL() *url.URL {
	return nil
}
