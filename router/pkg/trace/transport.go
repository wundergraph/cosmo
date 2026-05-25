package trace

import (
	gocontext "context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/internal/context"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	otrace "go.opentelemetry.io/otel/trace"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/codes"
)

type TransportOption func(svr *transport)

const transportTracerName = "wundergraph/cosmo/router/engine/transport"

// NewTransport wraps the provided http.RoundTripper. Internally it uses otelhttp.NewTransport to instrument the request.
func NewTransport(base http.RoundTripper, otelHttpOptions []otelhttp.Option, options ...TransportOption) http.RoundTripper {
	transport := &transport{
		rt: base,
	}

	for _, opt := range options {
		opt(transport)
	}

	otelHttpOptions = append(otelHttpOptions, otelhttp.WithFilter(CommonRequestFilter))

	return otelhttp.NewTransport(
		transport, otelHttpOptions...,
	)
}

type transport struct {
	rt                       http.RoundTripper
	handler                  func(r *http.Request)
	emitResponseBodyReadSpan bool
}

func (t *transport) RoundTrip(r *http.Request) (*http.Response, error) {

	if t.handler != nil {
		t.handler(r)
	}

	startTime := time.Now()

	// otelhttp v0.67.0 no longer emits http.request_content_length on client spans.
	// Set it here for backward compatibility with downstream systems.
	if r.ContentLength > 0 {
		span := otrace.SpanFromContext(r.Context())
		span.SetAttributes(semconv.HTTPRequestContentLength(int(r.ContentLength)))
	}

	res, err := t.rt.RoundTrip(r)
	transportEnd := time.Now()

	if value := r.Context().Value(context.FetchTimingKey); value != nil {
		if fetchTiming, ok := value.(interface{ Add(int64) int64 }); ok {
			fetchTiming.Add(int64(transportEnd.Sub(startTime)))
		}
	}

	fetchTraceTimings, _ := r.Context().Value(context.FetchTraceTimingsKey).(*context.FetchTraceTimings)
	if fetchTraceTimings != nil {
		fetchTraceTimings.TransportEndUnixNano.Store(transportEnd.UnixNano())
	}

	// otelhttp v0.67.0 no longer emits http.response_content_length on client spans.
	// Set it here for backward compatibility with downstream systems.
	if res != nil && res.ContentLength > 0 {
		span := otrace.SpanFromContext(r.Context())
		span.SetAttributes(semconv.HTTPResponseContentLength(int(res.ContentLength)))
	}

	if t.emitResponseBodyReadSpan && res != nil && res.Body != nil {
		res.Body = newResponseBodyReadSpanCloser(r.Context(), res, fetchTraceTimings)
	}

	// In case of a roundtrip error the span status is set to error by the otelhttp.RoundTrip function.
	// Also, status code >= 500 is considered an error.
	// Client disconnections (context.Canceled) are not server-side errors. Pre-set the span
	// status to Ok so that otelhttp cannot override it with Error (per OTel spec, Ok is final).
	if err != nil && errors.Is(err, gocontext.Canceled) {
		span := otrace.SpanFromContext(r.Context())
		span.SetStatus(codes.Ok, "client disconnected")
	}

	return res, err
}

// WithPreHandler allows to set a pre handler function that is called before the request is sent.
func WithPreHandler(handler func(r *http.Request)) TransportOption {
	return func(svr *transport) {
		svr.handler = handler
	}
}

// WithResponseBodyReadSpan emits a child span covering response body reads after
// the HTTP transport has returned response headers.
func WithResponseBodyReadSpan() TransportOption {
	return func(svr *transport) {
		svr.emitResponseBodyReadSpan = true
	}
}

type responseBodyReadSpanCloser struct {
	body    io.ReadCloser
	tracer  otrace.Tracer
	ctx     gocontext.Context
	attrs   []attribute.KeyValue
	timings *context.FetchTraceTimings

	span      otrace.Span
	startOnce sync.Once
	endOnce   sync.Once
}

func newResponseBodyReadSpanCloser(ctx gocontext.Context, res *http.Response, timings *context.FetchTraceTimings) io.ReadCloser {
	parentCtx := ctx
	if timings != nil && timings.ParentContext != nil {
		parentCtx = timings.ParentContext
	}

	attrs := []attribute.KeyValue{
		rotel.EngineTransportAttribute,
	}
	if res.StatusCode > 0 {
		attrs = append(attrs, semconv.HTTPStatusCode(res.StatusCode))
	}
	if res.ContentLength > 0 {
		attrs = append(attrs, semconv.HTTPResponseContentLength(int(res.ContentLength)))
	}
	if timings != nil {
		if timings.SubgraphID != "" {
			attrs = append(attrs, rotel.WgSubgraphID.String(timings.SubgraphID))
		}
		if timings.SubgraphName != "" {
			attrs = append(attrs, rotel.WgSubgraphName.String(timings.SubgraphName))
		}
	}

	return &responseBodyReadSpanCloser{
		body:    res.Body,
		tracer:  otrace.SpanFromContext(parentCtx).TracerProvider().Tracer(transportTracerName),
		ctx:     parentCtx,
		attrs:   attrs,
		timings: timings,
	}
}

func (r *responseBodyReadSpanCloser) Read(p []byte) (int, error) {
	r.start()
	n, err := r.body.Read(p)
	if err != nil {
		r.end()
	}
	return n, err
}

func (r *responseBodyReadSpanCloser) Close() error {
	r.end()
	return r.body.Close()
}

func (r *responseBodyReadSpanCloser) start() {
	r.startOnce.Do(func() {
		start := time.Now()
		if r.timings != nil {
			r.timings.ResponseBodyReadStartUnixNano.CompareAndSwap(0, start.UnixNano())
		}
		_, r.span = r.tracer.Start(
			r.ctx,
			"HTTP - Read Response Body",
			otrace.WithSpanKind(otrace.SpanKindInternal),
			otrace.WithTimestamp(start),
			otrace.WithAttributes(r.attrs...),
		)
	})
}

func (r *responseBodyReadSpanCloser) end() {
	r.endOnce.Do(func() {
		if r.span == nil {
			return
		}
		end := time.Now()
		if r.timings != nil {
			r.timings.ResponseBodyReadEndUnixNano.Store(end.UnixNano())
		}
		r.span.End(otrace.WithTimestamp(end))
	})
}
