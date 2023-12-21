package core

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/pool"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	otrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

type TransportPreHandler func(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
type TransportPostHandler func(resp *http.Response, ctx RequestContext) *http.Response

type CustomTransport struct {
	roundTripper http.RoundTripper
	preHandlers  []TransportPreHandler
	postHandlers []TransportPostHandler
	logger       *zap.Logger

	sf *singleflight.Group
}

func NewCustomTransport(logger *zap.Logger, roundTripper http.RoundTripper, retryOptions retrytransport.RetryOptions, enableSingleFlight bool) *CustomTransport {

	ct := &CustomTransport{}
	if retryOptions.Enabled {
		ct.roundTripper = retrytransport.NewRetryHTTPTransport(roundTripper, retryOptions, logger)
	} else {
		ct.roundTripper = roundTripper
	}
	if enableSingleFlight {
		ct.sf = &singleflight.Group{}
	}

	return ct
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

	resp, err := ct.roundTripSingleFlight(req)

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

type responseWithBody struct {
	res  *http.Response
	body []byte
}

func (ct *CustomTransport) allowSingleFlight(req *http.Request) bool {
	if ct.sf == nil {
		// Single flight is disabled
		return false
	}

	if req.Header.Get("Upgrade") != "" {
		// Websocket requests are not idempotent
		return false
	}

	if req.Header.Get("Accept") == "text/event-stream" {
		// SSE requests are not idempotent
		return false
	}

	if resolve.SingleFlightDisallowed(req.Context()) {
		// Single flight is disallowed for this request (e.g. because it is a Mutation)
		return false
	}

	return true
}

func (ct *CustomTransport) roundTripSingleFlight(req *http.Request) (*http.Response, error) {

	if !ct.allowSingleFlight(req) {
		return ct.roundTripper.RoundTrip(req)
	}

	keyGen := pool.Hash64.Get()
	defer pool.Hash64.Put(keyGen)

	if req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		_, err = keyGen.Write(body)
		if err != nil {
			return nil, err
		}
		req.Body = io.NopCloser(bytes.NewReader(body))
	}

	unsortedHeaders := make([]string, 0, len(req.Header))

	for key := range req.Header {
		value := req.Header.Get(key)
		unsortedHeaders = append(unsortedHeaders, key+value)
	}

	sort.Strings(unsortedHeaders)
	for i := range unsortedHeaders {
		_, err := keyGen.Write(unsafebytes.StringToBytes(unsortedHeaders[i]))
		if err != nil {
			return nil, err
		}
	}

	sum := keyGen.Sum64()
	key := strconv.FormatUint(sum, 10)

	v, err, shared := ct.sf.Do(key, func() (interface{}, error) {
		res, err := ct.roundTripper.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}
		return &responseWithBody{
			res:  res,
			body: body,
		}, nil
	})
	if err != nil {
		return nil, err
	}

	sfStats := resolve.GetSingleFlightStats(req.Context())
	if sfStats != nil {
		sfStats.SingleFlightUsed = true
		sfStats.SingleFlightSharedResponse = shared
	}
	rwb := v.(*responseWithBody)
	res := &http.Response{}
	res.Status = rwb.res.Status
	res.StatusCode = rwb.res.StatusCode
	res.Header = rwb.res.Header.Clone()
	res.Trailer = rwb.res.Trailer.Clone()
	res.ContentLength = rwb.res.ContentLength
	res.TransferEncoding = rwb.res.TransferEncoding
	res.Close = rwb.res.Close
	res.Uncompressed = rwb.res.Uncompressed
	res.Request = req
	res.Body = io.NopCloser(bytes.NewReader(rwb.body))

	return res, nil
}

type TransportFactory struct {
	preHandlers                   []TransportPreHandler
	postHandlers                  []TransportPostHandler
	retryOptions                  retrytransport.RetryOptions
	requestTimeout                time.Duration
	localhostFallbackInsideDocker bool
	logger                        *zap.Logger
}

var _ ApiTransportFactory = TransportFactory{}

type TransportOptions struct {
	PreHandlers                   []TransportPreHandler
	PostHandlers                  []TransportPostHandler
	RetryOptions                  retrytransport.RetryOptions
	RequestTimeout                time.Duration
	LocalhostFallbackInsideDocker bool
	Logger                        *zap.Logger
}

func NewTransport(opts *TransportOptions) *TransportFactory {
	return &TransportFactory{
		preHandlers:                   opts.PreHandlers,
		postHandlers:                  opts.PostHandlers,
		retryOptions:                  opts.RetryOptions,
		requestTimeout:                opts.RequestTimeout,
		localhostFallbackInsideDocker: opts.LocalhostFallbackInsideDocker,
		logger:                        opts.Logger,
	}
}

func (t TransportFactory) RoundTripper(enableSingleFlight bool, transport http.RoundTripper) http.RoundTripper {
	if t.localhostFallbackInsideDocker && docker.Inside() {
		transport = docker.NewLocalhostFallbackRoundTripper(transport)
	}
	traceTransport := trace.NewTransport(
		transport,
		[]otelhttp.Option{
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
			otelhttp.WithSpanOptions(otrace.WithAttributes(otel.EngineTransportAttribute)),
		},
		trace.WithPreHandler(func(r *http.Request) {
			span := otrace.SpanFromContext(r.Context())
			reqContext := getRequestContext(r.Context())
			operation := reqContext.operation

			if operation != nil {
				if operation.name != "" {
					span.SetAttributes(otel.WgOperationName.String(operation.name))
				}
				if operation.opType != "" {
					span.SetAttributes(otel.WgOperationType.String(operation.opType))
				}
				if operation.hash != 0 {
					span.SetAttributes(otel.WgOperationHash.String(strconv.FormatUint(operation.hash, 10)))
				}
			}

			subgraph := reqContext.ActiveSubgraph(r)
			if subgraph != nil {
				span.SetAttributes(otel.WgSubgraphID.String(subgraph.Id))
				span.SetAttributes(otel.WgSubgraphName.String(subgraph.Name))
			}

		}),
	)
	tp := NewCustomTransport(
		t.logger,
		traceTransport,
		t.retryOptions,
		enableSingleFlight,
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
func SpanNameFormatter(_ string, r *http.Request) string {
	opCtx := getOperationContext(r.Context())
	if opCtx != nil {
		return GetSpanName(opCtx.Name(), opCtx.Type())
	}

	return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
}

func GetSpanName(operationName string, operationType string) string {
	if operationName != "" {
		return fmt.Sprintf("%s %s", operationType, operationName)
	}
	return fmt.Sprintf("%s %s", operationType, "unnamed")
}
