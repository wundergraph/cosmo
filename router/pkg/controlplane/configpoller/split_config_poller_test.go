package configpoller

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/errs"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap"
)

// mockSplitFetcher is a controllable implementation of SplitConfigFetcher for tests.
type mockSplitFetcher struct {
	mapperResult map[string]string
	mapperErr    error
	// configResults maps feature flag name -> result (use "" for base graph)
	configResults map[string]*nodev1.RouterConfig
	configErrors  map[string]error
	// tracks calls for assertion
	fetchConfigCalls []string
	fetchMapperCalls int
}

func (m *mockSplitFetcher) FetchMapper(_ context.Context) (map[string]string, error) {
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
		mapperResult:  map[string]string{"": "hash-base"},
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

func TestSplitGetRouterConfig_MissingBaseGraph(t *testing.T) {
	baseCfg := makeRouterConfig("ff-v1")
	mock := &mockSplitFetcher{
		mapperResult:  map[string]string{"ff1": "hash-ff1"},
		configResults: map[string]*nodev1.RouterConfig{"ff1": baseCfg},
	}

	p := newTestPoller(mock)
	resp, err := p.GetRouterConfig(context.Background())
	require.Error(t, err)
	require.Nil(t, resp)
	assert.Contains(t, err.Error(), "mapper missing base graph entry")
}

func TestSplitGetRouterConfig_WithFeatureFlags(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	ffCfg := makeRouterConfig("ff-v1")
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1",
		},
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
		mapperResult: map[string]string{},
	}
	p := newTestPoller(mock)
	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty graph configs")
}

func TestSplitGetRouterConfig_ConfigFetchError(t *testing.T) {
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{"": "hash-base"},
		configErrors: map[string]error{"": errors.New("CDN unavailable")},
	}
	p := newTestPoller(mock)
	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "CDN unavailable")
}

// ---- ConfigRules tests ----

func TestSplitGetRouterConfig_IgnoredFeatureFlag_NotFetched(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	activeCfg := makeRouterConfig("active-v1")
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":        "hash-base",
			"active":  "hash-active",
			"ignored": "hash-ignored",
		},
		configResults: map[string]*nodev1.RouterConfig{
			"":        baseCfg,
			"active":  activeCfg,
			"ignored": makeRouterConfig("ignored-v1"),
		},
	}

	p := newTestPoller(mock)
	p.configRules = ConfigRules{
		IgnoredFeatureFlags: map[string]struct{}{"ignored": {}},
	}

	resp, err := p.GetRouterConfig(context.Background())
	require.NoError(t, err)

	require.NotNil(t, resp.Config.FeatureFlagConfigs)
	assert.Contains(t, resp.Config.FeatureFlagConfigs.ConfigByFeatureFlagName, "active")
	assert.NotContains(t, resp.Config.FeatureFlagConfigs.ConfigByFeatureFlagName, "ignored",
		"ignored feature flag must not appear in the assembled config")

	assert.Contains(t, mock.fetchConfigCalls, "active")
	assert.NotContains(t, mock.fetchConfigCalls, "ignored",
		"ignored feature flag must not be fetched from the CDN")
}

func TestSplitGetRouterConfig_AllFeatureFlagsIgnored(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1",
			"ff2": "hash-ff2",
		},
		configResults: map[string]*nodev1.RouterConfig{"": baseCfg},
	}

	p := newTestPoller(mock)
	p.configRules = ConfigRules{
		IgnoredFeatureFlags: map[string]struct{}{
			"ff1": {},
			"ff2": {},
		},
	}

	resp, err := p.GetRouterConfig(context.Background())
	require.NoError(t, err)

	assert.Nil(t, resp.Config.FeatureFlagConfigs,
		"FeatureFlagConfigs should be nil when every feature flag is ignored")
	assert.Equal(t, []string{""}, mock.fetchConfigCalls,
		"only the base graph should be fetched when all feature flags are ignored")
}

func TestSplitGetRouterConfig_SkipMissingFeatureFlag_FileNotFoundSkipped(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	availableCfg := makeRouterConfig("available-v1")
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":          "hash-base",
			"available": "hash-available",
			"missing":   "hash-missing",
		},
		configResults: map[string]*nodev1.RouterConfig{
			"":          baseCfg,
			"available": availableCfg,
		},
		configErrors: map[string]error{
			"missing": errs.ErrFileNotFound,
		},
	}

	p := newTestPoller(mock)
	p.configRules = ConfigRules{SkipMissingFeatureFlags: true}

	resp, err := p.GetRouterConfig(context.Background())
	require.NoError(t, err, "ErrFileNotFound must be tolerated when SkipMissingFeatureFlags is true")

	require.NotNil(t, resp.Config.FeatureFlagConfigs)
	assert.Contains(t, resp.Config.FeatureFlagConfigs.ConfigByFeatureFlagName, "available")
	assert.NotContains(t, resp.Config.FeatureFlagConfigs.ConfigByFeatureFlagName, "missing")
}

