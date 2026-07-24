package traceclient

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/metric"
)

// writeLoopRoundTripper mimics net/http: connection hooks fire on the request
// goroutine, but WroteRequest / GotFirstResponseByte fire on a separate goroutine
// with no happens-before edge back to the caller of RoundTrip.
type writeLoopRoundTripper struct {
	wg *sync.WaitGroup
}

func (rt *writeLoopRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ct := httptrace.ContextClientTrace(req.Context())

	// Set ConnectionGet so processConnectionMetrics gets past its early return.
	ct.GetConn("subgraph.local:443")
	ct.GotConn(httptrace.GotConnInfo{})

	rt.wg.Go(func() {
		ct.WroteHeaderField("Content-Type", []string{"application/json"})
		ct.WroteRequest(httptrace.WroteRequestInfo{})
		ct.GotFirstResponseByte()
	})

	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       http.NoBody,
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

// hookFiringRoundTripper fires an arbitrary sequence of httptrace hooks,
// simulating the orderings net/http can produce (retries, background dials,
// happy-eyeballs).
type hookFiringRoundTripper struct {
	fire func(ct *httptrace.ClientTrace)
}

func (rt *hookFiringRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.fire(httptrace.ContextClientTrace(req.Context()))
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       http.NoBody,
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

// bodyReturningRoundTripper fires a hook sequence and then returns a response
// whose body is the given reader, so the time-to-last-byte measurement (which
// is only observable once the body is read) can be exercised.
type bodyReturningRoundTripper struct {
	fire          func(ct *httptrace.ClientTrace)
	body          io.ReadCloser
	statusCode    int
	header        http.Header
	contentLength int64
}

func (rt *bodyReturningRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.fire(httptrace.ContextClientTrace(req.Context()))
	statusCode := rt.statusCode
	if statusCode == 0 {
		statusCode = http.StatusOK
	}
	header := rt.header
	if header == nil {
		header = make(http.Header)
	}
	return &http.Response{
		StatusCode:    statusCode,
		Body:          rt.body,
		Header:        header,
		ContentLength: rt.contentLength,
		Request:       req,
	}, nil
}

// pacedBody yields its content one chunk per read, sleeping before each, so the
// time-to-last-byte window grows measurably as the body is consumed.
type pacedBody struct {
	chunks [][]byte
	delay  time.Duration
	i      int
	closed bool
}

func (b *pacedBody) Read(p []byte) (int, error) {
	if b.i >= len(b.chunks) {
		return 0, io.EOF
	}
	time.Sleep(b.delay)
	n := copy(p, b.chunks[b.i])
	b.i++
	return n, nil
}

func (b *pacedBody) Close() error {
	b.closed = true
	return nil
}

type failingBody struct {
	read   bool
	closed bool
}

func (b *failingBody) Read(p []byte) (int, error) {
	if !b.read {
		b.read = true
		return copy(p, "partial"), nil
	}
	return 0, errors.New("response body read failed")
}

func (b *failingBody) Close() error {
	b.closed = true
	return nil
}

type readWriteBody struct {
	*pacedBody
}

func (b *readWriteBody) Write(p []byte) (int, error) {
	return len(p), nil
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

// recordingConnectionMetricStore counts how many times each measurement is
// recorded and keeps the last recorded value in milliseconds.
type recordingConnectionMetricStore struct {
	acquire, dns, tcp, tls, reqFirstByte, reqLastByte, ttfb, ttlb int

	dnsMs, tcpMs, reqLastByteMs float64
}

func (s *recordingConnectionMetricStore) MeasureConnectionAcquireDuration(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.acquire++
}
func (s *recordingConnectionMetricStore) MeasureDNSLookupDuration(_ context.Context, value float64, _ ...attribute.KeyValue) {
	s.dns++
	s.dnsMs = value
}
func (s *recordingConnectionMetricStore) MeasureTCPConnectDuration(_ context.Context, value float64, _ ...attribute.KeyValue) {
	s.tcp++
	s.tcpMs = value
}
func (s *recordingConnectionMetricStore) MeasureTLSHandshakeDuration(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.tls++
}
func (s *recordingConnectionMetricStore) MeasureTimeToFirstRequestByte(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.reqFirstByte++
}
func (s *recordingConnectionMetricStore) MeasureTimeToLastRequestByte(_ context.Context, value float64, _ ...attribute.KeyValue) {
	s.reqLastByte++
	s.reqLastByteMs = value
}
func (s *recordingConnectionMetricStore) MeasureTimeToFirstByte(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.ttfb++
}
func (s *recordingConnectionMetricStore) MeasureTimeToLastByte(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.ttlb++
}
func (s *recordingConnectionMetricStore) Shutdown(_ context.Context) error { return nil }

// roundTripThroughHooks runs a request whose context optionally carries a fresh
// results container (withContainer) through a TraceInjectingRoundTripper backed
// by the given hook sequence, and returns the container content (zero when
// withContainer is false), the expression context returned by the values
// getter, and the recorded metrics.
func roundTripThroughHooks(t *testing.T, withContainer bool, fire func(ct *httptrace.ClientTrace)) (expr.ClientTrace, *expr.Context, *recordingConnectionMetricStore) {
	t.Helper()

	store := &recordingConnectionMetricStore{}
	exprCtx := &expr.Context{}
	rt := NewTraceInjectingRoundTripper(
		&hookFiringRoundTripper{fire: fire},
		store,
		func(ctx context.Context, req *http.Request) (*expr.Context, string) {
			return exprCtx, "employees"
		},
	)

	ctx := context.Background()
	if withContainer {
		ctx = WithClientTraceResults(ctx)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
	require.NoError(t, err)

	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	_, err = io.Copy(io.Discard, resp.Body)
	require.NoError(t, err)
	_ = resp.Body.Close()

	var results expr.ClientTrace
	if withContainer {
		results = *ClientTraceResultsFromContext(ctx)
	}
	return results, exprCtx, store
}

func TestTraceInjectingRoundTripper(t *testing.T) {
	t.Run("records a metric for every observed connection phase", func(t *testing.T) {
		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("ok"))
		}))
		defer server.Close()

		// Hit the server via the "localhost" hostname (not the 127.0.0.1 literal it
		// listens on) so the transport actually performs a DNS lookup.
		serverURL, err := url.Parse(server.URL)
		require.NoError(t, err)
		requestURL := "https://localhost:" + serverURL.Port() + "/"

		store := &recordingConnectionMetricStore{}
		base := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
		rt := NewTraceInjectingRoundTripper(
			base,
			store,
			func(ctx context.Context, req *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		req, err := http.NewRequestWithContext(WithClientTraceResults(context.Background()), http.MethodGet, requestURL, http.NoBody)
		require.NoError(t, err)

		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()

		require.Equal(t, 1, store.acquire, "connection acquire duration should be recorded once")
		require.Equal(t, 1, store.dns, "DNS lookup duration should be recorded once")
		require.Equal(t, 1, store.tcp, "TCP connect duration should be recorded once")
		require.Equal(t, 1, store.tls, "TLS handshake duration should be recorded once")
		require.Equal(t, 1, store.reqFirstByte, "time to first request byte should be recorded once")
		require.Equal(t, 1, store.reqLastByte, "time to last request byte should be recorded once")
		require.Equal(t, 1, store.ttfb, "time to first byte should be recorded once")
		require.Equal(t, 1, store.ttlb, "time to last byte should be recorded once the body is read")
	})

	t.Run("records connection phase timings without racing concurrent httptrace callbacks", func(t *testing.T) {
		var wg sync.WaitGroup

		rt := NewTraceInjectingRoundTripper(
			&writeLoopRoundTripper{wg: &wg},
			&metric.NoopConnectionMetricStore{},
			func(ctx context.Context, req *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		req, err := http.NewRequest(http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		if err != nil {
			t.Fatal(err)
		}

		resp, err := rt.RoundTrip(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()

		wg.Wait()
	})

	t.Run("attributes timings to the per-fetch results container, not the shared expression context", func(t *testing.T) {
		results, exprCtx, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.DNSStart(httptrace.DNSStartInfo{})
			time.Sleep(time.Millisecond)
			ct.DNSDone(httptrace.DNSDoneInfo{})
			ct.ConnectStart("tcp", "10.0.0.1:443")
			time.Sleep(time.Millisecond)
			ct.ConnectDone("tcp", "10.0.0.1:443", nil)
			ct.TLSHandshakeStart()
			time.Sleep(time.Millisecond)
			ct.TLSHandshakeDone(tls.ConnectionState{}, nil)
			ct.GotConn(httptrace.GotConnInfo{})
			ct.WroteHeaderField("Content-Type", []string{"application/json"})
			time.Sleep(time.Millisecond)
			ct.WroteRequest(httptrace.WroteRequestInfo{})
			time.Sleep(time.Millisecond)
			ct.GotFirstResponseByte()
		})

		require.Greater(t, results.ConnectionAcquireDuration, time.Duration(0))
		require.Greater(t, results.DNSLookupDuration, time.Duration(0))
		require.Greater(t, results.TCPConnectDuration, time.Duration(0))
		require.Greater(t, results.TLSHandshakeDuration, time.Duration(0))
		require.Greater(t, results.TimeToFirstRequestByte, time.Duration(0))
		require.Greater(t, results.TimeToLastRequestByte, time.Duration(0))
		require.Greater(t, results.TimeToFirstByte, time.Duration(0))
		require.Greater(t, results.TimeToLastByte, time.Duration(0))

		require.Zero(t, exprCtx.Subgraph.Request.ClientTrace, "the request-scoped expression context must stay untouched when a per-fetch container is present")

		require.Equal(t, 1, store.acquire)
		require.Equal(t, 1, store.dns)
		require.Equal(t, 1, store.tcp)
		require.Equal(t, 1, store.tls)
		require.Equal(t, 1, store.reqFirstByte)
		require.Equal(t, 1, store.reqLastByte)
		require.Equal(t, 1, store.ttfb)
		require.Equal(t, 1, store.ttlb)
	})

	t.Run("keeps the last observation of each phase across retry attempts of one fetch", func(t *testing.T) {
		// The retry transport re-enters RoundTrip with the same fetch context:
		// each attempt gets a fresh ClientTrace but shares the fetch's results
		// container. Each phase keeps the value of the last attempt that
		// observed it.
		store := &recordingConnectionMetricStore{}
		attempt := 0
		rt := NewTraceInjectingRoundTripper(
			&hookFiringRoundTripper{fire: func(ct *httptrace.ClientTrace) {
				attempt++
				ct.GetConn("subgraph.local:443")
				ct.DNSStart(httptrace.DNSStartInfo{})
				time.Sleep(time.Millisecond)
				ct.DNSDone(httptrace.DNSDoneInfo{})
				if attempt == 2 {
					ct.ConnectStart("tcp", "10.0.0.1:443")
					time.Sleep(time.Millisecond)
					ct.ConnectDone("tcp", "10.0.0.1:443", nil)
				}
				ct.GotConn(httptrace.GotConnInfo{})
			}},
			store,
			func(ctx context.Context, req *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		for range 2 {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
			require.NoError(t, err)
			resp, err := rt.RoundTrip(req)
			require.NoError(t, err)
			_ = resp.Body.Close()
		}

		results := *ClientTraceResultsFromContext(ctx)
		require.Greater(t, results.DNSLookupDuration, time.Duration(0), "DNS from the last attempt must be kept")
		require.Greater(t, results.TCPConnectDuration, time.Duration(0), "connect observed only by attempt 2 must be kept")
		require.Equal(t, 2, store.dns, "metrics are recorded once per attempt")
		require.Equal(t, 1, store.tcp)
	})

	t.Run("never pairs DNS timestamps from two different lookups", func(t *testing.T) {
		// Two overlapping dials on the same trace: the first lookup completes,
		// then a second lookup starts and never finishes before the snapshot.
		// The recorded duration must be the completed first pair, not the
		// negative interval DNSDone(1) - DNSStart(2).
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.DNSStart(httptrace.DNSStartInfo{})
			time.Sleep(time.Millisecond)
			ct.DNSDone(httptrace.DNSDoneInfo{})
			ct.DNSStart(httptrace.DNSStartInfo{})
			ct.GotConn(httptrace.GotConnInfo{})
		})

		require.Equal(t, 1, store.dns)
		require.Greater(t, store.dnsMs, 0.0)
		require.Greater(t, results.DNSLookupDuration, time.Duration(0))
	})

	t.Run("ignores a DNSDone without a matching DNSStart", func(t *testing.T) {
		// Pins the missing-start guard (shared with the previous
		// implementation), not the timestamp-pairing fix.
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.DNSDone(httptrace.DNSDoneInfo{})
			ct.GotConn(httptrace.GotConnInfo{})
		})

		require.Equal(t, 0, store.dns)
		require.Zero(t, results.DNSLookupDuration)
	})

	t.Run("records the successfully connected address, not the errors", func(t *testing.T) {
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.ConnectStart("tcp", "10.0.0.1:443")
			time.Sleep(5 * time.Millisecond)
			ct.ConnectStart("tcp", "[::1]:443")
			ct.ConnectDone("tcp", "[::1]:443", errors.New("connection refused"))
			time.Sleep(5 * time.Millisecond)
			ct.ConnectDone("tcp", "10.0.0.1:443", nil)
			ct.GotConn(httptrace.GotConnInfo{})
		})

		require.Equal(t, 1, store.tcp)
		// The duration must span the winning v4 dial (~10ms), not the ~5ms
		// window of the failed v6 dial that started later.
		require.GreaterOrEqual(t, store.tcpMs, 9.0)
		require.GreaterOrEqual(t, results.TCPConnectDuration, 9*time.Millisecond)
	})

	t.Run("sums the tcp connects values", func(t *testing.T) {
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.ConnectStart("tcp", "10.0.0.1:443")
			ct.ConnectStart("tcp", "[::1]:443")
			time.Sleep(3 * time.Millisecond)
			ct.ConnectDone("tcp", "10.0.0.1:443", nil)
			time.Sleep(30 * time.Millisecond)
			ct.ConnectDone("tcp", "[::1]:443", nil)
			ct.GotConn(httptrace.GotConnInfo{})
		})

		require.Equal(t, 1, store.tcp)
		require.Greater(t, store.tcpMs, 36.0, "3ms + 33ms")
		require.Greater(t, results.TCPConnectDuration, 36*time.Millisecond)
	})

	t.Run("measures up to the first request byte, ignoring later header fields", func(t *testing.T) {
		// WroteHeaderField fires once per header field; only the first call
		// marks the first request byte. The duration spans from the connection
		// request (attempt start, not connection acquired) to that first field
		// and must not grow with later fields. The first-to-last request span,
		// by contrast, excludes connection acquisition.
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			time.Sleep(30 * time.Millisecond)
			ct.GotConn(httptrace.GotConnInfo{})
			time.Sleep(20 * time.Millisecond)
			ct.WroteHeaderField("Host", []string{"subgraph.local"})
			time.Sleep(10 * time.Millisecond)
			ct.WroteHeaderField("Content-Type", []string{"application/json"})
			ct.WroteRequest(httptrace.WroteRequestInfo{})
		})

		require.Equal(t, 1, store.reqFirstByte)
		require.GreaterOrEqual(t, results.TimeToFirstRequestByte, 49*time.Millisecond, "must span from the connection request, including acquisition, to the first header field")

		// The last request byte is marked by a successful WroteRequest, and its
		// duration starts at the first request byte rather than GetConn.
		require.Equal(t, 1, store.reqLastByte)
		require.GreaterOrEqual(t, results.TimeToLastRequestByte, 9*time.Millisecond)
		require.Less(t, results.TimeToLastRequestByte, 30*time.Millisecond, "must exclude connection acquisition")
		require.Less(t, results.TimeToLastRequestByte, results.TimeToFirstRequestByte)
	})

	t.Run("ignores header bytes written without a connection request", func(t *testing.T) {
		// Without GetConn there is no attempt start to measure from (and no
		// server attributes); nothing must be recorded and nothing may panic.
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.WroteHeaderField("Host", []string{"subgraph.local"})
			ct.WroteRequest(httptrace.WroteRequestInfo{})
		})

		require.Equal(t, 0, store.reqFirstByte)
		require.Zero(t, results.TimeToFirstRequestByte)
		require.Equal(t, 0, store.reqLastByte)
		require.Zero(t, results.TimeToLastRequestByte)
		require.Equal(t, 0, store.ttlb, "without a connection request there is nothing to anchor the last byte to")
		require.Zero(t, results.TimeToLastByte)
	})

	t.Run("keeps the first attempt's measurement when the transport retries inside one RoundTrip", func(t *testing.T) {
		// A reused keep-alive connection that turns out dead makes net/http
		// retry on a new connection within the same RoundTrip, reusing the
		// same trace. The first request byte was written by the first attempt:
		// its time-to-first measurement is kept. The first-to-last request span
		// must use only the successful retry's timestamps.
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.GotConn(httptrace.GotConnInfo{Reused: true})
			time.Sleep(5 * time.Millisecond)
			ct.WroteHeaderField("Host", []string{"subgraph.local"})
			// Attempt 1 dies; the transport acquires a new connection.
			time.Sleep(30 * time.Millisecond)
			ct.GetConn("subgraph.local:443")
			ct.GotConn(httptrace.GotConnInfo{})
			ct.WroteHeaderField("Host", []string{"subgraph.local"})
			time.Sleep(5 * time.Millisecond)
			ct.WroteRequest(httptrace.WroteRequestInfo{})
		})

		require.Equal(t, 1, store.reqFirstByte)
		require.GreaterOrEqual(t, results.TimeToFirstRequestByte, 4*time.Millisecond, "the first attempt's measurement is kept")
		require.Less(t, results.TimeToFirstRequestByte, 30*time.Millisecond, "must never span the dead attempt and the redial")
		require.Equal(t, 1, store.reqLastByte)
		require.GreaterOrEqual(t, results.TimeToLastRequestByte, 4*time.Millisecond)
		require.Less(t, results.TimeToLastRequestByte, 20*time.Millisecond, "must not pair the first attempt's first byte with the retry's last byte")
	})

	t.Run("does not record a last request byte when writing the request fails", func(t *testing.T) {
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.GotConn(httptrace.GotConnInfo{})
			ct.WroteHeaderField("Host", []string{"subgraph.local"})
			time.Sleep(time.Millisecond)
			ct.WroteRequest(httptrace.WroteRequestInfo{Err: errors.New("request body write failed")})
		})

		require.Equal(t, 0, store.reqLastByte)
		require.Zero(t, results.TimeToLastRequestByte)
	})

	t.Run("does record failed TLS handshakes and failed connects", func(t *testing.T) {
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			ct.ConnectStart("tcp", "10.0.0.1:443")
			time.Sleep(time.Millisecond)
			ct.ConnectDone("tcp", "10.0.0.1:443", errors.New("connection refused"))
			ct.TLSHandshakeStart()
			time.Sleep(time.Millisecond)
			ct.TLSHandshakeDone(tls.ConnectionState{}, errors.New("handshake failure"))
			ct.GotConn(httptrace.GotConnInfo{})
		})

		require.Equal(t, 1, store.tcp)
		require.Equal(t, 1, store.tls)
		require.NotZero(t, results.TCPConnectDuration)
		require.NotZero(t, results.TLSHandshakeDuration)
	})

	t.Run("measures the time to the last response byte once the body is fully read", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		body := &pacedBody{
			chunks: [][]byte{[]byte("hello "), []byte("world")},
			delay:  10 * time.Millisecond,
		}
		rt := NewTraceInjectingRoundTripper(
			&bodyReturningRoundTripper{
				fire: func(ct *httptrace.ClientTrace) {
					ct.GetConn("subgraph.local:443")
					ct.GotConn(httptrace.GotConnInfo{})
					ct.WroteHeaderField("Host", []string{"subgraph.local"})
					ct.WroteRequest(httptrace.WroteRequestInfo{})
					// Server wait belongs to TimeToFirstByte, not the
					// first-to-last response transfer duration.
					time.Sleep(40 * time.Millisecond)
					ct.GotFirstResponseByte()
				},
				body:          body,
				contentLength: -1,
			},
			store,
			func(ctx context.Context, req *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)

		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)

		// Nothing is recorded until the caller consumes the response body.
		require.Equal(t, 0, store.ttlb, "time to last byte must not be recorded before the body is read")
		require.Zero(t, ClientTraceResultsFromContext(ctx).TimeToLastByte)

		read, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, "hello world", string(read))
		require.True(t, body.closed, "the underlying body must still be closed through the wrapper")

		results := *ClientTraceResultsFromContext(ctx)
		require.Equal(t, 1, store.ttlb, "time to last byte is recorded once, when the body is fully read")
		require.GreaterOrEqual(t, results.TimeToLastByte, 19*time.Millisecond, "must span reading the whole body")
		require.Less(t, results.TimeToLastByte, 40*time.Millisecond, "must exclude server wait before the first response byte")
		require.Less(t, results.TimeToLastByte, results.TimeToFirstByte)
	})

	t.Run("records the time to the last response byte only once even if read and closed", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		rt := NewTraceInjectingRoundTripper(
			&bodyReturningRoundTripper{
				fire: func(ct *httptrace.ClientTrace) {
					ct.GetConn("subgraph.local:443")
					ct.GotConn(httptrace.GotConnInfo{})
					ct.WroteHeaderField("Host", []string{"subgraph.local"})
					ct.WroteRequest(httptrace.WroteRequestInfo{})
					ct.GotFirstResponseByte()
				},
				body:          &pacedBody{chunks: [][]byte{[]byte("data")}},
				contentLength: -1,
			},
			store,
			func(ctx context.Context, req *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)

		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)

		// Read to EOF and then close: the EOF and the Close must not both record.
		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		require.Equal(t, 1, store.ttlb, "reaching EOF and then closing must record the last byte only once")
	})

	t.Run("does not record the last response byte when the body is closed early", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		body := &pacedBody{chunks: [][]byte{[]byte("first"), []byte("second")}}
		rt := NewTraceInjectingRoundTripper(
			&bodyReturningRoundTripper{
				fire: func(ct *httptrace.ClientTrace) {
					ct.GetConn("subgraph.local:443")
					ct.GotConn(httptrace.GotConnInfo{})
					ct.WroteHeaderField("Host", []string{"subgraph.local"})
					ct.WroteRequest(httptrace.WroteRequestInfo{})
					ct.GotFirstResponseByte()
				},
				body:          body,
				contentLength: -1,
			},
			store,
			func(context.Context, *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)
		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)

		_, err = resp.Body.Read(make([]byte, len("first")))
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		require.True(t, body.closed)
		require.Equal(t, 0, store.ttlb)
		require.Zero(t, ClientTraceResultsFromContext(ctx).TimeToLastByte)
	})

	t.Run("does not record the last response byte after a body read error", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		body := &failingBody{}
		rt := NewTraceInjectingRoundTripper(
			&bodyReturningRoundTripper{
				fire: func(ct *httptrace.ClientTrace) {
					ct.GetConn("subgraph.local:443")
					ct.GotConn(httptrace.GotConnInfo{})
					ct.WroteHeaderField("Host", []string{"subgraph.local"})
					ct.WroteRequest(httptrace.WroteRequestInfo{})
					ct.GotFirstResponseByte()
				},
				body:          body,
				contentLength: -1,
			},
			store,
			func(context.Context, *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)
		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)

		_, err = io.ReadAll(resp.Body)
		require.EqualError(t, err, "response body read failed")
		require.NoError(t, resp.Body.Close())

		require.True(t, body.closed)
		require.Equal(t, 0, store.ttlb)
		require.Zero(t, ClientTraceResultsFromContext(ctx).TimeToLastByte)
	})

	t.Run("records completion at Content-Length without requiring another EOF read", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		body := &pacedBody{chunks: [][]byte{[]byte("data")}}
		rt := NewTraceInjectingRoundTripper(
			&bodyReturningRoundTripper{
				fire: func(ct *httptrace.ClientTrace) {
					ct.GetConn("subgraph.local:443")
					ct.GotConn(httptrace.GotConnInfo{})
					ct.WroteHeaderField("Host", []string{"subgraph.local"})
					ct.WroteRequest(httptrace.WroteRequestInfo{})
					ct.GotFirstResponseByte()
				},
				body:          body,
				contentLength: int64(len("data")),
			},
			store,
			func(context.Context, *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)
		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)

		n, err := resp.Body.Read(make([]byte, len("data")))
		require.NoError(t, err)
		require.Equal(t, len("data"), n)
		require.Equal(t, 1, store.ttlb)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, 1, store.ttlb)
	})

	t.Run("records no-body responses when their headers have been read", func(t *testing.T) {
		tests := []struct {
			name          string
			method        string
			statusCode    int
			body          io.ReadCloser
			contentLength int64
		}{
			{
				name:          "HEAD with representation length",
				method:        http.MethodHead,
				statusCode:    http.StatusOK,
				body:          &pacedBody{},
				contentLength: 128,
			},
			{
				name:          "no content",
				method:        http.MethodPost,
				statusCode:    http.StatusNoContent,
				body:          &pacedBody{},
				contentLength: -1,
			},
			{
				name:          "not modified",
				method:        http.MethodGet,
				statusCode:    http.StatusNotModified,
				body:          &pacedBody{},
				contentLength: -1,
			},
			{
				name:          "explicit zero length",
				method:        http.MethodPost,
				statusCode:    http.StatusOK,
				body:          http.NoBody,
				contentLength: 0,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				store := &recordingConnectionMetricStore{}
				rt := NewTraceInjectingRoundTripper(
					&bodyReturningRoundTripper{
						fire: func(ct *httptrace.ClientTrace) {
							ct.GetConn("subgraph.local:443")
							ct.GotConn(httptrace.GotConnInfo{})
							ct.WroteHeaderField("Host", []string{"subgraph.local"})
							ct.WroteRequest(httptrace.WroteRequestInfo{})
							ct.GotFirstResponseByte()
						},
						body:          tt.body,
						statusCode:    tt.statusCode,
						contentLength: tt.contentLength,
					},
					store,
					func(context.Context, *http.Request) (*expr.Context, string) {
						return &expr.Context{}, "employees"
					},
				)

				ctx := WithClientTraceResults(context.Background())
				req, err := http.NewRequestWithContext(ctx, tt.method, "https://subgraph.local/graphql", http.NoBody)
				require.NoError(t, err)
				resp, err := rt.RoundTrip(req)
				require.NoError(t, err)

				require.Equal(t, tt.body, resp.Body)
				require.Equal(t, 1, store.ttlb)
				require.Greater(t, ClientTraceResultsFromContext(ctx).TimeToLastByte, time.Duration(0))
				require.NoError(t, resp.Body.Close())
				require.Equal(t, 1, store.ttlb)
			})
		}
	})

	t.Run("does not record a short EOF against Content-Length", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		rt := NewTraceInjectingRoundTripper(
			&bodyReturningRoundTripper{
				fire: func(ct *httptrace.ClientTrace) {
					ct.GetConn("subgraph.local:443")
					ct.GotConn(httptrace.GotConnInfo{})
					ct.WroteHeaderField("Host", []string{"subgraph.local"})
					ct.WroteRequest(httptrace.WroteRequestInfo{})
					ct.GotFirstResponseByte()
				},
				body:          &pacedBody{chunks: [][]byte{[]byte("short")}},
				contentLength: int64(len("longer-body")),
			},
			store,
			func(context.Context, *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)
		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)

		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		require.Equal(t, 0, store.ttlb)
		require.Zero(t, ClientTraceResultsFromContext(ctx).TimeToLastByte)
	})

	t.Run("preserves upgraded response bodies and excludes subscriptions", func(t *testing.T) {
		tests := []struct {
			name       string
			statusCode int
			header     http.Header
		}{
			{
				name:       "websocket upgrade",
				statusCode: http.StatusSwitchingProtocols,
			},
			{
				name:       "event stream",
				statusCode: http.StatusOK,
				header:     http.Header{"Content-Type": []string{"text/event-stream; charset=utf-8"}},
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				store := &recordingConnectionMetricStore{}
				body := &readWriteBody{pacedBody: &pacedBody{}}
				rt := NewTraceInjectingRoundTripper(
					&bodyReturningRoundTripper{
						fire: func(ct *httptrace.ClientTrace) {
							ct.GetConn("subgraph.local:443")
							ct.GotConn(httptrace.GotConnInfo{})
							ct.WroteHeaderField("Host", []string{"subgraph.local"})
							ct.WroteRequest(httptrace.WroteRequestInfo{})
							ct.GotFirstResponseByte()
						},
						body:          body,
						statusCode:    tt.statusCode,
						header:        tt.header,
						contentLength: -1,
					},
					store,
					func(context.Context, *http.Request) (*expr.Context, string) {
						return &expr.Context{}, "employees"
					},
				)

				req, err := http.NewRequestWithContext(WithClientTraceResults(context.Background()), http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
				require.NoError(t, err)
				resp, err := rt.RoundTrip(req)
				require.NoError(t, err)

				require.Same(t, body, resp.Body)
				_, ok := resp.Body.(io.ReadWriteCloser)
				require.True(t, ok, "upgraded response capabilities must remain intact")
				require.NoError(t, resp.Body.Close())
				require.Equal(t, 0, store.ttlb)
			})
		}
	})

	t.Run("records a successful request write that completes after RoundTrip returns", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		writeDone := make(chan struct{})
		base := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			ct := httptrace.ContextClientTrace(req.Context())
			ct.GetConn("subgraph.local:443")
			ct.GotConn(httptrace.GotConnInfo{})
			ct.GotFirstResponseByte()
			go func() {
				defer close(writeDone)
				ct.WroteHeaderField("Host", []string{"subgraph.local"})
				time.Sleep(5 * time.Millisecond)
				ct.WroteRequest(httptrace.WroteRequestInfo{})
			}()
			return &http.Response{
				StatusCode:    http.StatusOK,
				Body:          &pacedBody{chunks: [][]byte{[]byte("response")}, delay: 10 * time.Millisecond},
				Header:        make(http.Header),
				ContentLength: -1,
				Request:       req,
			}, nil
		})
		rt := NewTraceInjectingRoundTripper(
			base,
			store,
			func(context.Context, *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)
		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)
		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		<-writeDone

		require.Equal(t, 1, store.reqLastByte)
		require.GreaterOrEqual(t, ClientTraceResultsFromContext(ctx).TimeToLastRequestByte, 4*time.Millisecond)
	})

	t.Run("records a request metric when the successful write completes after the response", func(t *testing.T) {
		store := &recordingConnectionMetricStore{}
		startWrite := make(chan struct{})
		writeDone := make(chan struct{})
		base := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			ct := httptrace.ContextClientTrace(req.Context())
			ct.GetConn("subgraph.local:443")
			ct.GotConn(httptrace.GotConnInfo{})
			ct.GotFirstResponseByte()
			go func() {
				defer close(writeDone)
				<-startWrite
				ct.WroteHeaderField("Host", []string{"subgraph.local"})
				time.Sleep(time.Millisecond)
				ct.WroteRequest(httptrace.WroteRequestInfo{})
			}()
			return &http.Response{
				StatusCode:    http.StatusOK,
				Body:          &pacedBody{chunks: [][]byte{[]byte("response")}},
				Header:        make(http.Header),
				ContentLength: -1,
				Request:       req,
			}, nil
		})
		rt := NewTraceInjectingRoundTripper(
			base,
			store,
			func(context.Context, *http.Request) (*expr.Context, string) {
				return &expr.Context{}, "employees"
			},
		)

		ctx := WithClientTraceResults(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://subgraph.local/graphql", http.NoBody)
		require.NoError(t, err)
		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)
		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		close(startWrite)
		<-writeDone

		require.Equal(t, 1, store.reqLastByte)
		require.Greater(t, store.reqLastByteMs, 0.0)
		require.Zero(t, ClientTraceResultsFromContext(ctx).TimeToLastRequestByte, "late callbacks must not race the completed fetch's expression results")
	})
}
