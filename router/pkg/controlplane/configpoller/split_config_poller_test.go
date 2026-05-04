package configpoller

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

// mockSplitFetcher is a controllable implementation of SplitConfigFetcher for tests.
type mockSplitFetcher struct {
	mapperResult *nodev1.ActiveGraphs
	mapperErr    error
	// configResults maps feature flag name -> result (use "" for base graph)
	configResults map[string]*nodev1.RouterConfig
	configErrors  map[string]error
	// tracks calls for assertion
	fetchConfigCalls []string
	fetchMapperCalls int
}

func (m *mockSplitFetcher) FetchMapper(_ context.Context) (*nodev1.ActiveGraphs, error) {
	m.fetchMapperCalls++
	return m.mapperResult, m.mapperErr
}

func (m *mockSplitFetcher) FetchConfig(_ context.Context, featureFlagName string) (*nodev1.RouterConfig, error) {
	m.fetchConfigCalls = append(m.fetchConfigCalls, featureFlagName)
	if err, ok := m.configErrors[featureFlagName]; ok {
		return nil, err
	}
	if cfg, ok := m.configResults[featureFlagName]; ok {
		return cfg, nil
	}
	return nil, errors.New("no config registered for: " + featureFlagName)
}

func makeRouterConfig(version string) *nodev1.RouterConfig {
	return &nodev1.RouterConfig{
		Version: version,
		EngineConfig: &nodev1.EngineConfiguration{
			DefaultFlushInterval: 500,
		},
		CompatibilityVersion: "1",
	}
}

func makeActiveGraphs(entries map[string]string) *nodev1.ActiveGraphs {
	return &nodev1.ActiveGraphs{GraphConfigs: entries}
}

// newTestPoller builds a splitConfigPoller wired to the given mock fetcher.
// The polling interval is set long enough that Subscribe won't fire automatically in tests.
func newTestPoller(fetcher SplitConfigFetcher) *splitConfigPoller {
	p := &splitConfigPoller{
		fetcher:      fetcher,
		knownHashes:  make(map[string]string),
		pollInterval: 24 * time.Hour,
		pollJitter:   0,
		logger:       zap.NewNop(),
	}
	return p
}

// ---- GetRouterConfig tests ----

func TestSplitGetRouterConfig_BaseOnly(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	mock := &mockSplitFetcher{
		mapperResult:  makeActiveGraphs(map[string]string{"": "hash-base"}),
		configResults: map[string]*nodev1.RouterConfig{"": baseCfg},
	}

	p := newTestPoller(mock)
	resp, err := p.GetRouterConfig(context.Background())
	require.NoError(t, err)
	require.NotNil(t, resp)

	assert.Equal(t, "v1", resp.Config.Version)
	assert.Nil(t, resp.Config.FeatureFlagConfigs)
	assert.Equal(t, "hash-base", p.knownHashes[""])
	assert.Contains(t, p.latestVersion, "split-")
}

func TestSplitGetRouterConfig_WithFeatureFlags(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	ffCfg := makeRouterConfig("ff-v1")
	mock := &mockSplitFetcher{
		mapperResult: makeActiveGraphs(map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1",
		}),
		configResults: map[string]*nodev1.RouterConfig{
			"":    baseCfg,
			"ff1": ffCfg,
		},
	}

	p := newTestPoller(mock)
	resp, err := p.GetRouterConfig(context.Background())
	require.NoError(t, err)

	assert.Equal(t, "v1", resp.Config.Version)
	require.NotNil(t, resp.Config.FeatureFlagConfigs)
	ff := resp.Config.FeatureFlagConfigs.ConfigByFeatureFlagName["ff1"]
	require.NotNil(t, ff)
	assert.Equal(t, "ff-v1", ff.Version)

	assert.Equal(t, "hash-base", p.knownHashes[""])
	assert.Equal(t, "hash-ff1", p.knownHashes["ff1"])
}

func TestSplitGetRouterConfig_MapperError(t *testing.T) {
	mock := &mockSplitFetcher{
		mapperErr: errors.New("network error"),
	}
	p := newTestPoller(mock)
	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "network error")
}

func TestSplitGetRouterConfig_EmptyMapper(t *testing.T) {
	mock := &mockSplitFetcher{
		mapperResult: makeActiveGraphs(map[string]string{}),
	}
	p := newTestPoller(mock)
	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty graph configs")
}

func TestSplitGetRouterConfig_ConfigFetchError(t *testing.T) {
	mock := &mockSplitFetcher{
		mapperResult: makeActiveGraphs(map[string]string{"": "hash-base"}),
		configErrors: map[string]error{"": errors.New("CDN unavailable")},
	}
	p := newTestPoller(mock)
	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "CDN unavailable")
}

// ---- Subscribe / polling tests ----

