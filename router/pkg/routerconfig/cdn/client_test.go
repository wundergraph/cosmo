package cdn

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// validRouterConfigJSON is a minimal valid execution config JSON.
const validRouterConfigJSON = `{"version":"1","engineConfig":{},"subgraphs":[]}`

func newTestConfigClient(primaryURL, fallbackURL string) *Client {
	u, _ := url.Parse(primaryURL)
	var fu *url.URL
	if fallbackURL != "" {
		fu, _ = url.Parse(fallbackURL)
	}
	return &Client{
		cdnURL:                     u,
		cdnFallbackURL:             fu,
		authenticationToken:        "test-token",
		federatedGraphID:           "test-graph",
		organizationID:             "test-org",
		httpClient:                 http.DefaultClient,
		logger:                     zap.NewNop(),
		routerCompatibilityVersion: 0,
	}
}

func TestGetRouterConfig_Fallback(t *testing.T) {
	t.Parallel()

	t.Run("primary 200 does not trigger fallback", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		body, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.NoError(t, err)
		require.NotEmpty(t, body)
		assert.False(t, fallbackCalled.Load())
	})

	t.Run("primary 503 with fallback 200 returns from fallback", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		body, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.NoError(t, err)
		require.NotEmpty(t, body)
	})

	t.Run("primary 429 with fallback 200 returns from fallback", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		body, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.NoError(t, err)
		require.NotEmpty(t, body)
	})

	t.Run("primary 404 does not trigger fallback", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		_, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.Error(t, err)
		assert.False(t, fallbackCalled.Load())
	})

	t.Run("primary 401 does not trigger fallback", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		_, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "authenticate")
		assert.False(t, fallbackCalled.Load())
	})

	t.Run("primary 200 without fallback succeeds normally", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer primary.Close()

		c := newTestConfigClient(primary.URL, "")
		body, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.NoError(t, err)
		require.NotEmpty(t, body)
	})

	t.Run("primary 503 without fallback returns error", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		c := newTestConfigClient(primary.URL, "")
		_, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "503")
	})

	t.Run("primary network error without fallback returns error", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		primary.Close()

		c := newTestConfigClient(primary.URL, "")
		_, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.Error(t, err)
	})

	t.Run("primary network error with fallback 200 returns from fallback", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validRouterConfigJSON))
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		body, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.NoError(t, err)
		require.NotEmpty(t, body)
	})

	t.Run("primary 503 fallback 503 returns error", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer fallback.Close()

		c := newTestConfigClient(primary.URL, fallback.URL)
		_, err := c.getRouterConfig(context.Background(), "", time.Time{})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "503")
	})
}
