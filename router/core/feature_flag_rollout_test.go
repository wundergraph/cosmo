package core

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

func u32p(v uint32) *uint32 { return &v }

func newSelector(t *testing.T, ffConfigs map[string]*nodev1.FeatureFlagRouterExecutionConfig) *rolloutSelector {
	t.Helper()
	sel, err := newRolloutSelector(
		&config.FeatureFlagRollouts{Enabled: true},
		ffConfigs,
		zap.NewNop(),
	)
	require.NoError(t, err)
	return sel
}

func TestNewRolloutSelector_DisabledReturnsNil(t *testing.T) {
	t.Parallel()
	sel, err := newRolloutSelector(
		&config.FeatureFlagRollouts{Enabled: false},
		map[string]*nodev1.FeatureFlagRouterExecutionConfig{
			"foo": {TrafficPercentage: u32p(10)},
		},
		zap.NewNop(),
	)
	require.NoError(t, err)
	require.Nil(t, sel)
}

func TestNewRolloutSelector_NilCfgReturnsNil(t *testing.T) {
	t.Parallel()
	sel, err := newRolloutSelector(nil, nil, zap.NewNop())
	require.NoError(t, err)
	require.Nil(t, sel)
}

func TestNewRolloutSelector_NoFlagsReturnsNil(t *testing.T) {
	t.Parallel()
	sel, err := newRolloutSelector(
		&config.FeatureFlagRollouts{Enabled: true},
		map[string]*nodev1.FeatureFlagRouterExecutionConfig{
			"preview_only": {}, // no traffic_percentage
		},
		zap.NewNop(),
	)
	require.NoError(t, err)
	require.Nil(t, sel)
}

func TestNewRolloutSelector_DropsOverflowingFlagButKeepsSiblings(t *testing.T) {
	t.Parallel()
	// "a"=60, "b"=60 — alphabetical order means "a" lands inside the budget
	// (60), and "b" would push to 120 → "b" is dropped, "a" is preserved.
	sel, err := newRolloutSelector(
		&config.FeatureFlagRollouts{Enabled: true},
		map[string]*nodev1.FeatureFlagRouterExecutionConfig{
			"a": {TrafficPercentage: u32p(60)},
			"b": {TrafficPercentage: u32p(60)},
		},
		zap.NewNop(),
	)
	require.NoError(t, err)
	require.NotNil(t, sel)
	require.True(t, sel.isRolloutFlag("a"), "a fits under budget and stays a rollout flag")
	require.False(t, sel.isRolloutFlag("b"), "b would overflow budget and is dropped (falls through to base, no header/cookie pin)")
}

func TestNewRolloutSelector_DropsAbove100PercentFlag(t *testing.T) {
	t.Parallel()
	// Single flag with pct > 100 is always an operator typo — the flag is
	// dropped (logged); selector returns nil because nothing is left.
	sel, err := newRolloutSelector(
		&config.FeatureFlagRollouts{Enabled: true},
		map[string]*nodev1.FeatureFlagRouterExecutionConfig{
			"a": {TrafficPercentage: u32p(101)},
		},
		zap.NewNop(),
	)
	require.NoError(t, err)
	require.Nil(t, sel)
}

func TestNewRolloutSelector_ZeroPercentFlagIsRolloutButUnreachable(t *testing.T) {
	t.Parallel()
	sel := newSelector(t, map[string]*nodev1.FeatureFlagRouterExecutionConfig{
		"shadow": {TrafficPercentage: u32p(0)},
		"live":   {TrafficPercentage: u32p(50)},
	})
	require.NotNil(t, sel)
	// Both flags are rollout flags (header/cookie pins must be ignored)
	require.True(t, sel.isRolloutFlag("shadow"), "0%% flags must still be rollout flags")
	require.True(t, sel.isRolloutFlag("live"))
	require.False(t, sel.isRolloutFlag("preview_only"))

	// Pick must never return the 0%% flag
	for range 200 {
		flag, _, _ := sel.pick(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
		require.NotEqual(t, "shadow", flag, "0%% flag must never be picked")
	}
}

func TestPick_HonorsCumulativeRanges(t *testing.T) {
	t.Parallel()
	// Two flags at 30% and 20% = 50% rollout, 50% base. With enough samples
	// the empirical distribution should be close.
	sel := newSelector(t, map[string]*nodev1.FeatureFlagRouterExecutionConfig{
		"a": {TrafficPercentage: u32p(30)},
		"b": {TrafficPercentage: u32p(20)},
	})
	require.NotNil(t, sel)
	require.True(t, sel.isRolloutFlag("a"))
	require.True(t, sel.isRolloutFlag("b"))

	const samples = 20000
	counts := map[string]int{"a": 0, "b": 0, "": 0}
	for range samples {
		flag, _, _ := sel.pick(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
		counts[flag]++
	}

	// Allow ±3pp tolerance on each band.
	const tolPP = 0.03
	checkBand := func(name string, want float64) {
		t.Helper()
		got := float64(counts[name]) / float64(samples)
		require.InDeltaf(t, want, got, tolPP, "flag=%q got=%.3f want=%.3f", name, got, want)
	}
	checkBand("a", 0.30)
	checkBand("b", 0.20)
	checkBand("", 0.50) // base/fall-through
}

func TestPick_IsRandomPerRequest(t *testing.T) {
	t.Parallel()
	sel := newSelector(t, map[string]*nodev1.FeatureFlagRouterExecutionConfig{
		"a": {TrafficPercentage: u32p(50)},
	})
	require.NotNil(t, sel)

	// Same identical request shape, called many times — both buckets must
	// occur (random per request, no stickiness).
	flagsSeen := map[string]struct{}{}
	for range 200 {
		flag, source, _ := sel.pick(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
		require.Equal(t, "random", source)
		flagsSeen[flag] = struct{}{}
	}
	require.Contains(t, flagsSeen, "a", "expected to land on rollout flag at least once")
	require.Contains(t, flagsSeen, "", "expected to fall through to base at least once")
}

func TestNilSelector_IsRolloutFlagReturnsFalse(t *testing.T) {
	t.Parallel()
	var sel *rolloutSelector
	require.False(t, sel.isRolloutFlag("anything"))
}

func TestNilSelector_PickReturnsFalse(t *testing.T) {
	t.Parallel()
	var sel *rolloutSelector
	flag, source, ok := sel.pick(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	require.Equal(t, "", flag)
	require.Equal(t, "", source)
	require.False(t, ok)
}

func TestRandomBucket_InRange(t *testing.T) {
	t.Parallel()
	for range 1000 {
		b := randomBucket()
		require.Less(t, b, uint32(rolloutBucketScale))
	}
}
