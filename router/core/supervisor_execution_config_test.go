package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestRouterSupervisor_KeepsLastValidExecutionConfigUntilSplitConfigIsValid(t *testing.T) {
	logger := zap.NewNop()
	persistentState := NewReloadPersistentState(logger)
	graphToken := testGraphToken(t, "organization-a", "graph-a")
	splitToken := testGraphToken(t, "organization-a", "graph-a", "split-config-loading")
	data, err := os.ReadFile("../pkg/plan_generator/testdata/execution_config/base.json")
	require.NoError(t, err)
	previousConfig, err := execution_config.UnmarshalConfig(data)
	require.NoError(t, err)
	// This test only needs HTTP subgraphs, not the fixture's event providers.
	previousConfig.EngineConfig.DatasourceConfigurations = slices.DeleteFunc(previousConfig.EngineConfig.DatasourceConfigurations,
		func(ds *nodev1.DataSourceConfiguration) bool { return ds.Kind != nodev1.DataSourceKind_GRAPHQL })
	previousConfig.Version = "legacy-accepted"
	publishedConfig := proto.Clone(previousConfig).(*nodev1.RouterConfig)
	require.NotEmpty(t, previousConfig.Subgraphs)
	overriddenSubgraph := previousConfig.Subgraphs[0].Name

	validConfig := proto.Clone(previousConfig).(*nodev1.RouterConfig)
	validConfig.Version = "split-accepted"
	body, err := protojson.Marshal(validConfig)
	require.NoError(t, err)
	var published atomic.Bool
	var mapperCalls atomic.Int32
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/organization-a/graph-a/manifest/mapper.json":
			mapperCalls.Add(1)
			if published.Load() {
				_, _ = w.Write([]byte(`{"":"base-v1"}`))
			} else {
				_, _ = w.Write([]byte(`{"feature":"ff-v1"}`))
			}
		case "/organization-a/graph-a/manifest/latest.json":
			_, _ = w.Write(body)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(cdn.Close)

	generation := 0
	supervisor, err := NewRouterSupervisor(&RouterSupervisorOpts{
		BaseLogger:            logger,
		ReloadPersistentState: persistentState,
		ConfigFactory: func() (*config.Config, error) {
			return &config.Config{ShutdownDelay: time.Second}, nil
		},
		RouterFactory: func(ctx context.Context, resources *RouterResources) (*Router, error) {
			generation++
			options := []Option{
				WithBatching(&BatchingConfig{}),
				WithGraphApiToken(graphToken),
				WithDisableUsageTracking(),
				WithListenerAddr("127.0.0.1:0"),
				WithLogger(logger),
				WithReloadPersistentState(resources.ReloadPersistentState),
			}
			if generation == 1 {
				options = append(options,
					WithStaticExecutionConfig(previousConfig),
					WithOverrideRoutingURL(config.OverrideRoutingURLConfiguration{
						Subgraphs: map[string]string{overriddenSubgraph: "http://removed-override.invalid"},
					}),
				)
			} else {
				options = append(options,
					WithGraphApiToken(splitToken),
					WithCDN(config.CDNConfiguration{URL: cdn.URL}),
					WithConfigPollerConfig(&RouterConfigPollerConfig{PollInterval: 20 * time.Millisecond}),
				)
			}
			return NewRouter(ctx, options...)
		},
	})
	require.NoError(t, err)

	startResult := make(chan error, 1)
	go func() { startResult <- supervisor.Start() }()
	t.Cleanup(func() {
		select {
		case err := <-startResult:
			assert.NoError(t, err)
			return
		default:
			supervisor.Stop()
			assert.NoError(t, <-startResult)
		}
	})

	require.Eventually(t, func() bool {
		return persistentState.previousExecutionConfig(graphToken).GetVersion() == "legacy-accepted"
	}, 5*time.Second, 10*time.Millisecond, "the first router must accept its legacy config")

	supervisor.Reload()
	require.Eventually(t, func() bool {
		return mapperCalls.Load() >= 2
	}, 5*time.Second, 10*time.Millisecond, "the replacement router must boot from the fallback and start polling")
	// The override was removed on reload. Both the poller's input and the saved
	// fallback must retain the published URLs, not the first router's override.
	assert.True(t, proto.Equal(publishedConfig, previousConfig), "graph construction must not mutate its input")
	assert.True(t, proto.Equal(publishedConfig, persistentState.previousExecutionConfig(graphToken)),
		"fallback must not retain a removed router-local override")

	published.Store(true)
	assert.Eventually(t, func() bool {
		return persistentState.previousExecutionConfig(graphToken).GetVersion() == "split-accepted"
	}, 5*time.Second, 10*time.Millisecond, "a validated split config must atomically replace the fallback")
}
