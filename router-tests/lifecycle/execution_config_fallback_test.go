package integration

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestExecutionConfigFallbackOnSplitConfigReload(t *testing.T) {
	t.Parallel()

	configFile := t.TempDir() + "/config.json"
	writeValidLifecycleConfig(t, "legacy", configFile)
	legacyConfig, err := os.ReadFile(configFile)
	require.NoError(t, err)
	writeValidLifecycleConfig(t, "split", configFile)
	splitConfig, err := os.ReadFile(configFile)
	require.NoError(t, err)

	claims := jwt.MapClaims{"organization_id": "org", "federated_graph_id": "graph"}
	legacyToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	require.NoError(t, err)
	claims["features"] = []string{"split-config-loading"}
	splitToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	require.NoError(t, err)

	var published atomic.Bool
	var mapperCalls atomic.Int32
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/org/graph/routerconfigs/"):
			// Only the legacy router fetches here. The split router must fall back to
			// the saved config instead of fetching the legacy endpoint.
			assert.Equal(t, "Bearer "+legacyToken, r.Header.Get("Authorization"))
			_, _ = w.Write(legacyConfig)
		case r.URL.Path == "/org/graph/manifest/mapper.json":
			mapperCalls.Add(1)
			if published.Load() {
				_, _ = w.Write([]byte(`{"":"base-hash"}`))
			} else {
				_, _ = w.Write([]byte(`{"feature":"feature-hash"}`))
			}
		case r.URL.Path == "/org/graph/manifest/latest.json":
			_, _ = w.Write(splitConfig)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(cdn.Close)

	logCore, logs := observer.New(zap.WarnLevel)
	logger := zap.New(logCore)
	state := core.NewReloadPersistentState(logger)
	listenAddr := fmt.Sprintf("127.0.0.1:%d", freeport.GetOne(t))
	newRouter := func(token string) (*core.Router, context.Context, context.CancelFunc) {
		ctx, cancel := context.WithCancel(t.Context())
		router, err := core.NewRouter(ctx,
			core.WithLogger(logger),
			core.WithDisableUsageTracking(),
			core.WithBatching(&core.BatchingConfig{}),
			core.WithListenerAddr(listenAddr),
			core.WithGraphApiToken(token),
			core.WithCDN(config.CDNConfiguration{URL: cdn.URL}),
			core.WithConfigPollerConfig(&core.RouterConfigPollerConfig{PollInterval: 20 * time.Millisecond}),
			core.WithConfigVersionHeader(true),
			core.WithReloadPersistentState(state),
		)
		require.NoError(t, err)
		t.Cleanup(func() {
			defer cancel()
			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer shutdownCancel()
			assert.NoError(t, router.Shutdown(shutdownCtx))
		})
		return router, ctx, cancel
	}
	client := &http.Client{Timeout: time.Second}
	t.Cleanup(client.CloseIdleConnections)
	assertServing := func(router *core.Router, version string) {
		t.Helper()
		assert.EventuallyWithT(t, func(c *assert.CollectT) {
			request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, router.BaseURL()+"/graphql",
				strings.NewReader(`{"query":"{ hello }"}`))
			if !assert.NoError(c, err) {
				return
			}
			request.Header.Set("Content-Type", "application/json")
			response, err := testenv.MakeGraphQLRequestRawFromClient(request, client)
			if assert.NoError(c, err) {
				assert.Equal(c, http.StatusOK, response.Response.StatusCode)
				assert.Equal(c, version, response.Response.Header.Get("X-Router-Config-Version"))
				assert.JSONEq(c, `{"data":{"hello":"Hello!"}}`, response.Body)
			}
		}, 5*time.Second, 20*time.Millisecond)
	}

	legacy, ctx, cancel := newRouter(legacyToken)
	require.NoError(t, legacy.Start(ctx))
	assertServing(legacy, "legacy")
	require.NoError(t, legacy.Shutdown(ctx))
	cancel()

	// Reuse the accepted config across router instances, as the supervisor does.
	reloaded, ctx, _ := newRouter(splitToken)
	require.NoError(t, reloaded.Start(ctx))
	assertServing(reloaded, "legacy")
	assert.Equal(t, 1, logs.FilterMessage("Execution config is incomplete or invalid; using the last successfully applied execution config").Len())
	require.Eventually(t, func() bool { return mapperCalls.Load() >= 3 }, 5*time.Second, 20*time.Millisecond,
		"the replacement must keep polling while the base graph is missing")

	published.Store(true)
	assertServing(reloaded, "split")
}
