package traceclient

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/url"
	"sync"
	"testing"

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

// recordingConnectionMetricStore counts how many times each measurement is recorded.
type recordingConnectionMetricStore struct {
	acquire, dns, tcp, tls, ttfb int
}

func (s *recordingConnectionMetricStore) MeasureConnectionAcquireDuration(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.acquire++
}
func (s *recordingConnectionMetricStore) MeasureDNSLookupDuration(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.dns++
}
func (s *recordingConnectionMetricStore) MeasureTCPConnectDuration(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.tcp++
}
func (s *recordingConnectionMetricStore) MeasureTLSHandshakeDuration(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.tls++
}
func (s *recordingConnectionMetricStore) MeasureTimeToFirstByte(_ context.Context, _ float64, _ ...attribute.KeyValue) {
	s.ttfb++
}
func (s *recordingConnectionMetricStore) Shutdown(_ context.Context) error { return nil }

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

		req, err := http.NewRequest(http.MethodGet, requestURL, http.NoBody)
		require.NoError(t, err)

		resp, err := rt.RoundTrip(req)
		require.NoError(t, err)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()

		require.Equal(t, 1, store.acquire, "connection acquire duration should be recorded once")
		require.Equal(t, 1, store.dns, "DNS lookup duration should be recorded once")
		require.Equal(t, 1, store.tcp, "TCP connect duration should be recorded once")
		require.Equal(t, 1, store.tls, "TLS handshake duration should be recorded once")
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
}
