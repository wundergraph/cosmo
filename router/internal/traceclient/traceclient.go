package traceclient

import (
	"context"
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

type ClientTrace struct {
	ConnectionGet      *GetConnection
	ConnectionAcquired *AcquiredConnection
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

	if trace.ConnectionGet != nil && trace.ConnectionAcquired != nil {
		duration := trace.ConnectionAcquired.Time.Sub(trace.ConnectionGet.Time)
		exprContext.Subgraph.Request.ClientTrace.ConnectionAcquireDuration = duration

		serverAttributes := rotel.GetServerAttributes(trace.ConnectionGet.HostPort)
		serverAttributes = append(
			serverAttributes,
			rotel.WgClientReusedConnection.Bool(trace.ConnectionAcquired.Reused),
			rotel.WgSubgraphName.String(subgraph),
		)

		connAcquireTime := float64(duration) / float64(time.Millisecond)
		t.connectionMetricStore.MeasureConnectionAcquireDuration(ctx,
			connAcquireTime,
			serverAttributes...)
	}
}
