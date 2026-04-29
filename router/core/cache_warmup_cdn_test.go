package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// validCacheWarmupJSON is a valid CacheWarmerOperations protobuf JSON with one operation.
const validCacheWarmupJSON = `{
	"operations": [
		{
			"request": {
				"query": "query { hello }"
			}
		}
	]
}`

func newTestCDNSource(primaryURL string, fallbackURL string) *CDNSource {
	u, _ := url.Parse(primaryURL)
	var fu *url.URL
	if fallbackURL != "" {
		fu, _ = url.Parse(fallbackURL)
	}
	return &CDNSource{
		cdnURL:              u,
		cdnFallbackURL:      fu,
		authenticationToken: "test-token",
		federatedGraphID:    "test-graph",
		organizationID:      "test-org",
		httpClient:          http.DefaultClient,
	}
}

func TestCDNSource_LoadItems(t *testing.T) {
	t.Parallel()

	t.Run("primary 200 without fallback", func(t *testing.T) {
		t.Parallel()
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer primary.Close()

		source := newTestCDNSource(primary.URL, "")
		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 1)
		assert.Equal(t, "query { hello }", items[0].Request.Query)
	})

	t.Run("primary 200 with fallback configured", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer fallback.Close()

		source := newTestCDNSource(primary.URL, fallback.URL)
		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 1)
		assert.False(t, fallbackCalled.Load(), "fallback should not be called when primary succeeds")
	})

	t.Run("primary 404 with fallback does not trigger fallback", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer fallback.Close()

		source := newTestCDNSource(primary.URL, fallback.URL)
		items, err := source.LoadItems(context.Background(), zap.NewNop())
		assert.NoError(t, err)
		assert.Nil(t, items)
		assert.False(t, fallbackCalled.Load(), "fallback should not be called on 404")
	})

	t.Run("primary 401 with fallback does not trigger fallback", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer fallback.Close()

		source := newTestCDNSource(primary.URL, fallback.URL)
		_, err := source.LoadItems(context.Background(), zap.NewNop())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "authenticate")
		assert.False(t, fallbackCalled.Load(), "fallback should not be called on 401")
	})

	t.Run("primary 503 without fallback returns error", func(t *testing.T) {
		t.Parallel()
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		source := newTestCDNSource(primary.URL, "")
		_, err := source.LoadItems(context.Background(), zap.NewNop())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "503")
	})

	t.Run("primary 503 with fallback 200 returns items from fallback", func(t *testing.T) {
		t.Parallel()
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer fallback.Close()

		source := newTestCDNSource(primary.URL, fallback.URL)
		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 1)
		assert.Equal(t, "query { hello }", items[0].Request.Query)
	})

	t.Run("primary 429 with fallback 200 returns items from fallback", func(t *testing.T) {
		t.Parallel()
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer fallback.Close()

		source := newTestCDNSource(primary.URL, fallback.URL)
		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 1)
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

		source := newTestCDNSource(primary.URL, fallback.URL)
		_, err := source.LoadItems(context.Background(), zap.NewNop())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "503")
	})

	t.Run("primary network error with fallback 200 returns items from fallback", func(t *testing.T) {
		t.Parallel()
		// Use an immediately-closed server to simulate network error
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(validCacheWarmupJSON))
		}))
		defer fallback.Close()

		source := newTestCDNSource(primary.URL, fallback.URL)
		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 1)
	})

	t.Run("primary network error without fallback returns error", func(t *testing.T) {
		t.Parallel()
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		primary.Close()

		source := newTestCDNSource(primary.URL, "")
		_, err := source.LoadItems(context.Background(), zap.NewNop())
		assert.Error(t, err)
	})
}
