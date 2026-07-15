package traceclient

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"sync"
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

// phaseDurations captures the durations of the httptrace phases observed
// during a single HTTP attempt
type phaseDurations struct {
	DNSLookup              time.Duration
	TCPConnect             time.Duration
	TLSHandshake           time.Duration
	TimeToFirstRequestByte time.Duration
	TimeToFirstByte        time.Duration
}

type ClientTrace struct {
	mu                 sync.Mutex
	ConnectionGet      *GetConnection
	ConnectionAcquired *AcquiredConnection
	dnsStart           time.Time
	connectStart       map[string]time.Time
	tlsStart           time.Time
	wroteFirstByte     time.Time
	wroteRequest       time.Time

	durations phaseDurations
}

func (c *ClientTrace) HttpClientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		GetConn: func(hostPort string) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.ConnectionGet = &GetConnection{
				Time:     time.Now(),
				HostPort: hostPort,
			}
		},
		GotConn: func(info httptrace.GotConnInfo) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.ConnectionAcquired = &AcquiredConnection{
				Time:     time.Now(),
				Reused:   info.Reused,
				WasIdle:  info.WasIdle,
				IdleTime: info.IdleTime,
			}
		},
		DNSStart: func(_ httptrace.DNSStartInfo) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.dnsStart = time.Now()
		},
		DNSDone: func(_ httptrace.DNSDoneInfo) {
			c.mu.Lock()
			defer c.mu.Unlock()
			now := time.Now()
			if !c.dnsStart.IsZero() && now.After(c.dnsStart) {
				c.durations.DNSLookup = now.Sub(c.dnsStart)
			}
		},
		ConnectStart: func(network, addr string) {
			c.mu.Lock()
			defer c.mu.Unlock()
			// connectStart is keyed by network+address, because it can be called multiple time
			// e.g. IPv6 (https://github.com/golang/go/blob/go1.26.5/src/net/dial.go#L160)
			if c.connectStart == nil {
				c.connectStart = make(map[string]time.Time)
			}
			c.connectStart[network+"|"+addr] = time.Now()
		},
		ConnectDone: func(network, addr string, err error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			now := time.Now()
			start, ok := c.connectStart[network+"|"+addr]
			if ok && now.After(start) {
				// could be called multiple times
				// e.g. IPv6 (https://github.com/golang/go/blob/go1.26.5/src/net/dial.go#L160)
				c.durations.TCPConnect = c.durations.TCPConnect + now.Sub(start)
			}
		},
		TLSHandshakeStart: func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.tlsStart = time.Now()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, err error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			now := time.Now()
			if !c.tlsStart.IsZero() && now.After(c.tlsStart) {
				c.durations.TLSHandshake = now.Sub(c.tlsStart)
			}
		},
		WroteHeaderField: func(_ string, _ []string) {
			c.mu.Lock()
			defer c.mu.Unlock()
			// Only the first header field marks the first request byte written
			if !c.wroteFirstByte.IsZero() {
				return
			}
			c.wroteFirstByte = time.Now()
			if c.ConnectionGet != nil && c.wroteFirstByte.After(c.ConnectionGet.Time) {
				c.durations.TimeToFirstRequestByte = c.wroteFirstByte.Sub(c.ConnectionGet.Time)
			}
		},
		WroteRequest: func(_ httptrace.WroteRequestInfo) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.wroteRequest = time.Now()
		},
		GotFirstResponseByte: func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			now := time.Now()
			if !c.wroteRequest.IsZero() && now.After(c.wroteRequest) {
				c.durations.TimeToFirstByte = now.Sub(c.wroteRequest)
			}
		},
	}
}

// snapshot returns a consistent view of the observed state. The transport's
// write loop can still fire callbacks concurrently with (and after) RoundTrip
// returning, so readers must not access the fields directly. Phases that
// complete after the snapshot are not recorded.
func (c *ClientTrace) snapshot() (*GetConnection, *AcquiredConnection, phaseDurations) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ConnectionGet, c.ConnectionAcquired, c.durations
}

