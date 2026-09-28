package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// subgraphCacheOptions is responseCacheOptions with all and subgraphs shaped by
// the caller. An entry replaces all whole, so each one spells out what it wants.
func subgraphCacheOptions(t *testing.T, all config.ResponseCacheSubgraphConfiguration, subgraphs map[string]config.ResponseCacheSubgraphConfiguration) (*config.ResponseCacheConfiguration, []core.Option) {
	t.Helper()
	cfg := responseCacheConfig(t, time.Minute)
	cfg.All = all
	cfg.Subgraphs = subgraphs
	return cfg, []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)}
}

func TestResponseCacheSubgraphs(t *testing.T) {
	t.Parallel()

	allOn := config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute}
	allOff := config.ResponseCacheSubgraphConfiguration{Enabled: false}

	t.Run("a disabled subgraph is asked every time and stores nothing", func(t *testing.T) {
		t.Parallel()

		cfg, opts := subgraphCacheOptions(t, allOn, map[string]config.ResponseCacheSubgraphConfiguration{
			"mood": {Enabled: false},
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries)
		})
	})

	t.Run("an entry for another subgraph leaves this one cached", func(t *testing.T) {
		t.Parallel()

		_, opts := subgraphCacheOptions(t, allOn, map[string]config.ResponseCacheSubgraphConfiguration{
			"employees": {Enabled: false},
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("a disabled all caches only the entries that enable it", func(t *testing.T) {
		t.Parallel()

		t.Run("with an entry", func(t *testing.T) {
			t.Parallel()
			_, opts := subgraphCacheOptions(t, allOff, map[string]config.ResponseCacheSubgraphConfiguration{
				"mood": {Enabled: true, FallbackTTL: time.Minute},
			})
			testenv.Run(t, &testenv.Config{
				RouterOptions: opts,
				Subgraphs: testenv.SubgraphsConfig{
					Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			})
		})

		t.Run("without one", func(t *testing.T) {
			t.Parallel()
			cfg, opts := subgraphCacheOptions(t, allOff, nil)
			testenv.Run(t, &testenv.Config{
				RouterOptions: opts,
				Subgraphs: testenv.SubgraphsConfig{
					Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
				entries, _ := responseCacheStored(t, cfg.KeyPrefix)
				require.Empty(t, entries)
			})
		})
	})

	t.Run("a subgraph's own fallback_ttl is the lifetime the client sees", func(t *testing.T) {
		t.Parallel()

		_, opts := subgraphCacheOptions(t, allOn, map[string]config.ResponseCacheSubgraphConfiguration{
			"mood": {Enabled: true, FallbackTTL: 5 * time.Minute},
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			// Generous, so the cached lifetime is the most restrictive policy in play.
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=3600"},
			Subgraphs: testenv.SubgraphsConfig{
				// No max-age: the fallback decides.
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			maxAge := maxAgeOf(t, second.Response.Header.Get("Cache-Control"))
			require.Greater(t, maxAge, 60, "all's minute would have been the lifetime otherwise")
			require.LessOrEqual(t, maxAge, 300)
		})
	})

	t.Run("a subgraph's own private_id scopes its private responses", func(t *testing.T) {
		t.Parallel()

		cfg, opts := privateMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.All.PrivateID = ""
			cfg.Subgraphs = map[string]config.ResponseCacheSubgraphConfiguration{
				"mood": {Enabled: true, FallbackTTL: time.Minute, PrivateID: privateUserExpression},
			}
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "the second request is a hit")

			requireMood(t, moodAs(t, xEnv, "sad"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "another user is not served the first user's entry")

			requireKeysScoped(t, cfg.KeyPrefix, 20, true)
		})
	})

	t.Run("an entry without a private_id does not inherit all's", func(t *testing.T) {
		t.Parallel()

		cfg, opts := privateMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.Subgraphs = map[string]config.ResponseCacheSubgraphConfiguration{
				"mood": {Enabled: true, FallbackTTL: time.Minute},
			}
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "no id for mood, so private is not cached")

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries)
		})
	})

	t.Run("a name the graph does not have starts and changes nothing", func(t *testing.T) {
		t.Parallel()

		_, opts := subgraphCacheOptions(t, allOn, map[string]config.ResponseCacheSubgraphConfiguration{
			"nope": {Enabled: false},
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})
}
