package graphql

import (
	"fmt"
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
	roundTripper http.RoundTripper
	preHandlers  []TransportPreHandler
	postHandlers []TransportPostHandler
}

func NewCustomTransport(originalTransport http.RoundTripper) *CustomTransport {
	return &CustomTransport{
		roundTripper: originalTransport,
	}
}

func (ct *CustomTransport) RoundTrip(req *http.Request) (*http.Response, error) {

	if ct.preHandlers != nil {
		for _, preHandler := range ct.preHandlers {
			preHandler(req)
		}
	}

	resp, err := ct.roundTripper.RoundTrip(req)

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
			func(r *http.Request) {
				span := otrace.SpanFromContext(r.Context())
				operation := getOperationContext(r.Context())
				if operation != nil {
					span.SetAttributes(otel.WgOperationName.String(operation.name))
					span.SetAttributes(otel.WgOperationType.String(operation.opType))
				}
			},
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
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

// SpanNameFormatter formats the span name based on the http request
func SpanNameFormatter(operation string, r *http.Request) string {
	if operation != "" {
		return operation
	}

	opCtx := GetOperationContext(r.Context())
	if opCtx != nil {
		return GetSpanName(opCtx.Name(), r.Method)
	}

	return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
}

func GetSpanName(operationName string, method string) string {
	if operationName != "" {
		return fmt.Sprintf("%s %s", method, operationName)
	}
	return fmt.Sprintf("%s %s", method, "unnamed")
}