func TestSplitGetRouterConfig_SkipMissingFeatureFlag_DisabledByDefault(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":        "hash-base",
			"missing": "hash-missing",
		},
		configResults: map[string]*nodev1.RouterConfig{"": baseCfg},
		configErrors:  map[string]error{"missing": errs.ErrFileNotFound},
	}

	p := newTestPoller(mock)
	// SkipMissingFeatureFlags defaults to false.

	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err, "ErrFileNotFound must abort the poll when SkipMissingFeatureFlags is false")
	assert.ErrorIs(t, err, errs.ErrFileNotFound)
	assert.Contains(t, err.Error(), `"missing"`)
}

func TestSplitGetRouterConfig_SkipMissingFeatureFlag_OnlyFileNotFoundSuppressed(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	transientErr := errors.New("transient CDN failure")
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":      "hash-base",
			"flaky": "hash-flaky",
		},
		configResults: map[string]*nodev1.RouterConfig{"": baseCfg},
		configErrors:  map[string]error{"flaky": transientErr},
	}

	p := newTestPoller(mock)
	p.configRules = ConfigRules{SkipMissingFeatureFlags: true}

	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err, "non-ErrFileNotFound errors must propagate even with SkipMissingFeatureFlags enabled")
	assert.ErrorIs(t, err, transientErr)
	assert.NotErrorIs(t, err, errs.ErrFileNotFound)
}

func TestSplitGetRouterConfig_BaseConfigCannotBeSkippedOrIgnored(t *testing.T) {
	// The skip/ignore rules apply to feature flags only. A missing base config must always
	// abort the poll, even when both rules are configured aggressively.
	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1",
		},
		configErrors: map[string]error{"": errs.ErrFileNotFound},
	}

	p := newTestPoller(mock)
	p.configRules = ConfigRules{
		SkipMissingFeatureFlags: true,
		IgnoredFeatureFlags:     map[string]struct{}{"": {}},
	}

	_, err := p.GetRouterConfig(context.Background())
	require.Error(t, err, "missing base config must always abort, regardless of skip/ignore rules")
	assert.ErrorIs(t, err, errs.ErrFileNotFound)
	assert.Contains(t, err.Error(), "base config")
}

// TestSplitSubscribe_SkipMissingFeatureFlag_ExcludedFromChangesAndKnownHashes
// asserts that when a poll skips a feature flag because its config fetch
// returns ErrFileNotFound (and SkipMissingFeatureFlags is true), the skipped
// flag must not appear in the change payload handed to the handler and must
// not be recorded in knownHashes. Otherwise the graph_server would think the
// flag changed (or was added) and tear down its old mux even though we never
// actually got new contents to install in its place; and the next poll would
// fail to retry the fetch because knownHashes would already record the new
// mapper hash.
func TestSplitSubscribe_SkipMissingFeatureFlag_ExcludedFromChangesAndKnownHashes(t *testing.T) {
	baseCfg := makeRouterConfig("v1")
	keepOldFF := makeRouterConfig("keep-v1")
	keepNewFF := makeRouterConfig("keep-v2")

	mock := &mockSplitFetcher{
		mapperResult: map[string]string{
			"":            "hash-base",
			"keep":        "hash-keep-new",    // existed before, hash changed, fetch succeeds
			"missing-add": "hash-missing-add", // new in the mapper, fetch returns ErrFileNotFound
			"missing-chg": "hash-missing-chg", // existed before, hash changed, fetch returns ErrFileNotFound
		},
		configResults: map[string]*nodev1.RouterConfig{
			"":     baseCfg,
			"keep": keepNewFF,
		},
		configErrors: map[string]error{
			"missing-add": errs.ErrFileNotFound,
			"missing-chg": errs.ErrFileNotFound,
		},
	}

	p := newTestPoller(mock)
	p.configRules = ConfigRules{SkipMissingFeatureFlags: true}
	p.knownHashes = map[string]string{
		"":            "hash-base",
		"keep":        "hash-keep-old",
		"missing-chg": "hash-missing-chg-old",
	}
	p.currentConfig = &nodev1.RouterConfig{
		Version:      "v1",
		EngineConfig: baseCfg.EngineConfig,
		FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"keep":        {Version: keepOldFF.Version, EngineConfig: keepOldFF.EngineConfig},
				"missing-chg": {Version: "stale-v1", EngineConfig: baseCfg.EngineConfig},
			},
		},
	}
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *routerconfig.Response
	pollOnce(p, func(resp *routerconfig.Response) error {
		received = resp
		return nil
	})

	require.NotNil(t, received)
	require.NotNil(t, received.Changes)

	// The successful flag must appear in ChangedConfigs.
	assert.Contains(t, received.Changes.ChangedConfigs, "keep",
		"a successfully-fetched changed flag must appear in ChangedConfigs")

	// Neither skipped flag may appear in the Changes payload — otherwise the
	// graph_server would tear down a mux it has no replacement for.
	assert.NotContains(t, received.Changes.AddedConfigs, "missing-add",
		"a skipped new flag must not appear in AddedConfigs")
	assert.NotContains(t, received.Changes.ChangedConfigs, "missing-add",
		"a skipped new flag must not appear in ChangedConfigs")
	assert.NotContains(t, received.Changes.ChangedConfigs, "missing-chg",
		"a skipped changed flag must not appear in ChangedConfigs")
	assert.NotContains(t, received.Changes.AddedConfigs, "missing-chg",
		"a skipped changed flag must not appear in AddedConfigs")

	// knownHashes must reflect what we actually applied: the kept flag at its
	// new hash, and no entry for either skipped flag (so the next poll
	// re-attempts the fetch instead of treating them as up-to-date).
	assert.Equal(t, "hash-keep-new", p.knownHashes["keep"],
		"successfully-fetched flag must have its new hash stored")
	assert.NotContains(t, p.knownHashes, "missing-add",
		"a skipped new flag must not be recorded in knownHashes")
	assert.NotContains(t, p.knownHashes, "missing-chg",
		"a skipped changed flag must not be recorded in knownHashes")

	// The assembled config must contain the updated kept flag and must leave
	// the previously-existing skipped flag untouched (stale-but-functional is
	// better than torn-down-with-no-replacement). The new skipped flag must
	// not be present at all.
	require.NotNil(t, received.Config.FeatureFlagConfigs)
	assert.Equal(t, keepNewFF.Version,
		received.Config.FeatureFlagConfigs.ConfigByFeatureFlagName["keep"].Version)
	assert.Equal(t, "stale-v1",
		received.Config.FeatureFlagConfigs.ConfigByFeatureFlagName["missing-chg"].Version,
		"skipped changed flag must keep its previous engine config")
	assert.NotContains(t, received.Config.FeatureFlagConfigs.ConfigByFeatureFlagName, "missing-add",
		"skipped new flag must not be assembled into the config")
}

