package core

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
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
	metricStore  metric.Provider
	logger       *zap.Logger

	sf *singleflight.Group
}

func NewCustomTransport(
	logger *zap.Logger,
	roundTripper http.RoundTripper,
	retryOptions retrytransport.RetryOptions,
	metricStore metric.Provider,
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
	baseFields := getAttributesFromOperationContext(reqContext.operation)

	activeSubgraph := reqContext.ActiveSubgraph(req)
	if activeSubgraph != nil {
		baseFields = append(baseFields, otel.WgSubgraphName.String(activeSubgraph.Name))
		baseFields = append(baseFields, otel.WgSubgraphID.String(activeSubgraph.Id))
	}

	if attributes := baseAttributesFromContext(req.Context()); attributes != nil {
		baseFields = append(baseFields, attributes...)
	}

	inFlightDone := ct.metricStore.MeasureInFlight(req.Context(), baseFields...)
	ct.metricStore.MeasureRequestSize(req.Context(), req.ContentLength, baseFields...)

	operationStartTime := time.Now()

	return func(err error, resp *http.Response) {
		defer inFlightDone()

		if err != nil {
			baseFields = append(baseFields, otel.WgRequestError.Bool(true))
		}

		ct.metricStore.MeasureRequestCount(req.Context(), baseFields...)
		ct.metricStore.MeasureLatency(req.Context(), operationStartTime, baseFields...)

		if resp != nil {
			baseFields = append(baseFields, semconv.HTTPStatusCode(resp.StatusCode))
			ct.metricStore.MeasureResponseSize(req.Context(), resp.ContentLength, baseFields...)
		}
	}
}

// RoundTrip of the engine upstream requests. The handler is called concurrently for each request.
// Be aware that multiple modules can be active at the same time. Must be concurrency safe.
func (ct *CustomTransport) RoundTrip(req *http.Request) (resp *http.Response, err error) {

	moduleContext := &moduleRequestContext{
		requestContext: getRequestContext(req.Context()),
		sendError:      nil,
	}

	done := ct.measureSubgraphMetrics(req)
	defer func() {
		done(err, resp)
	}()

	if ct.preHandlers != nil {
		for _, preHandler := range ct.preHandlers {
			r, resp := preHandler(req, moduleContext)
			// Non nil response means the handler decided to skip sending the request
			if resp != nil {
				return resp, nil
			}
			req = r
		}
	}

	if !ct.allowSingleFlight(req) {
		resp, err = ct.roundTripper.RoundTrip(req)
		if err == nil && ct.isUpgradeError(req, resp) {
			err := &ErrUpgradeFailed{StatusCode: resp.StatusCode}
			if subgraph := moduleContext.ActiveSubgraph(req); subgraph != nil {
				err.SubgraphID = subgraph.Id
			}
			return nil, err
		}
	} else {
		resp, err = ct.roundTripSingleFlight(req)
	}

	// Set the error on the request context so that it can be checked by the post handlers
	if err != nil {
		moduleContext.sendError = err
	}

	if ct.postHandlers != nil {
		for _, postHandler := range ct.postHandlers {
			newResp := postHandler(resp, moduleContext)
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

func (ct *CustomTransport) isUpgradeError(req *http.Request, res *http.Response) bool {
	return req.Header.Get("Upgrade") != "" && res.StatusCode != http.StatusSwitchingProtocols
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

var (
	ctBufPool = &sync.Pool{
		New: func() any {
			return &bytes.Buffer{}
		},
	}
)

func getBuffer() *bytes.Buffer {
	return ctBufPool.Get().(*bytes.Buffer)
}

func releaseBuffer(buf *bytes.Buffer) {
	buf.Reset()
	ctBufPool.Put(buf)
}

func (ct *CustomTransport) roundTripSingleFlight(req *http.Request) (*http.Response, error) {

	// We need to use the single flight group to ensure that the request is only sent once
	v, err, shared := ct.sf.Do(ct.singleFlightKey(req), func() (interface{}, error) {
		res, err := ct.roundTripper.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		// single flight is disallowed for mutations, including file uploads
		// hence we don't need to worry about buffering the body here
		buf := getBuffer()
		defer releaseBuffer(buf)
		_, err = buf.ReadFrom(res.Body)
		if err != nil {
			return nil, err
		}
		cp := make([]byte, buf.Len())
		copy(cp, buf.Bytes())
		return &responseWithBody{
			res:  res,
			body: cp,
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

func (ct *CustomTransport) singleFlightKey(req *http.Request) string {
	keyGen := pool.Hash64.Get()
	defer pool.Hash64.Put(keyGen)

	if bodyHash, ok := httpclient.BodyHashFromContext(req.Context()); ok {
		_, _ = keyGen.WriteString(strconv.FormatUint(bodyHash, 10))
	}

	unsortedHeaders := make([]string, 0, len(req.Header))

	for key := range req.Header {
		value := req.Header.Get(key)
		unsortedHeaders = append(unsortedHeaders, key+value)
	}

	sort.Strings(unsortedHeaders)
	for i := range unsortedHeaders {
		_, _ = keyGen.WriteString(unsortedHeaders[i])
	}

	sum := keyGen.Sum64()
	return strconv.FormatUint(sum, 10)
}

type TransportFactory struct {
	preHandlers                   []TransportPreHandler
	postHandlers                  []TransportPostHandler
	retryOptions                  retrytransport.RetryOptions
	requestTimeout                time.Duration
	localhostFallbackInsideDocker bool
	metricStore                   metric.Provider
	logger                        *zap.Logger
	tracerProvider                *sdktrace.TracerProvider
}

var _ ApiTransportFactory = TransportFactory{}

type TransportOptions struct {
	PreHandlers                   []TransportPreHandler
	PostHandlers                  []TransportPostHandler
	RetryOptions                  retrytransport.RetryOptions
	RequestTimeout                time.Duration
	LocalhostFallbackInsideDocker bool
	MetricStore                   metric.Provider
	Logger                        *zap.Logger
	TracerProvider                *sdktrace.TracerProvider
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
		tracerProvider:                opts.TracerProvider,
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
			otelhttp.WithTracerProvider(t.tracerProvider),
		},
		trace.WithPreHandler(func(r *http.Request) {
			span := otrace.SpanFromContext(r.Context())
			reqContext := getRequestContext(r.Context())
			operation := reqContext.operation

			commonAttributeValues := getAttributesFromOperationContext(operation)

			subgraph := reqContext.ActiveSubgraph(r)
			if subgraph != nil {
				commonAttributeValues = append(commonAttributeValues, otel.WgSubgraphID.String(subgraph.Id))
				commonAttributeValues = append(commonAttributeValues, otel.WgSubgraphName.String(subgraph.Name))
			}

			if attributes := baseAttributesFromContext(r.Context()); attributes != nil {
				commonAttributeValues = append(commonAttributeValues, attributes...)
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
