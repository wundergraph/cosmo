package core

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	otrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type TransportPreHandler func(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
type TransportPostHandler func(resp *http.Response, ctx RequestContext) *http.Response

type CustomTransport struct {
	roundTripper http.RoundTripper
	preHandlers  []TransportPreHandler
	postHandlers []TransportPostHandler
	logger       *zap.Logger
}

func NewCustomTransport(logger *zap.Logger, roundTripper http.RoundTripper, retryOptions retrytransport.RetryOptions) *CustomTransport {

	if retryOptions.Enabled {
		return &CustomTransport{
			roundTripper: retrytransport.NewRetryHTTPTransport(roundTripper, retryOptions, logger),
		}
	}

	return &CustomTransport{
		roundTripper: roundTripper,
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

	// Set the error on the request context so that it can be checked by the post handlers
	if err != nil {
		reqContext.sendError = err
	}

	if ct.postHandlers != nil {
		for _, postHandler := range ct.postHandlers {
			newResp := postHandler(resp, reqContext)
			// Abort with the first handler that returns a non-nil response
			if newResp != nil {
				return newResp, nil
			}
		}
	}

	if err != nil {
		return nil, err
	}

	return resp, err
}

type TransportFactory struct {
	customTransport *CustomTransport
	preHandlers     []TransportPreHandler
	postHandlers    []TransportPostHandler
	retryOptions    retrytransport.RetryOptions
	requestTimeout  time.Duration
	logger          *zap.Logger
}

var _ ApiTransportFactory = TransportFactory{}

type TransportOptions struct {
	preHandlers    []TransportPreHandler
	postHandlers   []TransportPostHandler
	retryOptions   retrytransport.RetryOptions
	requestTimeout time.Duration
	logger         *zap.Logger
}

func NewTransport(opts *TransportOptions) *TransportFactory {
	return &TransportFactory{
		preHandlers:    opts.preHandlers,
		postHandlers:   opts.postHandlers,
		logger:         opts.logger,
		retryOptions:   opts.retryOptions,
		requestTimeout: opts.requestTimeout,
	}
}

func (t TransportFactory) RoundTripper(transport http.RoundTripper, enableStreamingMode bool) http.RoundTripper {
	tp := NewCustomTransport(
		t.logger,
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
					if operation.name != "" {
						span.SetAttributes(otel.WgOperationName.String(operation.name))
					}
					span.SetAttributes(otel.WgOperationType.String(operation.opType))
				}

				reqContext := getRequestContext(r.Context())

				subgraph := reqContext.ActiveSubgraph(r)
				if subgraph != nil {
					span.SetAttributes(otel.WgSubgraphID.String(subgraph.Id))
					span.SetAttributes(otel.WgSubgraphName.String(subgraph.Name))
				}

			}),
		),
		t.retryOptions,
	)

	tp.preHandlers = t.preHandlers
	tp.postHandlers = t.postHandlers
	tp.logger = t.logger

	return tp
}

func (t TransportFactory) DefaultTransportTimeout() time.Duration {
	return t.requestTimeout
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
