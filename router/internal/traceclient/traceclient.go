package traceclient

import (
	"context"
	"crypto/tls"
	"io"
	"mime"
	"net/http"
	"net/http/httptrace"
	"strings"
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
	TimeToLastRequestByte  time.Duration
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
	attemptFirstByte   time.Time
	wroteRequest       time.Time
	gotFirstRespByte   time.Time

	timeToLastRequestByteObserver func(time.Duration)

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
			// GetConn starts a new transport attempt. Keep wroteFirstByte for the
			// existing time-to-first-request-byte metric, but reset the
			// first-to-last request span so retries never pair timestamps from
			// different attempts.
			c.attemptFirstByte = time.Time{}
			c.wroteRequest = time.Time{}
			c.durations.TimeToLastRequestByte = 0
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
			now := time.Now()
			if c.attemptFirstByte.IsZero() {
				c.attemptFirstByte = now
			}
			// Only the first header field marks the first request byte written
			if !c.wroteFirstByte.IsZero() {
				return
			}
			c.wroteFirstByte = now
			if c.ConnectionGet != nil && c.wroteFirstByte.After(c.ConnectionGet.Time) {
				c.durations.TimeToFirstRequestByte = c.wroteFirstByte.Sub(c.ConnectionGet.Time)
			}
		},
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			c.mu.Lock()
			if info.Err != nil {
				c.mu.Unlock()
				return
			}

			c.wroteRequest = time.Now()
			var duration time.Duration
			if !c.attemptFirstByte.IsZero() && c.wroteRequest.After(c.attemptFirstByte) {
				duration = c.wroteRequest.Sub(c.attemptFirstByte)
				c.durations.TimeToLastRequestByte = duration
			}
			observer := c.timeToLastRequestByteObserver
			c.timeToLastRequestByteObserver = nil
			c.mu.Unlock()

			if observer != nil && duration > 0 {
				observer(duration)
			}
		},
		GotFirstResponseByte: func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			now := time.Now()
			c.gotFirstRespByte = now
			if !c.wroteRequest.IsZero() && now.After(c.wroteRequest) {
				c.durations.TimeToFirstByte = now.Sub(c.wroteRequest)
			}
		},
	}
}

// snapshot returns a consistent view of the observed state. The transport's
// write loop can still fire callbacks concurrently with (and after) RoundTrip
// returning, so readers must not access the fields directly. gotFirstRespByte
// is the baseline for the first-to-last response-byte measurement, which can
// only be completed once the response body is fully consumed.
func (c *ClientTrace) snapshot() (*GetConnection, *AcquiredConnection, time.Time, phaseDurations) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ConnectionGet, c.ConnectionAcquired, c.gotFirstRespByte, c.durations
}

// observeTimeToLastRequestByte either returns an already-completed request
// transfer span or installs an observer for a successful WroteRequest callback
// that arrives after RoundTrip returns.
func (c *ClientTrace) observeTimeToLastRequestByte(observer func(time.Duration)) time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.durations.TimeToLastRequestByte > 0 {
		return c.durations.TimeToLastRequestByte
	}
	c.timeToLastRequestByteObserver = observer
	return 0
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

	recorder := t.processConnectionMetrics(req.Context(), req, ec)

	// httptrace has no "last response byte" callback: the last byte is only
	// observable once the caller has fully consumed the response body. Wrap
	// finite response bodies so the first-to-last-byte span is recorded on a
	// clean EOF (or after the declared Content-Length has been read).
	// This is always before the subgraph access log is written, because the
	// engine fully reads and closes the body during the fetch load phase, which
	// completes before the log is emitted.
	if recorder != nil {
		switch {
		case err != nil || !shouldMeasureResponseTransfer(trip):
			// Upgraded and streaming responses are intentionally excluded. In
			// particular, leaving HTTP 101 bodies untouched preserves their
			// io.ReadWriteCloser contract for WebSocket clients.
			recorder.cancel()
		case responseHasNoBody(req, trip):
			// RoundTrip returns after the response headers are read. For HEAD
			// and other responses that cannot carry a body, that is also the
			// point at which the last response byte has been consumed.
			recorder.fire()
		default:
			trip.Body = &timedResponseBody{
				ReadCloser:    trip.Body,
				recorder:      recorder,
				contentLength: trip.ContentLength,
			}
		}
	}

	return trip, err
}

