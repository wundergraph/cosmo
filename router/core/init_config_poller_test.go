package core

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestInitializeConfigPoller_SplitConfigUsesOnlySupervisorFallback(t *testing.T) {
	const (
		graphID = "871e5543-60f6-4ffc-a302-4f15277de4e7"
		orgID   = "5f718753-77d6-4e28-a3a3-52b24c812802"
	)

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"federated_graph_id": graphID,
		"organization_id":    orgID,
		"features":           []string{"split-config-loading"},
	})
	graphToken, err := token.SignedString([]byte("test-secret"))
	require.NoError(t, err)

	var mapperRequests atomic.Int32
	var unexpectedRequests atomic.Int32
	cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "Bearer "+graphToken, r.Header.Get("Authorization"))

		switch r.URL.Path {
		case "/" + orgID + "/" + graphID + "/manifest/mapper.json":
			mapperRequests.Add(1)
			_, err := w.Write([]byte(`{"my-feature-flag":"hash-ff"}`))
			require.NoError(t, err)
		default:
			unexpectedRequests.Add(1)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(cdnServer.Close)

	registry, err := NewProviderRegistry(config.StorageProviders{})
	require.NoError(t, err)

	newRouter := func(state *ReloadPersistentState) *Router {
		return &Router{Config: Config{
			logger:        zap.NewNop(),
			graphApiToken: graphToken,
			cdnConfig: config.CDNConfiguration{
				URL: cdnServer.URL,
			},
			routerConfigPollerConfig: &RouterConfigPollerConfig{
				PollInterval: time.Hour,
			},
		}, reloadPersistentState: state}
	}

	t.Run("cold start rejects an incomplete mapper", func(t *testing.T) {
		poller, err := InitializeConfigPoller(newRouter(nil), registry)
		require.NoError(t, err)
		require.NotNil(t, poller)

		response, err := (*poller).GetRouterConfig(t.Context())
		require.Error(t, err)
		assert.Nil(t, response)
		assert.Contains(t, err.Error(), "mapper missing base graph entry")
	})

	t.Run("supervisor reload uses the last accepted config", func(t *testing.T) {
		state := NewReloadPersistentState(zap.NewNop())
		state.acceptExecutionConfig(&nodev1.RouterConfig{
			Version: "previous-v1",
			EngineConfig: &nodev1.EngineConfiguration{
				DefaultFlushInterval: 500,
			},
		}, graphToken)

		poller, err := InitializeConfigPoller(newRouter(state), registry)
		require.NoError(t, err)
		require.NotNil(t, poller)

		response, err := (*poller).GetRouterConfig(t.Context())
		require.NoError(t, err)
		require.NotNil(t, response)
		assert.Equal(t, "previous-v1", response.Config.GetVersion())
		assert.Nil(t, response.Changes)
	})

	assert.Equal(t, int32(2), mapperRequests.Load())
	assert.Zero(t, unexpectedRequests.Load(), "split fallback must not fetch a legacy CDN object")
}

func TestGetConfigClient(t *testing.T) {
	t.Parallel()

	registry, err := NewProviderRegistry(config.StorageProviders{
		S3: []config.S3StorageProvider{{ID: "s3", Endpoint: "localhost:10000", Bucket: "cosmo"}},
	})
	require.NoError(t, err)

	t.Run("fails for S3 primary storage without object_path", func(t *testing.T) {
		t.Parallel()

		r := &Router{}
		r.logger = zap.NewNop()
		r.routerConfigPollerConfig = &RouterConfigPollerConfig{}
		r.routerConfigPollerConfig.Storage.ProviderID = "s3"

		_, err := getConfigClient(r, registry, "s3", false)
		require.EqualError(t, err, "object_path is required for S3 storage provider 's3' for execution config")
	})

	t.Run("fails for S3 fallback storage without object_path", func(t *testing.T) {
		t.Parallel()

		r := &Router{}
		r.logger = zap.NewNop()
		r.routerConfigPollerConfig = &RouterConfigPollerConfig{}
		r.routerConfigPollerConfig.Storage.ObjectPath = "primary.json"
		r.routerConfigPollerConfig.FallbackStorage.ProviderID = "s3"

		_, err := getConfigClient(r, registry, "s3", true)
		require.EqualError(t, err, "object_path is required for S3 storage provider 's3' for execution config")
	})

	t.Run("succeeds for S3 storage with object_path", func(t *testing.T) {
		t.Parallel()

		r := &Router{}
		r.logger = zap.NewNop()
		r.routerConfigPollerConfig = &RouterConfigPollerConfig{}
		r.routerConfigPollerConfig.Storage.ObjectPath = "latest.json"

		c, err := getConfigClient(r, registry, "s3", false)
		require.NoError(t, err)
		require.NotNil(t, c)
	})
}