// pollOnce manually executes one poll iteration using the poller's internal logic.
// It extracts the subscribe callback by using a fake controlplane.Poller.
func pollOnce(p *splitConfigPoller, handler func(*nodev1.RouterConfig, string) error) {
	var tickFn func()
	p.poller = &capturingPoller{capture: &tickFn}
	p.Subscribe(context.Background(), handler)
	if tickFn != nil {
		tickFn()
	}
}

// capturingPoller captures the handler passed to Subscribe so tests can invoke it manually.
type capturingPoller struct {
	capture *func()
}

func (c *capturingPoller) Subscribe(_ context.Context, fn func()) {
	*c.capture = fn
}

func TestSplitSubscribe_NoChanges(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	mock := &mockSplitFetcher{
		mapperResult:  makeActiveGraphs(map[string]string{"": "hash-base"}),
		configResults: map[string]*nodev1.RouterConfig{"": baseCfg},
	}

	p := newTestPoller(mock)
	// Seed state as if GetRouterConfig was already called.
	p.knownHashes = map[string]string{"": "hash-base"}
	p.currentConfig = baseCfg
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	handlerCalled := false
	pollOnce(p, func(_ *nodev1.RouterConfig, _ string) error {
		handlerCalled = true
		return nil
	})

	assert.False(t, handlerCalled, "handler must not be called when nothing changed")
	// Only FetchMapper should have been called, no FetchConfig calls.
	assert.Equal(t, 0, len(mock.fetchConfigCalls))
}

func TestSplitSubscribe_BaseGraphChanged(t *testing.T) {
	oldBase := makeRouterConfig("v1")
	newBase := makeRouterConfig("v2")
	mock := &mockSplitFetcher{
		// Mapper now reports a new hash for the base graph.
		mapperResult:  makeActiveGraphs(map[string]string{"": "hash-base-new"}),
		configResults: map[string]*nodev1.RouterConfig{"": newBase},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old"}
	p.currentConfig = oldBase
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(cfg *nodev1.RouterConfig, _ string) error {
		received = cfg
		return nil
	})

	require.NotNil(t, received)
	assert.Equal(t, "v2", received.Version)
	// Only base config should have been fetched.
	assert.Equal(t, []string{""}, mock.fetchConfigCalls)
	// State updated.
	assert.Equal(t, "hash-base-new", p.knownHashes[""])
}

func TestSplitSubscribe_SingleFFChanged(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	oldFF := makeRouterConfig("ff-v1")
	newFF := makeRouterConfig("ff-v2")
	mock := &mockSplitFetcher{
		mapperResult: makeActiveGraphs(map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1-new",
		}),
		configResults: map[string]*nodev1.RouterConfig{"ff1": newFF},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base", "ff1": "hash-ff1-old"}
	p.currentConfig = &nodev1.RouterConfig{
		Version:      "v1",
		EngineConfig: baseCfg.EngineConfig,
		FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"ff1": {Version: oldFF.Version, EngineConfig: oldFF.EngineConfig},
			},
		},
	}
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(cfg *nodev1.RouterConfig, _ string) error {
		received = cfg
		return nil
	})

	require.NotNil(t, received)
	// Base unchanged.
	assert.Equal(t, "v1", received.Version)
	// FF updated.
	require.NotNil(t, received.FeatureFlagConfigs)
	assert.Equal(t, "ff-v2", received.FeatureFlagConfigs.ConfigByFeatureFlagName["ff1"].Version)
	// Only ff1 config should have been re-fetched (not base).
	assert.Equal(t, []string{"ff1"}, mock.fetchConfigCalls)
}

func TestSplitSubscribe_FFAdded(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	newFF := makeRouterConfig("ff-v1")
	mock := &mockSplitFetcher{
		mapperResult: makeActiveGraphs(map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1",
		}),
		configResults: map[string]*nodev1.RouterConfig{"ff1": newFF},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base"}
	p.currentConfig = baseCfg
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(cfg *nodev1.RouterConfig, _ string) error {
		received = cfg
		return nil
	})

	require.NotNil(t, received)
	require.NotNil(t, received.FeatureFlagConfigs)
	assert.Equal(t, "ff-v1", received.FeatureFlagConfigs.ConfigByFeatureFlagName["ff1"].Version)
	assert.Equal(t, []string{"ff1"}, mock.fetchConfigCalls)
}

