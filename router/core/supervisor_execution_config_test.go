package core

import (
	"context"
	"errors"
	"maps"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

type supervisorSplitConfigFetcher struct {
	mu          sync.RWMutex
	mapper      map[string]string
	configs     map[string]*nodev1.RouterConfig
	mapperCalls atomic.Int32
	configCalls atomic.Int32
}

func (f *supervisorSplitConfigFetcher) FetchMapper(_ context.Context) (map[string]string, error) {
	f.mapperCalls.Add(1)
	f.mu.RLock()
	defer f.mu.RUnlock()
	return maps.Clone(f.mapper), nil
}

func (f *supervisorSplitConfigFetcher) FetchConfig(_ context.Context, name string) (*nodev1.RouterConfig, error) {
	f.configCalls.Add(1)
	f.mu.RLock()
	defer f.mu.RUnlock()
	config, ok := f.configs[name]
	if !ok {
		return nil, errors.New("config not found")
	}
	return proto.Clone(config).(*nodev1.RouterConfig), nil
}

func (f *supervisorSplitConfigFetcher) update(mapper map[string]string, configs map[string]*nodev1.RouterConfig) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.mapper = maps.Clone(mapper)
	f.configs = maps.Clone(configs)
}

func TestRouterSupervisor_KeepsLastValidExecutionConfigUntilSplitConfigIsValid(t *testing.T) {
	logger := zap.NewNop()
	graphToken := testGraphToken(t, "organization-a", "graph-a")
	previousConfig := routerconfig.GetDefaultConfig()
	previousConfig.Version = "legacy-accepted"

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

	var routerGeneration atomic.Int32
	supervisor, err := NewRouterSupervisor(&RouterSupervisorOpts{
		BaseLogger: logger,
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
				options = append(options, WithStaticExecutionConfig(previousConfig))
			} else {
				poller := configpoller.NewSplitConfigPoller(
					fetcher,
					configpoller.WithPreviousConfigFallback(resources.ReloadPersistentState.previousExecutionConfig(graphToken)),
					configpoller.WithSplitPolling(20*time.Millisecond, 0),
				)
				options = append(options, WithConfigPoller(poller))
			}
			return NewRouter(ctx, options...)
		},
	})
	require.NoError(t, err)

	persistentState := supervisor.resources.ReloadPersistentState
	startResult := make(chan error, 1)
	go func() {
		startResult <- supervisor.Start()
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
	require.Equal(t, "legacy-accepted", persistentState.previousExecutionConfig(graphToken).GetVersion())

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
