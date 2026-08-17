package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestEntityCacheInMemory(t *testing.T) {
	t.Parallel()

	t.Run("a second identical request does not reach the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			// The bodies, not just the counter: a cache that served the wrong
			// bytes would satisfy the counter on its own.
			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"currentMood"`)

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the second request must be served from the cache")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"only the entity fetch is cached, the root fetch still runs")
		})
	})

	t.Run("the cache is off unless it is configured", func(t *testing.T) {
		t.Parallel()

		// The control for the subtest above. Without it, a passing count of 1 up
		// there could equally be the normalization cache or single flight, and
		// the test would prove nothing about entity caching.
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"with no entity cache configured every request must reach the subgraph")
		})
	})

	t.Run("a disabled cache always reaches the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithEntityCache(&config.EntityCacheConfiguration{
					Enabled: false,
					TTL:     time.Minute,
					Storage: config.EntityCacheStorageConfig{
						Provider:   config.EntityCacheStorageProviderMemory,
						MaxEntries: 1000,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("different selection sets do not share an entry", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Family: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The two queries differ only in which field of Details they ask for,
			// and both fields are family's alone: the employees subgraph's own
			// Details has forename, location, surname and pastLocations and nothing
			// else, so neither of these can be answered without reaching family.
			children := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id details { hasChildren } } }`})
			marital := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id details { maritalStatus } } }`})

			require.NotEqual(t, children.Body, marital.Body)
			require.Contains(t, children.Body, `"hasChildren"`)
			require.Contains(t, marital.Body, `"maritalStatus"`)

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Family.Load(),
				"the same entities asked for different fields must not share a cache entry")

			// And the second query is itself cached now, which is what makes the
			// count above a keying result rather than the cache simply not working.
			repeat := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id details { maritalStatus } } }`})
			require.Equal(t, marital.Body, repeat.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Family.Load())
		})
	})

	t.Run("a partially cached batch is refetched whole", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Caches employee 1 alone.
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employee(id: 1) { id currentMood } }`})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Asks for every employee. Employee 1 is cached and the rest are not,
			// and a batch is served from the cache only when every entity in it is
			// present, so this goes to the subgraph unchanged.
			all := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"one miss in a batch must send the whole batch to the subgraph")

			// Now the whole batch is cached, so the same query is a full hit.
			again := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.Equal(t, all.Body, again.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("public with no max-age is cached for the configured ttl", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"a bare public is cacheable and falls back to the configured ttl")
		})
	})

	t.Run("max-age wins over the configured ttl", func(t *testing.T) {
		t.Parallel()

		// The configured ttl is a minute and the subgraph asks for a second. If
		// the configured ttl were the one applied, the entry would still be there
		// when this gives up.
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=1"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Immediately, so it is still inside the second the subgraph asked for.
			// This is the half that fails if nothing was ever cached.
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entity should have been cached before its lifetime ran out")

			// And this is the half that fails if the configured minute were applied
			// instead of the second the subgraph named. Polled rather than slept on,
			// because the in memory cache's expiry is only granular to about a
			// second, and a fixed wait on a one second entry is exactly the shape
			// that fails once in a hundred runs.
			require.Eventually(t, func() bool {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
				return xEnv.SubgraphRequestCount.Mood.Load() >= 2
			}, 15*time.Second, 250*time.Millisecond,
				"the cached entity should have expired and been fetched again")
		})
	})

	t.Run("s-maxage wins over max-age", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, s-maxage=1, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Immediately, so it is still inside the second s-maxage asked for. This
			// is the half that fails if nothing was ever cached.
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entity should have been cached before its lifetime ran out")

			// And this is the half that fails if the max-age of sixty were applied
			// instead of the s-maxage of one. Polled rather than slept on, because
			// the in memory cache's expiry is only granular to about a second, and a
			// fixed wait on a one second entry is exactly the shape that fails once
			// in a hundred runs.
			require.Eventually(t, func() bool {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
				return xEnv.SubgraphRequestCount.Mood.Load() >= 2
			}, 15*time.Second, 250*time.Millisecond,
				"the cached entity should have expired and been fetched again")
		})
	})

	t.Run("a failed subgraph response is not cached", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: func(http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Cache-Control", "public, max-age=60")
							w.WriteHeader(http.StatusInternalServerError)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.NoError(t, err)
			require.Contains(t, first.Body, `"errors"`)

			second, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.NoError(t, err)
			require.Contains(t, second.Body, `"errors"`)

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"a failed subgraph response must not be cached however cacheable it claims to be")
		})
	})
}

// entityCacheOptions enables the entity cache on the in memory provider. ttl is
// the fallback reached only by a response that says public without saying for how
// long; a response naming its own max-age gets that instead.
func entityCacheOptions(ttl time.Duration) []core.Option {
	return []core.Option{
		core.WithEntityCache(&config.EntityCacheConfiguration{
			Enabled: true,
			TTL:     ttl,
			// Set explicitly. An empty provider means redis, which would need a
			// server these tests deliberately do not have.
			Storage: config.EntityCacheStorageConfig{
				Provider:   config.EntityCacheStorageProviderMemory,
				MaxEntries: 1000,
			},
		}),
	}
}

// cacheControlMiddleware makes a subgraph answer with the given Cache-Control.
// The header is set before the handler runs, because the handler writes the body
// and a header set after that is a header nobody receives.
func cacheControlMiddleware(value string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if value != "" {
				w.Header().Set("Cache-Control", value)
			}
			next.ServeHTTP(w, r)
		})
	}
}
