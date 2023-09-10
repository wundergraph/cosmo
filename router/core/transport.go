package core

import (
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	otrace "go.opentelemetry.io/otel/trace"
	"net/http"
	"net/url"
	"time"
)

type TransportPreHandler func(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
type TransportPostHandler func(resp *http.Response, ctx RequestContext) (*http.Response, error)

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

	reqContext := getRequestContext(req.Context())

	if ct.preHandlers != nil {
		for _, preHandler := range ct.preHandlers {
			r, resp := preHandler(req, reqContext)
			// Non nil response means the handler decided to skip sending the request
			if resp != nil {
				return resp, nil
			}
			req = r
		}
	}

	resp, err := ct.roundTripper.RoundTrip(req)

	// Short circuit if there is an error
	if err != nil {
		reqContext.sendError = err
	}

	if ct.postHandlers != nil {
		for _, postHandler := range ct.postHandlers {
			handlerResp, err := postHandler(resp, reqContext)
			// Abort with the first handler that returns an error
			if err != nil {
				return nil, err
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

func NewTransport(preHandlers []TransportPreHandler, postHandlers []TransportPostHandler) *TransportFactory {
	return &TransportFactory{
		preHandlers:  preHandlers,
		postHandlers: postHandlers,
	}
}

func (t TransportFactory) RoundTripper(transport *http.Transport, enableStreamingMode bool) http.RoundTripper {
	tp := NewCustomTransport(
		trace.NewTransport(
			transport,
			[]otelhttp.Option{
				otelhttp.WithSpanNameFormatter(SpanNameFormatter),
				otelhttp.WithSpanOptions(otrace.WithAttributes(otel.EngineTransportAttribute)),
			},
			trace.WithPreHandler(func(r *http.Request) {
				span := otrace.SpanFromContext(r.Context())
				operation := getOperationContext(r.Context())
				if operation != nil {
					span.SetAttributes(otel.WgOperationName.String(operation.name))
					span.SetAttributes(otel.WgOperationType.String(operation.opType))
				}
			}),
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

	opCtx := getOperationContext(r.Context())
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