// ---- Subscribe / polling tests ----

// pollOnce manually executes one poll iteration using the poller's internal logic.
// It extracts the subscribe callback by using a fake controlplane.Poller.
func pollOnce(p *splitConfigPoller, handler func(_ *routerconfig.Response) error) {
	var tickFn func()
	p.poller = &capturingPoller{capture: &tickFn}
	p.Subscribe(context.Background(), handler) // sets tickFn
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
		mapperResult:  map[string]string{"": "hash-base"},
		configResults: map[string]*nodev1.RouterConfig{"": baseCfg},
	}

	p := newTestPoller(mock)
	// Seed state as if GetRouterConfig was already called.
	p.knownHashes = map[string]string{"": "hash-base"}
	p.currentConfig = baseCfg
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	handlerCalled := false
	pollOnce(p, func(_ *routerconfig.Response) error {
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
		mapperResult:  map[string]string{"": "hash-base-new"},
		configResults: map[string]*nodev1.RouterConfig{"": newBase},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old"}
	p.currentConfig = oldBase
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(resp *routerconfig.Response) error {
		received = resp.Config
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
		mapperResult: map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1-new",
		},
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
	pollOnce(p, func(resp *routerconfig.Response) error {
		received = resp.Config
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
		mapperResult: map[string]string{
			"":    "hash-base",
			"ff1": "hash-ff1",
		},
		configResults: map[string]*nodev1.RouterConfig{"ff1": newFF},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base"}
	p.currentConfig = baseCfg
	p.latestVersion = computeCompositeVersion(p.knownHashes)

	var received *nodev1.RouterConfig
	pollOnce(p, func(resp *routerconfig.Response) error {
		received = resp.Config
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
		mapperResult: map[string]string{"": "hash-base"},
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
	pollOnce(p, func(resp *routerconfig.Response) error {
		received = resp.Config
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
		mapperResult: map[string]string{
			"":    "hash-base-new",
			"ff2": "hash-ff2",
		},
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
	pollOnce(p, func(resp *routerconfig.Response) error {
		received = resp.Config
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
	pollOnce(p, func(_ *routerconfig.Response) error {
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
		mapperResult: map[string]string{"": "hash-base-new"},
		configErrors: map[string]error{"": errors.New("config fetch failed")},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old"}
	p.currentConfig = baseCfg
	initialVersion := computeCompositeVersion(p.knownHashes)
	p.latestVersion = initialVersion

	handlerCalled := false
	pollOnce(p, func(_ *routerconfig.Response) error {
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
		mapperResult:  map[string]string{"": "hash-base-new"},
		configResults: map[string]*nodev1.RouterConfig{"": newBase},
	}

	p := newTestPoller(mock)
	p.knownHashes = map[string]string{"": "hash-base-old"}
	p.currentConfig = baseCfg
	initialVersion := computeCompositeVersion(p.knownHashes)
	p.latestVersion = initialVersion

	pollOnce(p, func(_ *routerconfig.Response) error {
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
