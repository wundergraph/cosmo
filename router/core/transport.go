package core

import (
	"bytes"
	"fmt"
	"go.opentelemetry.io/otel/propagation"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"

	otelmetric "go.opentelemetry.io/otel/metric"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"go.opentelemetry.io/otel/attribute"
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
)

var (
	defaultTimeout = 60 * time.Second
)

type TransportPreHandler func(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
type TransportPostHandler func(resp *http.Response, ctx RequestContext) *http.Response

type CustomTransport struct {
	roundTripper http.RoundTripper
	preHandlers  []TransportPreHandler
	postHandlers []TransportPostHandler
	metricStore  metric.Store
	logger       *zap.Logger

	sf   map[uint64]*sfCacheItem
	sfMu *sync.RWMutex
}

type sfCacheItem struct {
	loaded   chan struct{}
	response *http.Response
	body     []byte
	err      error
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
		ct.sf = make(map[uint64]*sfCacheItem)
		ct.sfMu = &sync.RWMutex{}
	}

	return ct
}

func (ct *CustomTransport) measureSubgraphMetrics(req *http.Request) func(err error, resp *http.Response) {

	reqContext := getRequestContext(req.Context())
	activeSubgraph := reqContext.ActiveSubgraph(req)

	attributes := *reqContext.telemetry.AcquireAttributes()

	if activeSubgraph != nil {
		attributes = append(attributes,
			otel.WgSubgraphName.String(activeSubgraph.Name),
			otel.WgSubgraphID.String(activeSubgraph.Id),
		)
	}

	attributes = append(attributes, reqContext.telemetry.metricAttrs...)
	o := otelmetric.WithAttributeSet(attribute.NewSet(attributes...))

	inFlightDone := ct.metricStore.MeasureInFlight(req.Context(), reqContext.telemetry.metricSliceAttrs, o)
	ct.metricStore.MeasureRequestSize(req.Context(), req.ContentLength, reqContext.telemetry.metricSliceAttrs, o)

	return func(err error, resp *http.Response) {
		defer reqContext.telemetry.ReleaseAttributes(&attributes)

		inFlightDone()

		if resp != nil {
			attributes = append(attributes, semconv.HTTPStatusCode(resp.StatusCode))
			o = otelmetric.WithAttributeSet(attribute.NewSet(attributes...))

			ct.metricStore.MeasureResponseSize(req.Context(), resp.ContentLength, reqContext.telemetry.metricSliceAttrs, o)
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

	key := ct.singleFlightKey(req)
	ct.sfMu.RLock()
	item, shared := ct.sf[key]
	ct.sfMu.RUnlock()

	sfStats := resolve.GetSingleFlightStats(req.Context())
	if sfStats != nil {
		sfStats.SingleFlightUsed = true
		sfStats.SingleFlightSharedResponse = shared
	}

	if shared {
		select {
		case <-item.loaded:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}

		// If the single flight item has an error, return it immediately
		// This happens e.g. on network errors
		if item.err != nil {
			return nil, item.err
		}

		res := &http.Response{}
		res.Status = item.response.Status
		res.StatusCode = item.response.StatusCode
		res.Header = item.response.Header
		res.Trailer = item.response.Trailer
		res.ContentLength = item.response.ContentLength
		res.TransferEncoding = item.response.TransferEncoding
		res.Close = item.response.Close
		res.Uncompressed = item.response.Uncompressed
		res.Request = req

		// Restore the body
		res.Body = io.NopCloser(bytes.NewReader(item.body))
		return res, item.err
	}

	if sfStats != nil {
		sfStats.SingleFlightUsed = true
		sfStats.SingleFlightSharedResponse = false
	}

	item = &sfCacheItem{
		loaded: make(chan struct{}),
	}
	ct.sfMu.Lock()
	ct.sf[key] = item
	ct.sfMu.Unlock()
	defer func() {
		close(item.loaded)
		ct.sfMu.Lock()
		delete(ct.sf, key)
		ct.sfMu.Unlock()
	}()

	res, err := ct.roundTripper.RoundTrip(req)
	if err != nil {
		item.err = err
		return nil, err
	}

	defer res.Body.Close()

	item.body, err = io.ReadAll(res.Body)
	if err != nil {
		item.err = err
		return nil, err
	}

	item.response = res

	// Restore the body
	res.Body = io.NopCloser(bytes.NewReader(item.body))

	return res, nil
}

func (ct *CustomTransport) singleFlightKey(req *http.Request) uint64 {
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
	return sum
}

type TransportFactory struct {
	preHandlers                   []TransportPreHandler
	postHandlers                  []TransportPostHandler
	subgraphTransportOptions      *SubgraphTransportOptions
	retryOptions                  retrytransport.RetryOptions
	localhostFallbackInsideDocker bool
	metricStore                   metric.Store
	logger                        *zap.Logger
	tracerProvider                *sdktrace.TracerProvider
	tracePropagators              propagation.TextMapPropagator
	proxy                         ProxyFunc
}

var _ ApiTransportFactory = TransportFactory{}

type TransportOptions struct {
	PreHandlers                   []TransportPreHandler
	PostHandlers                  []TransportPostHandler
	SubgraphTransportOptions      *SubgraphTransportOptions
	Proxy                         ProxyFunc
	RetryOptions                  retrytransport.RetryOptions
	LocalhostFallbackInsideDocker bool
	MetricStore                   metric.Store
	Logger                        *zap.Logger
	TracerProvider                *sdktrace.TracerProvider
	TracePropagators              propagation.TextMapPropagator
}

func NewTransport(opts *TransportOptions) *TransportFactory {
	return &TransportFactory{
		preHandlers:                   opts.PreHandlers,
		postHandlers:                  opts.PostHandlers,
		retryOptions:                  opts.RetryOptions,
		subgraphTransportOptions:      opts.SubgraphTransportOptions,
		localhostFallbackInsideDocker: opts.LocalhostFallbackInsideDocker,
		metricStore:                   opts.MetricStore,
		logger:                        opts.Logger,
		tracerProvider:                opts.TracerProvider,
		proxy:                         opts.Proxy,
		tracePropagators:              opts.TracePropagators,
	}
}

func (t TransportFactory) RoundTripper(enableSingleFlight bool, baseTransport http.RoundTripper) http.RoundTripper {
	if t.subgraphTransportOptions != nil && t.subgraphTransportOptions.SubgraphMap != nil && len(t.subgraphTransportOptions.SubgraphMap) > 0 {
		baseTransport = NewTimeoutTransport(t.subgraphTransportOptions, baseTransport, t.logger, t.proxy)
	}

	if t.localhostFallbackInsideDocker && docker.Inside() {
		baseTransport = docker.NewLocalhostFallbackRoundTripper(baseTransport)
	}

	otelHttpOptions := []otelhttp.Option{
		otelhttp.WithSpanNameFormatter(SpanNameFormatter),
		otelhttp.WithSpanOptions(otrace.WithAttributes(otel.EngineTransportAttribute)),
		otelhttp.WithTracerProvider(t.tracerProvider),
	}

	if t.tracePropagators != nil {
		otelHttpOptions = append(otelHttpOptions, otelhttp.WithPropagators(t.tracePropagators))
	}

	traceTransport := trace.NewTransport(
		baseTransport,
		otelHttpOptions,
		trace.WithPreHandler(func(r *http.Request) {
			span := otrace.SpanFromContext(r.Context())
			reqContext := getRequestContext(r.Context())

			var attributes []attribute.KeyValue

			subgraph := reqContext.ActiveSubgraph(r)
			if subgraph != nil {
				attributes = append(attributes, otel.WgSubgraphID.String(subgraph.Id))
				attributes = append(attributes, otel.WgSubgraphName.String(subgraph.Name))
			}

			attributes = append(attributes, reqContext.telemetry.traceAttrs...)

			span.SetAttributes(attributes...)

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
	if t.subgraphTransportOptions != nil {
		return t.subgraphTransportOptions.RequestTimeout
	}
	return defaultTimeout
}

func (t TransportFactory) DefaultHTTPProxyURL() *url.URL {
	return nil
}

// SpanNameFormatter formats the span name based on the http request
func SpanNameFormatter(_ string, r *http.Request) string {
	requestContext := getRequestContext(r.Context())

	if requestContext != nil && requestContext.operation != nil {
		return GetSpanName(requestContext.operation.Name(), requestContext.operation.Type())
	}

	return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
}

func GetSpanName(operationName string, operationType string) string {
	if operationName != "" {
		return fmt.Sprintf("%s %s", operationType, operationName)
	}
	return fmt.Sprintf("%s %s", operationType, "unnamed")
}
