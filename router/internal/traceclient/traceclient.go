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
}

type ClientTraceContextKey struct{}

type TraceInjectingRoundTripper struct {
	base                   http.RoundTripper
	connectionMetricStore  metric.ConnectionMetricStore
	reqContextValuesGetter func(ctx context.Context, req *http.Request) (*expr.Context, string)
}

func NewTraceInjectingRoundTripper(
	base http.RoundTripper,
	connectionMetricStore metric.ConnectionMetricStore,
	reqContextValuesGetter func(ctx context.Context, req *http.Request) (*expr.Context, string),
) *TraceInjectingRoundTripper {
	return &TraceInjectingRoundTripper{
		base:                   base,
		connectionMetricStore:  connectionMetricStore,
		reqContextValuesGetter: reqContextValuesGetter,
	}
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
}

func msFromDuration(d time.Duration) float64 {
	return float64(d) / float64(time.Millisecond)
}
