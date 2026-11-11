package integration

import (
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestResponseCacheInvalidationReach covers writes of fetches in flight when an
// invalidation ran.
func TestResponseCacheInvalidationReach(t *testing.T) {
	t.Parallel()

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