func TestSplitSubscribe_FFRemoved(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	oldFF := makeRouterConfig("ff-v1")
	mock := &mockSplitFetcher{
		// Mapper no longer contains ff1.
		mapperResult: makeActiveGraphs(map[string]string{"": "hash-base"}),
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base", "ff1": "hash-ff1"}
	p.currentConfig = &nodev1.RouterConfig{
		Version:      "v1",
		EngineConfig: baseCfg.EngineConfig,
		FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"ff1": {Version: oldFF.Version, EngineConfig: oldFF.EngineConfig},
			},
		},
	}
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(cfg *nodev1.RouterConfig, _ string) error {
		received = cfg
		return nil
	})

	require.NotNil(t, received)
	assert.Nil(t, received.FeatureFlagConfigs, "FeatureFlagConfigs should be nil when last FF is removed")
	// No FetchConfig calls needed for removal.
	assert.Empty(t, mock.fetchConfigCalls)
}

func TestSplitSubscribe_MultipleChanges(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	newBase := makeRouterConfig("v2")
	newFF2 := makeRouterConfig("ff2-v1")
	oldFF1 := makeRouterConfig("ff1-v1")
	mock := &mockSplitFetcher{
		// base changed, ff2 added, ff1 removed.
		mapperResult: makeActiveGraphs(map[string]string{
			"":    "hash-base-new",
			"ff2": "hash-ff2",
		}),
		configResults: map[string]*nodev1.RouterConfig{
			"":    newBase,
			"ff2": newFF2,
		},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old", "ff1": "hash-ff1"}
	p.currentConfig = &nodev1.RouterConfig{
		Version:      "v1",
		EngineConfig: baseCfg.EngineConfig,
		FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"ff1": {Version: oldFF1.Version},
			},
		},
	}
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(cfg *nodev1.RouterConfig, _ string) error {
		received = cfg
		return nil
	})

	require.NotNil(t, received)
	assert.Equal(t, "v2", received.Version)
	require.NotNil(t, received.FeatureFlagConfigs)
	assert.Equal(t, "ff2-v1", received.FeatureFlagConfigs.ConfigByFeatureFlagName["ff2"].Version)
	_, hasFF1 := received.FeatureFlagConfigs.ConfigByFeatureFlagName["ff1"]
	assert.False(t, hasFF1, "ff1 should have been removed")
}

func TestSplitSubscribe_MapperFetchFailure(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	mock := &mockSplitFetcher{
		mapperErr: errors.New("mapper fetch failed"),
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base"}
	p.currentConfig = baseCfg
	initialVersion := computeCompositeVersion(p.knownHashes)
	p.latestVersion = initialVersion

	handlerCalled := false
	pollOnce(p, func(_ *nodev1.RouterConfig, _ string) error {
		handlerCalled = true
		return nil
	})

	assert.False(t, handlerCalled)
	// State unchanged.
	assert.Equal(t, initialVersion, p.latestVersion)
}

func TestSplitSubscribe_ConfigFetchFailure(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	mock := &mockSplitFetcher{
		mapperResult: makeActiveGraphs(map[string]string{"": "hash-base-new"}),
		configErrors: map[string]error{"": errors.New("config fetch failed")},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old"}
	p.currentConfig = baseCfg
	initialVersion := computeCompositeVersion(p.knownHashes)
	p.latestVersion = initialVersion

	handlerCalled := false
	pollOnce(p, func(_ *nodev1.RouterConfig, _ string) error {
		handlerCalled = true
		return nil
	})

	assert.False(t, handlerCalled)
	// State must remain unchanged after a failed fetch.
	assert.Equal(t, initialVersion, p.latestVersion)
	assert.Equal(t, "hash-base-old", p.knownHashes[""])
}

func TestSplitSubscribe_HandlerError_StateNotUpdated(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	newBase := makeRouterConfig("v2")
	mock := &mockSplitFetcher{
		mapperResult:  makeActiveGraphs(map[string]string{"": "hash-base-new"}),
		configResults: map[string]*nodev1.RouterConfig{"": newBase},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old"}
	p.currentConfig = baseCfg
	initialVersion := computeCompositeVersion(p.knownHashes)
	p.latestVersion = initialVersion

	pollOnce(p, func(_ *nodev1.RouterConfig, _ string) error {
		return errors.New("handler failed")
	})

	// State must remain unchanged after a handler failure.
	assert.Equal(t, initialVersion, p.latestVersion)
	assert.Equal(t, "hash-base-old", p.knownHashes[""])
}

func TestComputeCompositeVersion_Deterministic(t *testing.T) {
	m1 := map[string]string{"a": "1", "b": "2", "c": "3"}
	m2 := map[string]string{"c": "3", "a": "1", "b": "2"}
	assert.Equal(t, computeCompositeVersion(m1), computeCompositeVersion(m2))
}

func TestComputeCompositeVersion_DifferentInputsDifferentOutput(t *testing.T) {
	m1 := map[string]string{"a": "1"}
	m2 := map[string]string{"a": "2"}
	assert.NotEqual(t, computeCompositeVersion(m1), computeCompositeVersion(m2))
}
