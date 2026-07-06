package traceclient

import (
	"context"
	"net/http"
	"net/http/httptrace"
	"sync"
	"testing"

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

func TestTraceInjectingRoundTripper(t *testing.T) {
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
