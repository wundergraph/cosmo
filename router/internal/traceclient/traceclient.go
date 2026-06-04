package traceclient

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"time"

	rcontext "github.com/wundergraph/cosmo/router/internal/context"
	"github.com/wundergraph/cosmo/router/internal/expr"

	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	otrace "go.opentelemetry.io/otel/trace"
)

const tracerName = "wundergraph/cosmo/router/traceclient"

// Child span names emitted for each httptrace phase under the subgraph HTTP
// client span.
const (
	spanDNSLookup       = "HTTP - DNS Lookup"
	spanTCPConnect      = "HTTP - TCP Connect"
	spanTLSHandshake    = "HTTP - TLS Handshake"
	spanTimeToFirstByte = "HTTP - Time To First Byte"
)

type AcquiredConnection struct {
	Time     time.Time
	IdleTime time.Duration
	Reused   bool
	WasIdle  bool
}

type GetConnection struct {
	Time     time.Time
	HostPort string
}

// phaseTimings captures start/end timestamps for httptrace phases. Only the
// timestamps actually observed are non-zero; the rest are left as the zero
// time.Time and skipped at recording time.
type phaseTimings struct {
	DNSStart     time.Time
	DNSDone      time.Time
	ConnectStart time.Time
	ConnectDone  time.Time
	TLSStart     time.Time
	TLSDone      time.Time
	WroteRequest time.Time
	FirstByte    time.Time
}

type ClientTrace struct {
	ConnectionGet      *GetConnection
	ConnectionAcquired *AcquiredConnection
	phases             phaseTimings

	// parentCtx is populated by external code (the otelhttp pre-handler) once
	// the subgraph HTTP client span is active. It is used as the parent for the
	// per-phase child spans emitted in processConnectionMetrics. When unset,
	// child spans fall back to a root context and become orphaned at the tracing
	// backend.
	parentCtx context.Context
}

// SetParentCtx records the request context whose active span should parent the
// per-phase child spans. Called by the otelhttp pre-handler.
func (c *ClientTrace) SetParentCtx(ctx context.Context) {
	c.parentCtx = ctx
}

type ClientTraceContextKey struct{}

type TraceInjectingRoundTripper struct {
	base                    http.RoundTripper
	connectionMetricStore   metric.ConnectionMetricStore
	tracerProvider          otrace.TracerProvider
	tracer                  otrace.Tracer
	emitConnectionPhaseSpan bool
	reqContextValuesGetter  func(ctx context.Context, req *http.Request) (*expr.Context, string)
}

type Options struct {
	ConnectionMetricStore   metric.ConnectionMetricStore
	TracerProvider          otrace.TracerProvider
	EmitConnectionPhaseSpan bool
	ReqContextValuesGetter  func(ctx context.Context, req *http.Request) (*expr.Context, string)
}

func NewTraceInjectingRoundTripper(
	base http.RoundTripper,
	opts Options,
) *TraceInjectingRoundTripper {
	rt := &TraceInjectingRoundTripper{
		base:                    base,
		connectionMetricStore:   opts.ConnectionMetricStore,
		tracerProvider:          opts.TracerProvider,
		emitConnectionPhaseSpan: opts.EmitConnectionPhaseSpan,
		reqContextValuesGetter:  opts.ReqContextValuesGetter,
	}
	if opts.TracerProvider != nil && opts.EmitConnectionPhaseSpan {
		rt.tracer = opts.TracerProvider.Tracer(tracerName)
	}
	return rt
}

func GetClientTraceFromContext(ctx context.Context) *ClientTrace {
	value := ctx.Value(ClientTraceContextKey{})
	// Return no-op context if the subgraph context key was never set
	if value == nil {
		return &ClientTrace{}
	}
	return value.(*ClientTrace)
}

func InitTraceContext(ctx context.Context) context.Context {
	trace := &ClientTrace{}
	ctx = context.WithValue(ctx, ClientTraceContextKey{}, trace)
	return ctx
}

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()
	ctx = InitTraceContext(ctx)

	trace := t.getClientTrace(ctx)

	req = req.WithContext(httptrace.WithClientTrace(ctx, trace))
	trip, err := t.base.RoundTrip(req)

	t.processConnectionMetrics(ctx, req)

	return trip, err
}

func (t *TraceInjectingRoundTripper) getClientTrace(ctx context.Context) *httptrace.ClientTrace {
	eC := GetClientTraceFromContext(ctx)

	trace := &httptrace.ClientTrace{
		GetConn: func(hostPort string) {
			eC.ConnectionGet = &GetConnection{
				Time:     time.Now(),
				HostPort: hostPort,
			}
		},
		GotConn: func(info httptrace.GotConnInfo) {
			eC.ConnectionAcquired = &AcquiredConnection{
				Time:     time.Now(),
				Reused:   info.Reused,
				WasIdle:  info.WasIdle,
				IdleTime: info.IdleTime,
			}
		},
		DNSStart: func(_ httptrace.DNSStartInfo) {
			eC.phases.DNSStart = time.Now()
		},
		DNSDone: func(_ httptrace.DNSDoneInfo) {
			eC.phases.DNSDone = time.Now()
		},
		ConnectStart: func(_, _ string) {
			eC.phases.ConnectStart = time.Now()
		},
		ConnectDone: func(_, _ string, _ error) {
			eC.phases.ConnectDone = time.Now()
		},
		TLSHandshakeStart: func() {
			eC.phases.TLSStart = time.Now()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			eC.phases.TLSDone = time.Now()
		},
		WroteRequest: func(_ httptrace.WroteRequestInfo) {
			eC.phases.WroteRequest = time.Now()
		},
		GotFirstResponseByte: func() {
			eC.phases.FirstByte = time.Now()
		},
	}
	return trace
}

