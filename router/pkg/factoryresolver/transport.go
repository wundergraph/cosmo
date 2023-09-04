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

type TransportPreHandler func(*http.Request)
type TransportPostHandler func(*http.Response, *http.Request) (*http.Response, error)

type CustomTransport struct {
	originalTransport http.RoundTripper
	preHandlers       []TransportPreHandler
	postHandlers      []TransportPostHandler
}

func NewCustomTransport(originalTransport http.RoundTripper) *CustomTransport {
	return &CustomTransport{
		originalTransport: originalTransport,
	}
}

func (ct *CustomTransport) RoundTrip(req *http.Request) (*http.Response, error) {

	if ct.preHandlers != nil {
		for _, preHandler := range ct.preHandlers {
			preHandler(req)
		}
	}

	resp, err := ct.originalTransport.RoundTrip(req)

	// Short circuit if there is an error
	if err != nil {
		return resp, err
	}

	if ct.postHandlers != nil {
		for _, postHandler := range ct.postHandlers {
			handlerResp, err := postHandler(resp, req)
			// Abort with the first error
			if err != nil {
				return handlerResp, err
			}
			// Abort with the first handler that returns a non-nil response
			if handlerResp != nil {
				return handlerResp, err
			}
		}
	}

	return resp, err
}

type TransportFactory struct {
	customTransport *CustomTransport
	preHandlers     []TransportPreHandler
	postHandlers    []TransportPostHandler
}

var _ ApiTransportFactory = TransportFactory{}

func New(preHandlers []TransportPreHandler, postHandlers []TransportPostHandler) *TransportFactory {
	return &TransportFactory{
		preHandlers:  preHandlers,
		postHandlers: postHandlers,
	}
}

func (t TransportFactory) RoundTripper(transport *http.Transport, enableStreamingMode bool) http.RoundTripper {
	tp := NewCustomTransport(
		trace.NewTransport(
			transport,
			otelhttp.WithSpanOptions(otrace.WithAttributes(otel.EngineTransportAttribute)),
		),
	)

	tp.preHandlers = t.preHandlers
	tp.postHandlers = t.postHandlers

	return tp
}

func (t TransportFactory) DefaultTransportTimeout() time.Duration {
	return time.Duration(60) * time.Second
}

func (t TransportFactory) DefaultHTTPProxyURL() *url.URL {
	return nil
}
