package core

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestTimeoutTransport(t *testing.T) {
	t.Parallel()

	testSubgraphKey := "test"

	t.Run("nil request should return nil response", func(t *testing.T) {
		t.Parallel()

		timeoutTransport := NewSubgraphTransport(
			&SubgraphTransportOptions{},
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		resp, err := timeoutTransport.RoundTrip(nil)
		require.Nil(t, resp)
		require.Nil(t, err)
	})

	t.Run("nil request context should return nil response", func(t *testing.T) {
		t.Parallel()

		timeoutTransport := NewSubgraphTransport(
			&SubgraphTransportOptions{},
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		req := httptest.NewRequest("GET", "http://example.com", nil)
		resp, err := timeoutTransport.RoundTrip(req)
		require.Nil(t, resp)
		require.Nil(t, err)
	})

	t.Run("ResponseHeaderTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		transportOpts := &SubgraphTransportOptions{
			SubgraphMap: map[string]*TransportRequestOptions{
				testSubgraphKey: {
					ResponseHeaderTimeout: 100 * time.Millisecond,
				},
			},
		}

		headerTimeoutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(500 * time.Millisecond) // Delayed header response
			w.WriteHeader(http.StatusOK)
		}))
		defer headerTimeoutServer.Close()

		rqCtx := &requestContext{
			subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: "test", UrlString: headerTimeoutServer.URL}}),
		}

		req := httptest.NewRequest("GET", headerTimeoutServer.URL, nil)
		req = req.WithContext(withRequestContext(req.Context(), rqCtx))

		timeoutTransport := NewSubgraphTransport(
			transportOpts,
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		resp, err := timeoutTransport.RoundTrip(req)
		require.NotNil(t, err)
		require.ErrorContains(t, err, "timeout awaiting response headers")
		require.Nil(t, resp)
	})

	t.Run("TLSHandshakeTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		transportOpts := &SubgraphTransportOptions{
			SubgraphMap: map[string]*TransportRequestOptions{
				testSubgraphKey: {
					TLSHandshakeTimeout: 2 * time.Millisecond,
				},
			},
		}

		tlsServer := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		tlsServer.TLS = &tls.Config{}
		tlsServer.StartTLS()
		defer tlsServer.Close()

		rqCtx := &requestContext{
			subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: "test", UrlString: tlsServer.URL}}),
		}

		req := httptest.NewRequest("GET", tlsServer.URL, nil)
		req = req.WithContext(withRequestContext(req.Context(), rqCtx))

		timeoutTransport := NewSubgraphTransport(
			transportOpts,
			http.DefaultTransport,
			zap.NewNop(),
			http.ProxyFromEnvironment,
		)

		resp, err := timeoutTransport.RoundTrip(req)
		require.NotNil(t, err)
		require.Contains(t, err.Error(), "TLS handshake timeout")
		require.Nil(t, resp)
	})

	t.Run("DialTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		transportOpts := &SubgraphTransportOptions{
			SubgraphMap: map[string]*TransportRequestOptions{
				testSubgraphKey: {
					DialTimeout: 1 * time.Millisecond,
				},
			},
		}

		unreachableServerURL := "http://192.0.2.1" // Reserved IP address unlikely to respond

		rqCtx := &requestContext{
			subgraphResolver: NewSubgraphResolver([]Subgraph{{Name: testSubgraphKey, UrlString: unreachableServerURL}}),
		}

		req := httptest.NewRequest("GET", unreachableServerURL, nil)
		req = req.WithContext(withRequestContext(req.Context(), rqCtx))

		timeoutTransport := NewSubgraphTransport(
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