func (t *TraceInjectingRoundTripper) processConnectionMetrics(ctx context.Context, req *http.Request) {
	trace := GetClientTraceFromContext(ctx)

	var subgraph string
	subgraphCtxVal := ctx.Value(rcontext.CurrentSubgraphContextKey{})
	if subgraphCtxVal != nil {
		subgraph = subgraphCtxVal.(string)
	}

	// We have a fallback for active subgraph name in case engine loader hooks is not called
	// TODO: Evaluate if we actually need a fallback and if we can use only one way to get the active subgraph name
	exprContext, activeSubgraphName := t.reqContextValuesGetter(ctx, req)
	if subgraph == "" {
		subgraph = activeSubgraphName
	}

	if trace.ConnectionGet == nil {
		return
	}

	serverAttributes := rotel.GetServerAttributes(trace.ConnectionGet.HostPort)
	reused := trace.ConnectionAcquired != nil && trace.ConnectionAcquired.Reused
	serverAttributes = append(
		serverAttributes,
		rotel.WgClientReusedConnection.Bool(reused),
		rotel.WgSubgraphName.String(subgraph),
	)

	if trace.ConnectionAcquired != nil {
		duration := trace.ConnectionAcquired.Time.Sub(trace.ConnectionGet.Time)
		exprContext.Subgraph.Request.ClientTrace.ConnectionAcquireDuration = duration
		t.connectionMetricStore.MeasureConnectionAcquireDuration(
			ctx,
			float64(duration)/float64(time.Millisecond),
			serverAttributes...,
		)
	}

	// Per-phase httptrace metrics. The ConnectionMetricStore method is a no-op
	// when network metrics are disabled, so unconditionally calling these is
	// cheap on the disabled path.
	if !trace.phases.DNSStart.IsZero() && !trace.phases.DNSDone.IsZero() {
		dur := trace.phases.DNSDone.Sub(trace.phases.DNSStart)
		exprContext.Subgraph.Request.ClientTrace.DNSLookupDuration = dur
		t.connectionMetricStore.MeasureDNSLookupDuration(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}
	if !trace.phases.ConnectStart.IsZero() && !trace.phases.ConnectDone.IsZero() {
		dur := trace.phases.ConnectDone.Sub(trace.phases.ConnectStart)
		exprContext.Subgraph.Request.ClientTrace.TCPConnectDuration = dur
		t.connectionMetricStore.MeasureTCPConnectDuration(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}
	if !trace.phases.TLSStart.IsZero() && !trace.phases.TLSDone.IsZero() {
		dur := trace.phases.TLSDone.Sub(trace.phases.TLSStart)
		exprContext.Subgraph.Request.ClientTrace.TLSHandshakeDuration = dur
		t.connectionMetricStore.MeasureTLSHandshakeDuration(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}
	if !trace.phases.WroteRequest.IsZero() && !trace.phases.FirstByte.IsZero() {
		dur := trace.phases.FirstByte.Sub(trace.phases.WroteRequest)
		exprContext.Subgraph.Request.ClientTrace.TimeToFirstByte = dur
		t.connectionMetricStore.MeasureTimeToFirstByte(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}

	t.emitPhaseSpans(trace, serverAttributes)
}

// emitPhaseSpans emits one retroactive child span per observed httptrace phase
// under the active subgraph HTTP client span. Each span uses the recorded
// start/end timestamps so it appears at the correct point on the timeline at
// the tracing backend. Phases with missing endpoints are skipped.
func (t *TraceInjectingRoundTripper) emitPhaseSpans(trace *ClientTrace, attrs []attribute.KeyValue) {
	if t.tracer == nil || trace.parentCtx == nil {
		return
	}

	spanAttrs := otrace.WithAttributes(attrs...)

	emit := func(name string, start, end time.Time) {
		if start.IsZero() || end.IsZero() || !end.After(start) {
			return
		}
		_, span := t.tracer.Start(
			trace.parentCtx,
			name,
			otrace.WithSpanKind(otrace.SpanKindInternal),
			otrace.WithTimestamp(start),
			spanAttrs,
		)
		span.End(otrace.WithTimestamp(end))
	}

	emit(spanDNSLookup, trace.phases.DNSStart, trace.phases.DNSDone)
	emit(spanTCPConnect, trace.phases.ConnectStart, trace.phases.ConnectDone)
	emit(spanTLSHandshake, trace.phases.TLSStart, trace.phases.TLSDone)
	emit(spanTimeToFirstByte, trace.phases.WroteRequest, trace.phases.FirstByte)
}

func msFromDuration(d time.Duration) float64 {
	return float64(d) / float64(time.Millisecond)
}
