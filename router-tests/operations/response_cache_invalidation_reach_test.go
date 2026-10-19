package integration

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestResponseCacheInvalidationReach covers what an invalidation must reach:
// feature flag subgraphs, and writes of fetches in flight when it ran.
func TestResponseCacheInvalidationReach(t *testing.T) {
	t.Parallel()

	t.Run("a feature flag subgraph honours its base subgraph's settings", func(t *testing.T) {
		t.Parallel()
		cfg := responseCacheConfig(t, time.Minute)
		cfg.Subgraphs = map[string]config.ResponseCacheSubgraphConfiguration{"products": {Enabled: false}}
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Products:   testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
				ProductsFg: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ff := http.Header{"X-Feature-Flag": {"myff"}}
			for range 2 {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ productTypes { __typename } }`, Header: ff})
			}
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.ProductFg.Load(),
				"products is disabled; its feature flag replacement should be too")
		})
	})

	t.Run("invalidating a base subgraph reaches its feature flag subgraph", func(t *testing.T) {
		t.Parallel()
		cfg, addr := makeCacheAsConfig(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				ProductsFg: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := testenv.GraphQLRequest{Query: `{ productTypes { __typename } }`, Header: http.Header{"X-Feature-Flag": {"myff"}}}
			xEnv.MakeGraphQLRequestOK(query)
			xEnv.MakeGraphQLRequestOK(query)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.ProductFg.Load())

			status, count := invalidateCacheKey(t, addr, responseCacheSharedKey, `[{"kind":"subgraph","subgraph":"products"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Positive(t, count)

			xEnv.MakeGraphQLRequestOK(query)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.ProductFg.Load())
		})
	})

	for _, provider := range []config.ResponseCacheStorageProvider{config.ResponseCacheStorageProviderRedis, config.ResponseCacheStorageProviderMemory} {
		t.Run("a fetch in flight during an invalidation does not store its stale answer: "+string(provider), func(t *testing.T) {
			t.Parallel()
			cfg, addr := makeCacheAsConfig(t)
			opts := []core.Option{core.WithResponseCache(cfg)}
			if provider == config.ResponseCacheStorageProviderMemory {
				cfg.Storage = config.ResponseCacheStorageConfig{Provider: provider, MaxEntries: 1000}
			} else {
				opts = append(opts, responseCacheStorageProviders())
			}
			// The subgraph holds the fetch until the invalidation is in.
			reached, invalidated := make(chan struct{}), make(chan struct{})
			var once sync.Once
			testenv.Run(t, &testenv.Config{
				RouterOptions: opts,
				Subgraphs: testenv.SubgraphsConfig{
					Mood: testenv.SubgraphConfig{Middleware: func(next http.Handler) http.Handler {
						return cacheControlMiddleware("public, max-age=60")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							once.Do(func() {
								close(reached)
								<-invalidated
							})
							next.ServeHTTP(w, r)
						}))
					}},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				done := make(chan struct{})
				go func() {
					defer close(done)
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				}()
				<-reached
				status, _ := invalidateCacheKey(t, addr, responseCacheSharedKey, `[{"kind":"subgraph","subgraph":"mood"}]`)
				require.Equal(t, http.StatusAccepted, status)
				close(invalidated)
				<-done

				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "data read before the invalidation outlived it")
			})
		})
	}
}
