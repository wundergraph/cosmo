package core

import (
	"slices"
	"testing"

	"golang.org/x/exp/constraints"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestGetRoutingUrlGroupingForCircuitBreakers(t *testing.T) {
	t.Parallel()

	t.Run("with no groupings", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "subgraph1",
					Name:       "subgraph1",
					RoutingUrl: url1,
				},
			},
		}

		result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
		require.NoError(t, err)

		require.Equal(t, []string{url1}, toKeys(result))
		require.Equal(t, result[url1], toSet("subgraph1"))
	})

	t.Run("with groupings", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		url2 := "http://localhost:8001/differentUrl"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "subgraph1-id",
					Name:       "subgraph1",
					RoutingUrl: url1,
				},
				{
					Id:         "subgraph2-id",
					Name:       "subgraph2",
					RoutingUrl: url1,
				},
				{
					Id:         "subgraph3-id",
					Name:       "subgraph3",
					RoutingUrl: url2,
				},
			},
		}

		result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
		require.NoError(t, err)

		require.Equal(t, []string{url2, url1}, toKeys(result))

		require.Equal(t, result[url1], toSet("subgraph1", "subgraph2"))
		require.Equal(t, result[url2], toSet("subgraph3"))
	})

	t.Run("validate override invalid url errors", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		url2 := "http://localhost:8001/differentUrl"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "subgraph1-id",
					Name:       "subgraph1",
					RoutingUrl: url1,
				},
				{
					Id:         "subgraph2-id",
					Name:       "subgraph2",
					RoutingUrl: url1,
				},
				{
					Id:         "subgraph3-id",
					Name:       "subgraph3",
					RoutingUrl: url2,
				},
			},
		}

		t.Run("with overrideRoutingURLConfiguration", func(t *testing.T) {
			t.Parallel()

			invalidUrl := "http://localhost:8001overrideUrl-primary"

			configuration := config.OverrideRoutingURLConfiguration{
				Subgraphs: map[string]string{
					"subgraph2": invalidUrl,
				},
			}

			_, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, configuration, config.OverridesConfiguration{})
			require.Error(t, err)
			require.ErrorContains(t, err, `failed to parse override url 'http://localhost:8001overrideUrl-primary': parse "http://localhost:8001overrideUrl-primary": invalid port ":8001overrideUrl-primary" after host`)
		})

		t.Run("with OverridesConfiguration", func(t *testing.T) {
			t.Parallel()

			invalidUrl := "http://localhost:8001overrideUrl-primary"

			configuration := config.OverridesConfiguration{
				Subgraphs: map[string]config.SubgraphOverridesConfiguration{
					"subgraph2": {
						RoutingURL: invalidUrl,
					},
				},
			}

			_, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, configuration)
			require.Error(t, err)
			require.ErrorContains(t, err, `failed to parse override url 'http://localhost:8001overrideUrl-primary': parse "http://localhost:8001overrideUrl-primary": invalid port ":8001overrideUrl-primary" after host`)
		})
	})

	t.Run("with no groupings after override", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		url2 := "http://localhost:8001/differentUrl"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "subgraph1-id",
					Name:       "subgraph1",
					RoutingUrl: url1,
				},
				{
					Id:         "subgraph2-id",
					Name:       "subgraph2",
					RoutingUrl: url1,
				},
				{
					Id:         "subgraph3-id",
					Name:       "subgraph3",
					RoutingUrl: url2,
				},
			},
		}

		t.Run("with overrideRoutingURLConfiguration", func(t *testing.T) {
			t.Parallel()

			url3Primary := "http://localhost:8001/overrideUrl-primary"

			configuration := config.OverrideRoutingURLConfiguration{
				Subgraphs: map[string]string{
					"subgraph2": url3Primary,
				},
			}

			result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, configuration, config.OverridesConfiguration{})
			require.NoError(t, err)

			require.Equal(t, []string{url2, url1, url3Primary}, toKeys(result))

			require.Equal(t, result[url1], toSet("subgraph1"))
			require.Equal(t, result[url2], toSet("subgraph3"))
			require.Equal(t, result[url3Primary], toSet("subgraph2"))
		})

		t.Run("with OverridesConfiguration", func(t *testing.T) {
			t.Parallel()

			url3Primary := "http://localhost:8001/overrideUrl-primary"

			configuration := config.OverridesConfiguration{
				Subgraphs: map[string]config.SubgraphOverridesConfiguration{
					"subgraph2": {
						RoutingURL: url3Primary,
					},
				},
			}

			result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, configuration)
			require.NoError(t, err)

			require.Equal(t, []string{url2, url1, url3Primary}, toKeys(result))

			require.Equal(t, result[url1], toSet("subgraph1"))
			require.Equal(t, result[url2], toSet("subgraph3"))
			require.Equal(t, result[url3Primary], toSet("subgraph2"))
		})

		// The following test combines both overrideRoutingURLConfiguration and OverridesConfiguration
		// where one is legacy config and one is new config.
		// The original configs url should always have the precedence
		t.Run("with both configurations", func(t *testing.T) {
			t.Parallel()

			url3Primary := "http://localhost:8001/overrideUrl-primary"
			url3Alternate := "http://localhost:8001/overrideUrl-alternate"

			legacyConfig := config.OverrideRoutingURLConfiguration{
				Subgraphs: map[string]string{
					"subgraph2": url3Primary,
				},
			}

			newConfig := config.OverridesConfiguration{
				Subgraphs: map[string]config.SubgraphOverridesConfiguration{
					"subgraph2": {
						RoutingURL: url3Alternate,
					},
				},
			}

			result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, legacyConfig, newConfig)
			require.NoError(t, err)

			require.Equal(t, []string{url2, url1, url3Alternate}, toKeys(result))

			require.Equal(t, result[url1], toSet("subgraph1"))
			require.Equal(t, result[url2], toSet("subgraph3"))
			require.Equal(t, result[url3Alternate], toSet("subgraph2"))
		})
	})

	t.Run("with feature flags with shared subgraphs", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		url2 := "http://localhost:8002/graphql"
		url3 := "http://localhost:8003/graphql"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "shared-subgraph-id",
					Name:       "shared-subgraph",
					RoutingUrl: url1,
				},
				{
					Id:         "base-only-subgraph-id",
					Name:       "base-only-subgraph",
					RoutingUrl: url1,
				},
				{
					Id:         "base-subgraph2-id",
					Name:       "base-subgraph2",
					RoutingUrl: url2,
				},
			},
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
					"feature1": {
						Subgraphs: []*nodev1.Subgraph{
							{
								Id:         "shared-subgraph-id",
								Name:       "shared-subgraph",
								RoutingUrl: url2,
							},
							{
								Id:         "ff-only-subgraph-id",
								Name:       "ff-only-subgraph",
								RoutingUrl: url2,
							},
							{
								Id:         "base-subgraph2-id",
								Name:       "base-subgraph2",
								RoutingUrl: url3,
							},
						},
					},
					"feature2": {
						Subgraphs: []*nodev1.Subgraph{
							{
								Id:         "shared-subgraph-id",
								Name:       "shared-subgraph",
								RoutingUrl: url3,
							},
							{
								Id:         "ff-only-subgraph-id",
								Name:       "ff-only-subgraph",
								RoutingUrl: url3,
							},
							{
								Id:         "base-only-subgraph-id",
								Name:       "base-only-subgraph",
								RoutingUrl: url2,
							},
							{
								Id:         "base-subgraph2-id",
								Name:       "base-subgraph2",
								RoutingUrl: url1,
							},
						},
					},
				},
			},
		}

		result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
		require.NoError(t, err)

		require.Equal(t, []string{url1, url2, url3}, toKeys(result))

		require.Equal(t, result[url1], toSet("shared-subgraph", "base-only-subgraph", "base-subgraph2"))
		require.Equal(t, result[url2], toSet("shared-subgraph", "ff-only-subgraph", "base-only-subgraph", "base-subgraph2"))
		require.Equal(t, result[url3], toSet("shared-subgraph", "ff-only-subgraph", "base-subgraph2"))
	})

	t.Run("with feature flags with groupings", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		url2 := "http://localhost:8002/graphql"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "common-subgraph-id",
					Name:       "common-subgraph",
					RoutingUrl: url1,
				},
				{
					Id:         "another-subgraph-id",
					Name:       "another-subgraph",
					RoutingUrl: url1,
				},
			},
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
					"feature1": {
						Subgraphs: []*nodev1.Subgraph{
							{
								Id:         "common-subgraph-id",
								Name:       "common-subgraph",
								RoutingUrl: url2,
							},
							{
								Id:         "feature-specific-subgraph-id",
								Name:       "feature-specific-subgraph",
								RoutingUrl: url2,
							},
						},
					},
					"feature2": {
						Subgraphs: []*nodev1.Subgraph{
							{
								Id:         "common-subgraph-id",
								Name:       "common-subgraph",
								RoutingUrl: url2,
							},
							{
								Id:         "feature-specific-subgraph-id",
								Name:       "feature-specific-subgraph",
								RoutingUrl: url2,
							},
							{
								Id:         "another-subgraph-id",
								Name:       "another-subgraph",
								RoutingUrl: url2,
							},
						},
					},
				},
			},
		}

		result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
		require.NoError(t, err)

		require.Equal(t, []string{url1, url2}, toKeys(result))

		require.Equal(t, result[url1], toSet("common-subgraph", "another-subgraph"))
		require.Equal(t, result[url2], toSet("common-subgraph", "feature-specific-subgraph", "another-subgraph"))
	})

	t.Run("with feature flags and overrides", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		url2 := "http://localhost:8002/graphql"
		url3 := "http://localhost:8003/graphql"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "base-subgraph1-id",
					Name:       "base-subgraph1",
					RoutingUrl: url1,
				},
				{
					Id:         "base-subgraph2-id",
					Name:       "base-subgraph2",
					RoutingUrl: url2,
				},
			},
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
					"feature1": {
						Subgraphs: []*nodev1.Subgraph{
							{
								Id:         "ff-subgraph1-id",
								Name:       "ff-subgraph1",
								RoutingUrl: url2,
							},
							{
								Id:         "base-subgraph2-id",
								Name:       "base-subgraph2",
								RoutingUrl: url3,
							},
						},
					},
					"feature2": {
						Subgraphs: []*nodev1.Subgraph{
							{
								Id:         "ff-subgraph2-id",
								Name:       "ff-subgraph2",
								RoutingUrl: url2,
							},
							{
								Id:         "ff-subgraph3-id",
								Name:       "ff-subgraph3",
								RoutingUrl: url3,
							},
							// We use the same subgraph, since it's a set it should be unique
							{
								Id:         "ff-subgraph1-id",
								Name:       "ff-subgraph1",
								RoutingUrl: url2,
							},
							{
								Id:         "base-subgraph2-id",
								Name:       "base-subgraph2",
								RoutingUrl: url1,
							},
						},
					},
				},
			},
		}

		t.Run("with overrideRoutingURLConfiguration", func(t *testing.T) {
			t.Parallel()

			url4Primary := "http://localhost:8004/overrideUrl-primary"

			configuration := config.OverrideRoutingURLConfiguration{
				Subgraphs: map[string]string{
					"ff-subgraph1": url4Primary,
				},
			}

			result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, configuration, config.OverridesConfiguration{})
			require.NoError(t, err)

			require.Equal(t, []string{url1, url2, url3, url4Primary}, toKeys(result))

			require.Equal(t, result[url1], toSet("base-subgraph1", "base-subgraph2"))
			require.Equal(t, result[url2], toSet("ff-subgraph2", "base-subgraph2"))
			require.Equal(t, result[url3], toSet("ff-subgraph3", "base-subgraph2"))
			require.Equal(t, result[url4Primary], toSet("ff-subgraph1"))
		})

		t.Run("with OverridesConfiguration", func(t *testing.T) {
			t.Parallel()

			url4Primary := "http://localhost:8004/overrideUrl-primary"

			configuration := config.OverridesConfiguration{
				Subgraphs: map[string]config.SubgraphOverridesConfiguration{
					"ff-subgraph2": {
						RoutingURL: url4Primary,
					},
				},
			}

			result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, configuration)
			require.NoError(t, err)

			require.Equal(t, []string{url1, url2, url3, url4Primary}, toKeys(result))

			require.Equal(t, result[url1], toSet("base-subgraph1", "base-subgraph2"))
			require.Equal(t, result[url2], toSet("ff-subgraph1", "base-subgraph2"))
			require.Equal(t, result[url3], toSet("ff-subgraph3", "base-subgraph2"))
			require.Equal(t, result[url4Primary], toSet("ff-subgraph2"))
		})

		t.Run("with both configurations", func(t *testing.T) {
			t.Parallel()

			url4Primary := "http://localhost:8004/overrideUrl-primary"
			url4Alternate := "http://localhost:8004/overrideUrl-alternate"

			legacyConfig := config.OverrideRoutingURLConfiguration{
				Subgraphs: map[string]string{
					"ff-subgraph1": url4Primary,
				},
			}

			newConfig := config.OverridesConfiguration{
				Subgraphs: map[string]config.SubgraphOverridesConfiguration{
					"ff-subgraph1": {
						RoutingURL: url4Alternate,
					},
				},
			}

			result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, legacyConfig, newConfig)
			require.NoError(t, err)

			require.Equal(t, []string{url1, url2, url3, url4Alternate}, toKeys(result))

			require.Equal(t, result[url1], toSet("base-subgraph1", "base-subgraph2"))
			require.Equal(t, result[url2], toSet("ff-subgraph2", "base-subgraph2"))
			require.Equal(t, result[url3], toSet("ff-subgraph3", "base-subgraph2"))
			require.Equal(t, result[url4Alternate], toSet("ff-subgraph1"))
		})
	})

	t.Run("validate feature flag invalid url errors", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"
		invalidUrl := "http://localhost:8001overrideUrl-primary"

		t.Run("with invalid feature flag subgraph url", func(t *testing.T) {
			t.Parallel()

			routerConfig := &nodev1.RouterConfig{
				Subgraphs: []*nodev1.Subgraph{
					{
						Id:         "base-subgraph1-id",
						Name:       "base-subgraph1",
						RoutingUrl: url1,
					},
				},
				FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
					ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
						"feature1": {
							Subgraphs: []*nodev1.Subgraph{
								{
									Id:         "ff-subgraph1-id",
									Name:       "ff-subgraph1",
									RoutingUrl: "://invalid-url",
								},
							},
						},
					},
				},
			}

			_, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
			require.Error(t, err)
			require.ErrorContains(t, err, "failed to parse subgraph url")
		})

		t.Run("with overrideRoutingURLConfiguration invalid url", func(t *testing.T) {
			t.Parallel()

			routerConfig := &nodev1.RouterConfig{
				Subgraphs: []*nodev1.Subgraph{
					{
						Id:         "base-subgraph1-id",
						Name:       "base-subgraph1",
						RoutingUrl: url1,
					},
				},
				FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
					ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
						"feature1": {
							Subgraphs: []*nodev1.Subgraph{
								{
									Id:         "ff-subgraph1-id",
									Name:       "ff-subgraph1",
									RoutingUrl: "http://localhost:8002/graphql",
								},
							},
						},
					},
				},
			}

			configuration := config.OverrideRoutingURLConfiguration{
				Subgraphs: map[string]string{
					"ff-subgraph1": invalidUrl,
				},
			}

			_, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, configuration, config.OverridesConfiguration{})
			require.Error(t, err)
			require.ErrorContains(t, err, `failed to parse override url 'http://localhost:8001overrideUrl-primary': parse "http://localhost:8001overrideUrl-primary": invalid port ":8001overrideUrl-primary" after host`)
		})

		t.Run("with OverridesConfiguration invalid url", func(t *testing.T) {
			t.Parallel()

			routerConfig := &nodev1.RouterConfig{
				Subgraphs: []*nodev1.Subgraph{
					{
						Id:         "base-subgraph1-id",
						Name:       "base-subgraph1",
						RoutingUrl: url1,
					},
				},
				FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
					ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
						"feature1": {
							Subgraphs: []*nodev1.Subgraph{
								{
									Id:         "ff-subgraph1-id",
									Name:       "ff-subgraph1",
									RoutingUrl: "http://localhost:8002/graphql",
								},
							},
						},
					},
				},
			}

			configuration := config.OverridesConfiguration{
				Subgraphs: map[string]config.SubgraphOverridesConfiguration{
					"ff-subgraph1": {
						RoutingURL: invalidUrl,
					},
				},
			}

			_, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, configuration)
			require.Error(t, err)
			require.ErrorContains(t, err, `failed to parse override url 'http://localhost:8001overrideUrl-primary': parse "http://localhost:8001overrideUrl-primary": invalid port ":8001overrideUrl-primary" after host`)
		})
	})

	t.Run("with empty feature flag configs", func(t *testing.T) {
		t.Parallel()

		url1 := "http://localhost:8001/graphql"

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{
				{
					Id:         "base-subgraph1-id",
					Name:       "base-subgraph1",
					RoutingUrl: url1,
				},
			},
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
		require.NoError(t, err)

		require.Equal(t, []string{url1}, toKeys(result))
		require.Equal(t, result[url1], toSet("base-subgraph1"))
	})

	t.Run("with empty configuration", func(t *testing.T) {
		t.Parallel()

		routerConfig := &nodev1.RouterConfig{
			Subgraphs: []*nodev1.Subgraph{},
		}

		result, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, config.OverrideRoutingURLConfiguration{}, config.OverridesConfiguration{})
		require.NoError(t, err)
		require.Empty(t, result)
	})
}

func toSet[T comparable](slice ...T) map[T]bool {
	set := make(map[T]bool, len(slice))
	for _, v := range slice {
		set[v] = true
	}
	return set
}

func toKeys[K constraints.Ordered, V any](m map[K]V) []K {
	keys := make([]K, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
