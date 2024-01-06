package core

import (
	"bytes"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/metric"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
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
	metricStore  metric.Store
	logger       *zap.Logger

	sf *singleflight.Group
}

func NewCustomTransport(
	logger *zap.Logger,
	roundTripper http.RoundTripper,
	retryOptions retrytransport.RetryOptions,
	metricStore metric.Store,
	enableSingleFlight bool,
) *CustomTransport {

	ct := &CustomTransport{
		metricStore: metricStore,
	}
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

func (ct *CustomTransport) measureSubgraphMetrics(req *http.Request) func(err error, resp *http.Response) {

	reqContext := getRequestContext(req.Context())
	baseFields := commonMetricAttributes(reqContext.operation)

	activeSubgraph := reqContext.ActiveSubgraph(req)
	if activeSubgraph != nil {
		baseFields = append(baseFields, otel.WgSubgraphName.String(activeSubgraph.Name))
		baseFields = append(baseFields, otel.WgSubgraphID.String(activeSubgraph.Id))
	}

	inFlightDone := ct.metricStore.MeasureInFlight(req.Context(), baseFields...)
	ct.metricStore.MeasureRequestSize(req.Context(), req.ContentLength, baseFields...)

	operationStartTime := time.Now()

	return func(err error, resp *http.Response) {
		if err != nil {
			baseFields = append(baseFields, otel.WgRequestError.Bool(true))
		}

		ct.metricStore.MeasureRequestCount(req.Context(), baseFields...)
		ct.metricStore.MeasureLatency(req.Context(), operationStartTime, baseFields...)

		if resp != nil {
			baseFields = append(baseFields, semconv.HTTPStatusCode(resp.StatusCode))
			ct.metricStore.MeasureResponseSize(req.Context(), resp.ContentLength, baseFields...)
		}

		inFlightDone()
	}
}

func (ct *CustomTransport) RoundTrip(req *http.Request) (resp *http.Response, err error) {

	reqContext := getRequestContext(req.Context())

	done := ct.measureSubgraphMetrics(req)
	defer func() {
		done(err, resp)
	}()

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

	if !ct.allowSingleFlight(req) {
		resp, err = ct.roundTripper.RoundTrip(req)
	} else {
		resp, err = ct.roundTripSingleFlight(req)
	}

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
	keyGen := pool.Hash64.Get()
	defer pool.Hash64.Put(keyGen)

	// Hash the request body
	if req.Body != nil {
		executionBuf := pool.BytesBuffer.Get()
		defer executionBuf.Reset()
		if _, err := io.Copy(executionBuf, req.Body); err != nil {
			return nil, err
		}
		body := executionBuf.Bytes()
		_, err := keyGen.Write(body)
		if err != nil {
			return nil, err
		}
		// Restore the body
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

	// We need to use the single flight group to ensure that the request is only sent once
	v, err, shared := ct.sf.Do(key, func() (interface{}, error) {
		res, err := ct.roundTripper.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		executionBuf := pool.BytesBuffer.Get()
		defer executionBuf.Reset()
		if err != nil {
			return nil, err
		}
		if _, err := io.Copy(executionBuf, res.Body); err != nil {
			return nil, err
		}
		return &responseWithBody{
			res:  res,
			body: executionBuf.Bytes(),
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

	// Restore the body
	res.Body = io.NopCloser(bytes.NewReader(rwb.body))

	return res, nil
}

type TransportFactory struct {
	preHandlers                   []TransportPreHandler
	postHandlers                  []TransportPostHandler
	retryOptions                  retrytransport.RetryOptions
	requestTimeout                time.Duration
	localhostFallbackInsideDocker bool
	metricStore                   metric.Store
	logger                        *zap.Logger
}

var _ ApiTransportFactory = TransportFactory{}

type TransportOptions struct {
	PreHandlers                   []TransportPreHandler
	PostHandlers                  []TransportPostHandler
	RetryOptions                  retrytransport.RetryOptions
	RequestTimeout                time.Duration
	LocalhostFallbackInsideDocker bool
	MetricStore                   metric.Store
	Logger                        *zap.Logger
}

func NewTransport(opts *TransportOptions) *TransportFactory {
	return &TransportFactory{
		preHandlers:                   opts.PreHandlers,
		postHandlers:                  opts.PostHandlers,
		retryOptions:                  opts.RetryOptions,
		requestTimeout:                opts.RequestTimeout,
		localhostFallbackInsideDocker: opts.LocalhostFallbackInsideDocker,
		metricStore:                   opts.MetricStore,
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

			commonAttributeValues := commonMetricAttributes(operation)

			subgraph := reqContext.ActiveSubgraph(r)
			if subgraph != nil {
				commonAttributeValues = append(commonAttributeValues, otel.WgSubgraphID.String(subgraph.Id))
				commonAttributeValues = append(commonAttributeValues, otel.WgSubgraphName.String(subgraph.Name))
			}

			span.SetAttributes(commonAttributeValues...)

		}),
	)
	tp := NewCustomTransport(
		t.logger,
		traceTransport,
		t.retryOptions,
		t.metricStore,
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
