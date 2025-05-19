package httpclient

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"net/http"
	"net/http/httptrace"
	"time"
)

type ClientTraceContextKey struct{}

type TraceInjectingRoundTripper struct {
	base                  http.RoundTripper
	connectionMetricStore metric.ConnectionMetricStore
}

func NewTraceInjectingRoundTripper(base http.RoundTripper, connectionMetricStore metric.ConnectionMetricStore) *TraceInjectingRoundTripper {
	return &TraceInjectingRoundTripper{
		base:                  base,
		connectionMetricStore: connectionMetricStore,
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

func initTraceContext(ctx context.Context) context.Context {
	trace := &ClientTrace{}
	ctx = context.WithValue(ctx, ClientTraceContextKey{}, trace)
	return ctx
}

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()
	ctx = initTraceContext(ctx)

	trace := t.getClientTrace(ctx)

	req = req.WithContext(httptrace.WithClientTrace(ctx, trace))
	trip, err := t.base.RoundTrip(req)

	CalculateConnectionMetrics(ctx, t.connectionMetricStore)

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
		DNSStart:             nil,
		DNSDone:              nil,
		ConnectStart:         nil,
		ConnectDone:          nil,
		TLSHandshakeStart:    nil,
		TLSHandshakeDone:     nil,
		GotFirstResponseByte: nil,
		WroteHeaders:         nil,
		WroteRequest:         nil,
		PutIdleConn:          nil,
		Got100Continue:       nil,
		Got1xxResponse:       nil,
		WroteHeaderField:     nil,
		Wait100Continue:      nil,
	}
	return trace
}

func CalculateConnectionMetrics(ctx context.Context, store metric.ConnectionMetricStore) {
	if store == nil {
		return
	}

	trace := GetClientTraceFromContext(ctx)

	if trace.ConnectionGet != nil && trace.ConnectionAcquired != nil {
		connAcquireTime := trace.ConnectionAcquired.Time.Sub(trace.ConnectionGet.Time).Seconds()
		store.MeasureTotalConnectionDuration(ctx,
			connAcquireTime,
			rotel.WgConnReused.Bool(trace.ConnectionAcquired.Reused),
			rotel.WgHost.String(trace.ConnectionGet.HostPort))
	}
}
