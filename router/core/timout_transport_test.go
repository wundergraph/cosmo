package core

import (
	"context"
	"crypto/tls"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestTimeoutTransport(t *testing.T) {
	t.Parallel()

	var (
		testSubgraphKey = "test"
		transportOpts   = &SubgraphTransportOptions{
			SubgraphMap: map[string]*TransportTimeoutOptions{
				testSubgraphKey: {},
			},
		}
	)

	t.Run("applies request timeout", func(t *testing.T) {
		t.Parallel()

		t.Run("Fast response within timeout", func(t *testing.T) {
			t.Parallel()

			fastServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			defer fastServer.Close()

			rqCtx := &requestContext{
				subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: testSubgraphKey, UrlString: fastServer.URL}}),
			}

			transportOpts.SubgraphMap[testSubgraphKey].RequestTimeout = 10 * time.Millisecond

			req := httptest.NewRequest("GET", fastServer.URL, nil)
			req = req.WithContext(withRequestContext(req.Context(), rqCtx))

			timeoutTransport := NewTimeoutTransport(
				transportOpts,
				http.DefaultTransport,
				zap.NewNop(),
				http.ProxyFromEnvironment,
			)
			resp, err := timeoutTransport.RoundTrip(req)
			require.Nil(t, err)
			require.NotNil(t, resp)
			require.Equal(t, http.StatusOK, resp.StatusCode)
		})

		t.Run("Slow response exceeding timeout", func(t *testing.T) {
			t.Parallel()

			slowServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				time.Sleep(20 * time.Millisecond) // Slow response
				w.Write([]byte("Hello, world!"))
			}))
			defer slowServer.Close()

			rqCtx := &requestContext{
				subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: testSubgraphKey, UrlString: slowServer.URL}}),
			}
			transportOpts.SubgraphMap[testSubgraphKey].RequestTimeout = 10 * time.Millisecond

			req := httptest.NewRequestWithContext(withRequestContext(context.Background(), rqCtx), "GET", slowServer.URL, nil)

			timeoutTransport := NewTimeoutTransport(
				transportOpts,
				http.DefaultTransport,
				zap.NewNop(),
				http.ProxyFromEnvironment,
			)

			resp, err := timeoutTransport.RoundTrip(req)
			require.NotNil(t, err)
			require.ErrorAs(t, err, &context.DeadlineExceeded)
			require.Nil(t, resp) // No response due to timeout
		})
	})

	t.Run("ResponseHeaderTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		transportOpts.SubgraphMap[testSubgraphKey].ResponseHeaderTimeout = 3 * time.Millisecond

		headerTimeoutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(5 * time.Millisecond) // Delayed header response
			w.WriteHeader(http.StatusOK)
		}))
		defer headerTimeoutServer.Close()

		rqCtx := &requestContext{
			subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: "test", UrlString: headerTimeoutServer.URL}}),
		}

		req := httptest.NewRequest("GET", headerTimeoutServer.URL, nil)
		req = req.WithContext(withRequestContext(req.Context(), rqCtx))

		timeoutTransport := NewTimeoutTransport(
			transportOpts,
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		resp, err := timeoutTransport.RoundTrip(req)
		require.NotNil(t, err)
		require.ErrorAs(t, err, &context.DeadlineExceeded)
		require.Nil(t, resp)
	})

	t.Run("TLSHandshakeTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		tlsServer := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		tlsServer.TLS = &tls.Config{}
		tlsServer.StartTLS()
		defer tlsServer.Close()

		transportOpts.SubgraphMap[testSubgraphKey].TLSHandshakeTimeout = 2 * time.Millisecond

		rqCtx := &requestContext{
			subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: "test", UrlString: tlsServer.URL}}),
		}

		req := httptest.NewRequest("GET", tlsServer.URL, nil)
		req = req.WithContext(withRequestContext(req.Context(), rqCtx))

		timeoutTransport := NewTimeoutTransport(
			transportOpts,
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		resp, err := timeoutTransport.RoundTrip(req)
		require.NotNil(t, err)
		require.Contains(t, err.Error(), "TLS handshake timeout")
		require.ErrorAs(t, err, &os.ErrDeadlineExceeded)
		require.Nil(t, resp)
	})

	t.Run("DialTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		transportOpts.SubgraphMap[testSubgraphKey].DialTimeout = 1 * time.Millisecond
		unreachableServerURL := "http://192.0.2.1" // Reserved IP address unlikely to respond

		rqCtx := &requestContext{
			subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: testSubgraphKey, UrlString: unreachableServerURL}}),
		}

		req := httptest.NewRequest("GET", unreachableServerURL, nil)
		req = req.WithContext(withRequestContext(req.Context(), rqCtx))

		timeoutTransport := NewTimeoutTransport(
			transportOpts,
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		resp, err := timeoutTransport.RoundTrip(req)
		require.NotNil(t, err)
		require.ErrorContains(t, err, "dial tcp")
		require.ErrorAs(t, err, &os.ErrDeadlineExceeded)
		require.Nil(t, resp)
	})
}
