package cdn

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"go.uber.org/zap"
)

// validPersistedOpJSON is a valid PersistedOperation JSON response.
var validPersistedOpJSON = mustMarshalPersistedOp(persistedoperation.PersistedOperation{
	Version: 1,
	Body:    "query { hello }",
})

func mustMarshalPersistedOp(po persistedoperation.PersistedOperation) []byte {
	data, err := json.Marshal(po)
	if err != nil {
		panic(err)
	}
	return data
}

func newTestPersistedOpsClient(primaryURL, fallbackURL string) *Client {
	u, _ := url.Parse(primaryURL)
	var fu *url.URL
	if fallbackURL != "" {
		fu, _ = url.Parse(fallbackURL)
	}
	return &Client{
		cdnURL:              u,
		cdnFallbackURL:      fu,
		authenticationToken: "test-token",
		federatedGraphID:    "test-graph",
		organizationID:      "test-org",
		httpClient:          http.DefaultClient,
		logger:              zap.NewNop(),
	}
}

func TestPersistedOperation_Fallback(t *testing.T) {
	t.Parallel()

	t.Run("primary 200 without fallback succeeds normally", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer primary.Close()

		c := newTestPersistedOpsClient(primary.URL, "")
		body, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.NoError(t, err)
		assert.Equal(t, "query { hello }", string(body))
	})

	t.Run("primary 200 with fallback configured does not call fallback", func(t *testing.T) {
		t.Parallel()
		var fallbackCalled atomic.Bool

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalled.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer fallback.Close()

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		body, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.NoError(t, err)
		assert.Equal(t, "query { hello }", string(body))
		assert.False(t, fallbackCalled.Load())
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
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer fallback.Close()

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		_, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.Error(t, err)
		var notFoundErr *persistedoperation.PersistentOperationNotFoundError
		assert.ErrorAs(t, err, &notFoundErr)
		assert.False(t, fallbackCalled.Load())
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
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer fallback.Close()

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		_, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "authenticate")
		assert.False(t, fallbackCalled.Load())
	})

	t.Run("primary 503 without fallback returns error", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		c := newTestPersistedOpsClient(primary.URL, "")
		_, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "503")
	})

	t.Run("primary 503 with fallback 200 returns from fallback", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer fallback.Close()

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		body, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.NoError(t, err)
		assert.Equal(t, "query { hello }", string(body))
	})

	t.Run("primary 429 with fallback 200 returns from fallback", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}))
		defer primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer fallback.Close()

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		body, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.NoError(t, err)
		assert.Equal(t, "query { hello }", string(body))
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

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		_, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "503")
	})

	t.Run("primary network error without fallback returns error", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		primary.Close()

		c := newTestPersistedOpsClient(primary.URL, "")
		_, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.Error(t, err)
	})

	t.Run("primary network error with fallback 200 returns from fallback", func(t *testing.T) {
		t.Parallel()

		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		primary.Close()

		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(validPersistedOpJSON)
		}))
		defer fallback.Close()

		c := newTestPersistedOpsClient(primary.URL, fallback.URL)
		body, err := c.PersistedOperation(context.Background(), "client1", "abc123")
		require.NoError(t, err)
		assert.Equal(t, "query { hello }", string(body))
	})
}
