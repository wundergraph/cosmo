package core

import (
	"context"
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type supervisorSplitConfigFetcher struct {
	mu          sync.RWMutex
	mapper      map[string]string
	configs     map[string]*nodev1.RouterConfig
	mapperCalls atomic.Int32
	configCalls atomic.Int32
}

func (f *supervisorSplitConfigFetcher) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	var body []byte
	var err error
	switch r.URL.Path {
	case "/organization-a/graph-a/manifest/mapper.json":
		f.mapperCalls.Add(1)
		body, err = json.Marshal(f.mapper)
	case "/organization-a/graph-a/manifest/latest.json":
		f.configCalls.Add(1)
		body, err = protojson.Marshal(f.configs[""])
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = w.Write(body)
}

func (f *supervisorSplitConfigFetcher) update(mapper map[string]string, configs map[string]*nodev1.RouterConfig) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.mapper = maps.Clone(mapper)
	f.configs = maps.Clone(configs)
}

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

	invalidConfig := proto.Clone(previousConfig).(*nodev1.RouterConfig)
	invalidConfig.Version = "split-invalid"
	invalidConfig.EngineConfig.GraphqlSchema = "type Query {"

	validConfig := proto.Clone(previousConfig).(*nodev1.RouterConfig)
	validConfig.Version = "split-accepted"

	fetcher := &supervisorSplitConfigFetcher{
		// A feature flag was recomposed before the base graph during migration.
		mapper:  map[string]string{"my-feature-flag": "ff-v1"},
		configs: map[string]*nodev1.RouterConfig{},
	}

	cdn := httptest.NewServer(fetcher)
	t.Cleanup(cdn.Close)

	var routerGeneration atomic.Int32
	supervisor, err := NewRouterSupervisor(&RouterSupervisorOpts{
		BaseLogger:            logger,
		ReloadPersistentState: persistentState,
		ConfigFactory: func() (*config.Config, error) {
			return &config.Config{ShutdownDelay: time.Second}, nil
		},
		RouterFactory: func(ctx context.Context, resources *RouterResources) (*Router, error) {
			generation := routerGeneration.Add(1)
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
	go func() {
		err := supervisor.Start()
		if err != nil {
			t.Logf("supervisor stopped: %v", err)
		}
		startResult <- err
	}()
	supervisorStopped := false
	t.Cleanup(func() {
		if supervisorStopped {
			return
		}
		select {
		case <-startResult:
			return
		default:
		}
		supervisor.Stop()
		<-startResult
	})

	require.Eventually(t, func() bool {
		config := persistentState.previousExecutionConfig(graphToken)
		return config != nil && config.GetVersion() == "legacy-accepted"
	}, 5*time.Second, 10*time.Millisecond, "the first router must accept its legacy config")

	supervisor.Reload()
	require.Eventually(t, func() bool {
		return routerGeneration.Load() >= 2 && fetcher.mapperCalls.Load() >= 2
	}, 5*time.Second, 10*time.Millisecond, "the replacement router must boot from the fallback and start polling")
	// The override was removed on reload. Both the poller's input and the saved
	// fallback must retain the published URLs, not the first router's override.
	require.True(t, proto.Equal(publishedConfig, previousConfig), "graph construction must not mutate its input")
	require.True(t, proto.Equal(publishedConfig, persistentState.previousExecutionConfig(graphToken)),
		"fallback must not retain a removed router-local override")

	// A mapper with a base entry is not enough: the assembled candidate must
	// also build a valid graph server before it can replace the fallback.
	fetcher.update(
		map[string]string{"": "base-invalid"},
		map[string]*nodev1.RouterConfig{"": invalidConfig},
	)
	require.Eventually(t, func() bool {
		return fetcher.configCalls.Load() > 0
	}, 5*time.Second, 10*time.Millisecond, "the invalid candidate must be attempted")
	require.Never(t, func() bool {
		return persistentState.previousExecutionConfig(graphToken).GetVersion() != "legacy-accepted"
	}, 200*time.Millisecond, 10*time.Millisecond, "an invalid candidate must never become the accepted fallback")

	fetcher.update(
		map[string]string{"": "base-valid"},
		map[string]*nodev1.RouterConfig{"": validConfig},
	)
	require.Eventually(t, func() bool {
		return persistentState.previousExecutionConfig(graphToken).GetVersion() == "split-accepted"
	}, 5*time.Second, 10*time.Millisecond, "a validated split config must atomically replace the fallback")

	supervisor.Stop()
	startErr := <-startResult
	supervisorStopped = true
	require.NoError(t, startErr)
}