func shouldMeasureResponseTransfer(resp *http.Response) bool {
	if resp == nil || resp.Body == nil || resp.StatusCode == http.StatusSwitchingProtocols {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err == nil && strings.EqualFold(mediaType, "text/event-stream") {
		return false
	}
	return true
}

func responseHasNoBody(req *http.Request, resp *http.Response) bool {
	if req.Method == http.MethodHead || resp.Body == http.NoBody || resp.ContentLength == 0 {
		return true
	}
	return resp.StatusCode >= 100 && resp.StatusCode <= 199 ||
		resp.StatusCode == http.StatusNoContent ||
		resp.StatusCode == http.StatusNotModified
}

// requestByteRecorder keeps request-write completion independent from response
// completion. A successful WroteRequest callback can arrive after RoundTrip
// returns, including after an early response. Metrics still record that valid
// request span. Per-fetch expression results stop accepting updates when the
// response finishes so OnFinished can read them without racing a late callback.
type requestByteRecorder struct {
	mu           sync.Mutex
	recorded     bool
	resultsOpen  bool
	results      *expr.ClientTrace
	recordMetric func(time.Duration)
}

func (r *requestByteRecorder) record(duration time.Duration) {
	if r == nil || duration <= 0 {
		return
	}

	r.mu.Lock()
	if r.recorded {
		r.mu.Unlock()
		return
	}
	r.recorded = true
	if r.resultsOpen {
		r.results.TimeToLastRequestByte = duration
	}
	r.mu.Unlock()

	r.recordMetric(duration)
}

// closeResults records a request completion already visible in the trace, then
// prevents later callbacks from mutating the expression result. The observer
// remains installed so a later successful WroteRequest can still emit a metric.
func (r *requestByteRecorder) closeResults(duration time.Duration) {
	if r == nil {
		return
	}

	var recordMetric bool
	r.mu.Lock()
	if !r.recorded && duration > 0 {
		r.recorded = true
		if r.resultsOpen {
			r.results.TimeToLastRequestByte = duration
		}
		recordMetric = true
	}
	r.resultsOpen = false
	r.mu.Unlock()

	if recordMetric {
		r.recordMetric(duration)
	}
}

// lastByteRecorder coordinates a request-write callback that may arrive after
// RoundTrip returns with response-body completion.
type lastByteRecorder struct {
	mu             sync.Mutex
	done           bool
	trace          *ClientTrace
	request        *requestByteRecorder
	recordResponse func(time.Duration)
}

func (r *lastByteRecorder) fire() {
	if r == nil {
		return
	}
	_, _, firstResponseByte, durations := r.trace.snapshot()
	r.request.closeResults(durations.TimeToLastRequestByte)

	r.mu.Lock()
	if r.done {
		r.mu.Unlock()
		return
	}
	r.done = true
	if !firstResponseByte.IsZero() {
		if duration := time.Since(firstResponseByte); duration > 0 {
			r.recordResponse(duration)
		}
	}
	r.mu.Unlock()
}

func (r *lastByteRecorder) cancel() {
	if r == nil {
		return
	}
	_, _, _, durations := r.trace.snapshot()
	r.request.closeResults(durations.TimeToLastRequestByte)

	r.mu.Lock()
	r.done = true
	r.mu.Unlock()
}

// timedResponseBody records completion only after the full response body is
// consumed. Close by itself is cancellation, not evidence that the last byte
// was received.
type timedResponseBody struct {
	io.ReadCloser
	recorder      *lastByteRecorder
	contentLength int64
	bytesRead     int64
}

func (b *timedResponseBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.bytesRead += int64(n)

	complete := false
	switch {
	case err == io.EOF:
		// A short EOF on a response with an explicit Content-Length is a
		// truncated response, not a successfully observed last byte.
		complete = b.contentLength < 0 || b.bytesRead >= b.contentLength
	case err == nil && b.contentLength > 0 && b.bytesRead >= b.contentLength:
		// Some readers return the final bytes with a nil error and expect no
		// subsequent read. Content-Length lets us recognize completion there.
		complete = true
	}
	if complete {
		b.recorder.fire()
	}
	return n, err
}

func (b *timedResponseBody) Close() error {
	err := b.ReadCloser.Close()
	b.recorder.cancel()
	return err
}

// processConnectionMetrics records the connection and per-attempt request-phase
// metrics that are already observable when RoundTrip returns. It returns a
// recorder for the time-to-last-byte metric, which can only be measured once
// the response body has been consumed, or nil when there is nothing to record.
func (t *TraceInjectingRoundTripper) processConnectionMetrics(ctx context.Context, req *http.Request, trace *ClientTrace) *lastByteRecorder {
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
		return nil
	}

	results := ClientTraceResultsFromContext(ctx)

	if results == nil {
		return nil
	}

	connectionGet, connectionAcquired, _, durations := trace.snapshot()

	// The transport can fail before it ever asks the pool for a connection,
	// in which case no phase was observed and there is nothing to record.
	if connectionGet == nil {
		return nil
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

	lastByteMetricStore, _ := t.connectionMetricStore.(metric.LastByteMetricStore)
	requestRecorder := &requestByteRecorder{
		resultsOpen: true,
		results:     results,
		recordMetric: func(duration time.Duration) {
			if lastByteMetricStore != nil {
				lastByteMetricStore.MeasureTimeToLastRequestByte(
					ctx,
					msFromDuration(duration),
					serverAttributes...,
				)
			}
		},
	}
	recorder := &lastByteRecorder{
		trace:   trace,
		request: requestRecorder,
		recordResponse: func(duration time.Duration) {
			results.TimeToLastByte = duration
			if lastByteMetricStore != nil {
				lastByteMetricStore.MeasureTimeToLastByte(
					ctx,
					msFromDuration(duration),
					serverAttributes...,
				)
			}
		},
	}

	if duration := trace.observeTimeToLastRequestByte(requestRecorder.record); duration > 0 {
		requestRecorder.record(duration)
	}

	return recorder
}

func msFromDuration(d time.Duration) float64 {
	return float64(d) / float64(time.Millisecond)
}
