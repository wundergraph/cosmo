package integration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// setMyFFTrafficPercentage rewires the standard testenv `myff` feature flag
// to carry the given traffic_percentage. The myff flag swaps in a feature
// subgraph that adds a `productCount` field to Employee — when the rollout
// selector picks myff, the response includes productCount; when it falls
// through to base, the query errors with "Cannot query field productCount".
// That gives every assertion a clean rollout-vs-base discriminator without
// needing to count which goroutine got which bucket.
func setMyFFTrafficPercentage(routerConfig *nodev1.RouterConfig, pct uint32) {
	if routerConfig.FeatureFlagConfigs == nil {
		return
	}
	if myff, ok := routerConfig.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"]; ok {
		myff.TrafficPercentage = &pct
	}
}

// rolloutsEnabled returns the RouterOptions slice that turns the rollout
// selector on. Tests explicitly opt-in because testenv defaults the
// FeatureFlagRollouts.Enabled to its zero value (false).
func rolloutsEnabled() []core.Option {
	return []core.Option{
		core.WithFeatureFlagRollouts(config.FeatureFlagRollouts{Enabled: true}),
	}
}

const (
	productCountQuery = `{ employees { id productCount } }`

	// Error response when the base graph (which doesn't define productCount)
	// serves the request because the rollout selector either picked nothing
	// or the flag was 0%.
	productCountFieldError = `Cannot query field "productCount"`
)

func TestFeatureFlagRollouts(t *testing.T) {
	t.Parallel()

	t.Run("traffic_percentage 100 routes every request to the rollout flag", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 100)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for range 50 {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: productCountQuery})
				require.Equal(t, "myff", res.Response.Header.Get("X-Feature-Flag"),
					"100%% rollout must always serve the flag's variant")
				require.NotContains(t, res.Body, productCountFieldError)
			}
		})
	})

	t.Run("traffic_percentage 0 never routes to the flag", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 0)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for range 50 {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: productCountQuery})
				require.Empty(t, res.Response.Header.Get("X-Feature-Flag"),
					"0%% rollout flag must never be picked")
				require.Contains(t, res.Body, productCountFieldError)
			}
		})
	})

	t.Run("header pin targeting a rollout flag is ignored", func(t *testing.T) {
		t.Parallel()

		// myff at 0% means the rollout selector never picks it, AND the header
		// pin must be bypassed because rollout flags aren't client-steerable.
		// Net: every request falls through to base.
		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 0)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  productCountQuery,
				Header: map[string][]string{"X-Feature-Flag": {"myff"}},
			})
			require.Empty(t, res.Response.Header.Get("X-Feature-Flag"),
				"header pin on a rollout flag must be ignored — base serves the request")
			require.Contains(t, res.Body, productCountFieldError)
		})
	})

	t.Run("cookie pin targeting a rollout flag is ignored", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 0)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  productCountQuery,
				Header: map[string][]string{"Cookie": {"feature_flag=myff"}},
			})
			require.Empty(t, res.Response.Header.Get("X-Feature-Flag"),
				"cookie pin on a rollout flag must be ignored — base serves the request")
			require.Contains(t, res.Body, productCountFieldError)
		})
	})

	t.Run("flag without traffic_percentage stays preview-only — header still works", func(t *testing.T) {
		t.Parallel()

		// Selector is enabled, but myff has no traffic_percentage set, so it's
		// a preview flag and header/cookie pinning still works exactly as before.
		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  productCountQuery,
				Header: map[string][]string{"X-Feature-Flag": {"myff"}},
			})
			require.Equal(t, "myff", res.Response.Header.Get("X-Feature-Flag"))
			require.NotContains(t, res.Body, productCountFieldError)
		})
	})

	t.Run("rollouts disabled — header pin still works even with traffic_percentage set", func(t *testing.T) {
		t.Parallel()

		// FeatureFlagRollouts.Enabled = false (default). Even with a non-zero
		// traffic_percentage on myff, the selector is dormant: the flag stays
		// header/cookie-pinnable and percentage is simply ignored.
		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 50)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  productCountQuery,
				Header: map[string][]string{"X-Feature-Flag": {"myff"}},
			})
			require.Equal(t, "myff", res.Response.Header.Get("X-Feature-Flag"),
				"selector off + header pin → flag still served the legacy way")
			require.NotContains(t, res.Body, productCountFieldError)
		})
	})

	t.Run("traffic_percentage above 100 fails closed — selector disables itself", func(t *testing.T) {
		t.Parallel()

		// 200% is rejected by newRolloutSelector with a logged error and
		// returns nil — the selector is disabled, every unpinned request
		// falls through to base.
		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 200)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for range 50 {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: productCountQuery})
				require.Empty(t, res.Response.Header.Get("X-Feature-Flag"))
				require.Contains(t, res.Body, productCountFieldError)
			}
		})
	})

	t.Run("traffic_percentage 50 distributes ~50/50 across rollout and base", func(t *testing.T) {
		t.Parallel()

		// Statistical assertion. Random per-request bucketing → over many
		// samples the empirical share should land near the target with a
		// generous tolerance to avoid flake.
		testenv.Run(t, &testenv.Config{
			RouterOptions: rolloutsEnabled(),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setMyFFTrafficPercentage(routerConfig, 50)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const samples = 1000
			rolloutHits := 0
			baseHits := 0
			for range samples {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: productCountQuery})
				switch {
				case res.Response.Header.Get("X-Feature-Flag") == "myff":
					rolloutHits++
				case strings.Contains(res.Body, productCountFieldError):
					baseHits++
				default:
					t.Fatalf("unexpected response: header=%q body=%q",
						res.Response.Header.Get("X-Feature-Flag"), res.Body)
				}
			}
			require.Equal(t, samples, rolloutHits+baseHits, "every request must hit one bucket")

			// Tolerance: ±10 percentage points across 1000 samples is comfortable
			// (a true 50% Bernoulli with n=1000 has σ ≈ 1.6pp, so 10pp ≈ 6σ).
			gotRolloutPct := float64(rolloutHits) / float64(samples)
			require.InDeltaf(t, 0.50, gotRolloutPct, 0.10,
				"expected ~50%% rollout, got %.3f (rollout=%d base=%d)",
				gotRolloutPct, rolloutHits, baseHits)
		})
	})
}