func NewClientTrace() *ClientTrace {
	return &ClientTrace{
		durations: phaseDurations{},
	}
}

type clientTraceResultsContextKey struct{}

// WithClientTraceResults returns a context carrying a fresh per-fetch results
// container.
func WithClientTraceResults(ctx context.Context) context.Context {
	return context.WithValue(ctx, clientTraceResultsContextKey{}, &expr.ClientTrace{})
}

// ClientTraceResultsFromContext returns the current fetch's results container
func ClientTraceResultsFromContext(ctx context.Context) *expr.ClientTrace {
	value, _ := ctx.Value(clientTraceResultsContextKey{}).(*expr.ClientTrace)
	return value
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

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ec := NewClientTrace()
	ctx := req.Context()
	if ClientTraceResultsFromContext(req.Context()) == nil {
		// if there is no trace results in the context, it means we are not inside a engine
		// load and we can add the result directly here
		ctx = WithClientTraceResults(ctx)
	}
	req = req.WithContext(httptrace.WithClientTrace(ctx, ec.HttpClientTrace()))
	trip, err := t.base.RoundTrip(req)

	t.processConnectionMetrics(req.Context(), req, ec)

	return trip, err
}

func (t *TraceInjectingRoundTripper) processConnectionMetrics(ctx context.Context, req *http.Request, trace *ClientTrace) {
	var subgraph string
	subgraphCtxVal := ctx.Value(rcontext.CurrentSubgraphContextKey{})
	if subgraphCtxVal != nil {
		subgraph = subgraphCtxVal.(string)
	}

	// We have a fallback for active subgraph name in case engine loader hooks is not called
	// TODO: Evaluate if we actually need a fallback and if we can use only one way to get the active subgraph name
	_, activeSubgraphName := t.reqContextValuesGetter(ctx, req)
	if subgraph == "" {
		subgraph = activeSubgraphName
	}

	if trace == nil {
		return
	}

	results := ClientTraceResultsFromContext(ctx)

	if results == nil {
		return
	}

	connectionGet, connectionAcquired, durations := trace.snapshot()

	// The transport can fail before it ever asks the pool for a connection,
	// in which case no phase was observed and there is nothing to record.
	if connectionGet == nil {
		return
	}

	serverAttributes := rotel.GetServerAttributes(connectionGet.HostPort)
	reused := connectionAcquired != nil && connectionAcquired.Reused
	serverAttributes = append(
		serverAttributes,
		rotel.WgClientReusedConnection.Bool(reused),
		rotel.WgSubgraphName.String(subgraph),
	)

	if connectionAcquired != nil {
		if duration := connectionAcquired.Time.Sub(connectionGet.Time); duration >= 0 {
			results.ConnectionAcquireDuration = duration
			t.connectionMetricStore.MeasureConnectionAcquireDuration(
				ctx,
				msFromDuration(duration),
				serverAttributes...,
			)
		}
	}

	if dur := durations.DNSLookup; dur > 0 {
		results.DNSLookupDuration = dur
		t.connectionMetricStore.MeasureDNSLookupDuration(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}
	if dur := durations.TCPConnect; dur > 0 {
		results.TCPConnectDuration = dur
		t.connectionMetricStore.MeasureTCPConnectDuration(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}
	if dur := durations.TLSHandshake; dur > 0 {
		results.TLSHandshakeDuration = dur
		t.connectionMetricStore.MeasureTLSHandshakeDuration(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}

	if dur := durations.TimeToFirstRequestByte; dur > 0 {
		results.TimeToFirstRequestByte = dur
		t.connectionMetricStore.MeasureTimeToFirstRequestByte(
			ctx,
			msFromDuration(dur),
			serverAttributes...,
		)
	}

	if dur := durations.TimeToFirstByte; dur > 0 {
		results.TimeToFirstByte = dur
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
