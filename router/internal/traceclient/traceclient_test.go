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

// recordingConnectionMetricStore counts how many times each measurement is
// recorded and keeps the last recorded value in milliseconds.
type recordingConnectionMetricStore struct {
	acquire, dns, tcp, tls, reqFirstByte, ttfb int

	dnsMs, tcpMs float64
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
func (s *recordingConnectionMetricStore) MeasureTimeToFirstByte(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.ttfb++
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
		require.Equal(t, 1, store.ttfb, "time to first byte should be recorded once")
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
		require.Greater(t, results.TimeToFirstByte, time.Duration(0))

		require.Zero(t, exprCtx.Subgraph.Request.ClientTrace, "the request-scoped expression context must stay untouched when a per-fetch container is present")

		require.Equal(t, 1, store.acquire)
		require.Equal(t, 1, store.dns)
		require.Equal(t, 1, store.tcp)
		require.Equal(t, 1, store.tls)
		require.Equal(t, 1, store.reqFirstByte)
		require.Equal(t, 1, store.ttfb)
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
		// and must not grow with later fields.
		results, _, store := roundTripThroughHooks(t, true, func(ct *httptrace.ClientTrace) {
			ct.GetConn("subgraph.local:443")
			time.Sleep(10 * time.Millisecond)
			ct.GotConn(httptrace.GotConnInfo{})
			time.Sleep(10 * time.Millisecond)
			ct.WroteHeaderField("Host", []string{"subgraph.local"})
			time.Sleep(20 * time.Millisecond)
			ct.WroteHeaderField("Content-Type", []string{"application/json"})
			ct.WroteRequest(httptrace.WroteRequestInfo{})
		})

		require.Equal(t, 1, store.reqFirstByte)
		require.GreaterOrEqual(t, results.TimeToFirstRequestByte, 19*time.Millisecond, "must span from the connection request, including the acquisition, to the first header field")
		require.Less(t, results.TimeToFirstRequestByte, 39*time.Millisecond, "must not span later header fields")
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
	})

	t.Run("keeps the first attempt's measurement when the transport retries inside one RoundTrip", func(t *testing.T) {
		// A reused keep-alive connection that turns out dead makes net/http
		// retry on a new connection within the same RoundTrip, reusing the
		// same trace. The first request byte was written by the first attempt:
		// its measurement is kept, and the duration must never be recomputed
		// against the redial's connection request.
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
			ct.WroteRequest(httptrace.WroteRequestInfo{})
		})

		require.Equal(t, 1, store.reqFirstByte)
		require.GreaterOrEqual(t, results.TimeToFirstRequestByte, 4*time.Millisecond, "the first attempt's measurement is kept")
		require.Less(t, results.TimeToFirstRequestByte, 30*time.Millisecond, "must never span the dead attempt and the redial")
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
}
