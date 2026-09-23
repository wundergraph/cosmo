package integration

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// responseCacheTagHeaderOptions is responseCacheOptions with the header on, after
// mutate has had its say on the whole configuration.
func responseCacheTagHeaderOptions(t *testing.T, mutate func(*config.ResponseCacheConfiguration)) []core.Option {
	t.Helper()

	cfg := responseCacheConfig(t, time.Minute)
	// Set explicitly: envDefault only reaches config parsed from yaml.
	cfg.TagHeader = config.ResponseCacheTagHeaderConfig{
		Enabled:   true,
		Name:      "Cache-Tag",
		Delimiter: ",",
		MaxBytes:  16384,
	}
	if mutate != nil {
		mutate(cfg)
	}
	return []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)}
}

// Both subgraphs cacheable and tagged, so a response carries every tier.
func tagHeaderSubgraphs() testenv.SubgraphsConfig {
	return testenv.SubgraphsConfig{
		Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
		Mood:      testenv.SubgraphConfig{Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch)},
	}
}

func surrogateKeysOf(t *testing.T, header, delimiter string) []string {
	t.Helper()
	require.NotEmpty(t, header)
	return strings.Split(header, delimiter)
}

func TestResponseCacheTagHeader(t *testing.T) {
	t.Parallel()

	t.Run("a miss and the hit after it carry the same header", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheTagHeaderOptions(t, nil),
			Subgraphs:     tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load())

			surrogateKeys := surrogateKeysOf(t, first.Response.Header.Get("Cache-Tag"), ",")

			// Coarsest first: every subgraph surrogateKey, then every type surrogateKey, then the rest.
			require.Equal(t, []string{"subgraph-employees", "subgraph-mood", "type-mood-Employee"}, surrogateKeys[:3])
			require.Contains(t, surrogateKeys, "moods")
			require.Contains(t, surrogateKeys, "employee-1")
			require.Contains(t, surrogateKeys, "employee-10")
			require.NotContains(t, surrogateKeys, "type-employees-Employee", "a root fetch has no single typename")

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the second request must be served from the cache")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load())

			require.Equal(t, first.Response.Header.Get("Cache-Tag"), second.Response.Header.Get("Cache-Tag"),
				"a hit rebuilds the header from what was stored with the entry")
			require.Equal(t, first.Body, second.Body)
		})
	})

	t.Run("off by default", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs:     tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Empty(t, res.Response.Header.Values("Cache-Tag"))
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "caching itself is unaffected")
		})
	})

	t.Run("an uncacheable response has no header", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheTagHeaderOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id } }`})
			require.Empty(t, res.Response.Header.Values("Cache-Tag"))
		})
	})

	t.Run("the header does not need any invalidation index", func(t *testing.T) {
		t.Parallel()

		var prefix string
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheTagHeaderOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				prefix = cfg.KeyPrefix
				cfg.Invalidation = config.ResponseCacheInvalidationConfig{}
			}),
			Subgraphs: tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			surrogateKeys := surrogateKeysOf(t, first.Response.Header.Get("Cache-Tag"), ",")
			require.Contains(t, surrogateKeys, "subgraph-mood")
			require.Contains(t, surrogateKeys, "type-mood-Employee")
			require.Contains(t, surrogateKeys, "employee-1")

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.Equal(t, first.Response.Header.Get("Cache-Tag"), second.Response.Header.Get("Cache-Tag"))

			entries, tags := responseCacheStored(t, prefix)
			require.NotEmpty(t, entries)
			require.Empty(t, tags, "no index was asked for, and the header did not need one")
		})
	})

	t.Run("the header name and delimiter are what is configured", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheTagHeaderOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				cfg.TagHeader.Name = "Surrogate-Key"
				cfg.TagHeader.Delimiter = " "
			}),
			Subgraphs: tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Empty(t, res.Response.Header.Values("Cache-Tag"))

			surrogateKeys := surrogateKeysOf(t, res.Response.Header.Get("Surrogate-Key"), " ")
			require.Contains(t, surrogateKeys, "subgraph-mood")
			require.Contains(t, surrogateKeys, "employee-1")
		})
	})

	t.Run("max_bytes keeps the coarsest surrogate keys that fit", func(t *testing.T) {
		t.Parallel()

		const maxBytes = 40

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheTagHeaderOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				cfg.TagHeader.MaxBytes = maxBytes
			}),
			Subgraphs: tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			header := res.Response.Header.Get("Cache-Tag")
			require.LessOrEqual(t, len(header), maxBytes)
			require.Equal(t, "subgraph-employees,subgraph-mood", header,
				"every subgraph surrogate key fits, no type surrogate key does")
		})
	})

	t.Run("deduplicated inbound requests all carry the header", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: append(responseCacheTagHeaderOptions(t, nil),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					EnableInboundRequestDeduplication: true,
				})),
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: 100 * time.Millisecond,
				Employees:   testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
				Mood:        testenv.SubgraphConfig{Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch)},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const n = 10
			headers := make([]string, n)
			var ready, done sync.WaitGroup
			ready.Add(n)
			done.Add(n)
			trigger := make(chan struct{})
			for i := 0; i < n; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
					headers[i] = res.Response.Header.Get("Cache-Tag")
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			require.Less(t, xEnv.SubgraphRequestCount.Mood.Load(), int64(n), "some requests must have been followers")
			for i, header := range headers {
				require.Contains(t, surrogateKeysOf(t, header, ","), "employee-1", "request %d", i)
				require.Equal(t, headers[0], header, "request %d", i)
			}
		})
	})

	t.Run("a deduplicated response with a subgraph error carries the header on no request", func(t *testing.T) {
		t.Parallel()

		// The leader withholds the header because its context carries the
		// error. A follower's context carries none: it must get no tags to
		// emit either, or the same errored bytes go out advertised as cacheable.
		testenv.Run(t, &testenv.Config{
			RouterOptions: append(responseCacheTagHeaderOptions(t, nil),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					EnableInboundRequestDeduplication: true,
				})),
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: 100 * time.Millisecond,
				Employees:   testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
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
			const n = 10
			results := make([]*testenv.TestResponse, n)
			var ready, done sync.WaitGroup
			ready.Add(n)
			done.Add(n)
			trigger := make(chan struct{})
			for i := 0; i < n; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: moodQuery})
					require.NoError(t, err)
					results[i] = res
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			require.Less(t, xEnv.SubgraphRequestCount.Mood.Load(), int64(n), "some requests must have been followers")

			noStore := 0
			for i, res := range results {
				require.Contains(t, res.Body, `"errors"`, "request %d", i)
				require.Equal(t, results[0].Body, res.Body, "request %d", i)
				require.Empty(t, res.Response.Header.Values("Cache-Tag"), "request %d", i)
				if strings.Contains(res.Response.Header.Get("Cache-Control"), "no-store") {
					noStore++
				}
			}
			require.GreaterOrEqual(t, noStore, 1, "the leader marks the errored body no-store")
		})
	})

	t.Run("the in memory provider keeps surrogate keys too", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheTagHeaderOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				cfg.Storage = config.ResponseCacheStorageConfig{
					Provider:   config.ResponseCacheStorageProviderMemory,
					MaxEntries: 1000,
				}
			}),
			Subgraphs: tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			require.Contains(t, surrogateKeysOf(t, first.Response.Header.Get("Cache-Tag"), ","), "employee-1")
			require.Equal(t, first.Response.Header.Get("Cache-Tag"), second.Response.Header.Get("Cache-Tag"))
		})
	})
}
