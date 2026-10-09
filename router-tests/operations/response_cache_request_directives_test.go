package integration

import (
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestResponseCacheRequestDirectives covers the Cache-Control a client sends to the router.
func TestResponseCacheRequestDirectives(t *testing.T) {
	t.Parallel()

	moodBatch := func(mood string) string {
		entity := `{"currentMood":"` + mood + `"}`
		return `{"data":{"_entities":[` + strings.Repeat(entity+",", 9) + entity + `]}}`
	}

	// Fresh per request: testenv sets headers on the map it is given.
	noCache := func() http.Header { return http.Header{"Cache-Control": []string{"no-cache"}} }
	noStore := func() http.Header { return http.Header{"Cache-Control": []string{"no-store"}} }

	t.Run("no-cache fetches past a warm entity entry and refreshes it", func(t *testing.T) {
		t.Parallel()

		mood := newSwitchableResponse("public, max-age=60", moodBatch("HAPPY"))

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: mood.middleware},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Contains(t, first.Body, `"currentMood":"HAPPY"`)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// The subgraph now answers differently, so the body tells a cached
			// answer from a fresh one.
			mood.set(moodBatch("SAD"))

			bypass := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: noCache()})
			require.Contains(t, bypass.Body, `"currentMood":"SAD"`,
				"a warm entry must not answer a no-cache request")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			third := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Contains(t, third.Body, `"currentMood":"SAD"`,
				"the no-cache request must have refreshed the entry")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"the refreshed entry must be served from the cache")
		})
	})

	t.Run("no-cache fetches past a warm root entry", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const query = `query { employees { id } }`

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load(),
				"the root fetch must be cached before the bypass is tried")

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query, Header: noCache()})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"a warm root entry must not answer a no-cache request")

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load())
		})
	})

	t.Run("no-store is served from a warm entry but stores nothing", func(t *testing.T) {
		t.Parallel()

		mood := newSwitchableResponse("public, max-age=60", moodBatch("HAPPY"))

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: mood.middleware},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: noStore()})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Contains(t, second.Body, `"currentMood":"HAPPY"`)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"the no-store request must not have stored anything")

			mood.set(moodBatch("SAD"))

			third := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: noStore()})
			require.Contains(t, third.Body, `"currentMood":"HAPPY"`,
				"a warm entry may answer a no-store request")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("no-cache keeps the variants of an earlier Vary reachable", func(t *testing.T) {
		t.Parallel()

		var vary atomic.Value
		vary.Store(varyLanguageHeader)
		middleware := func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				varyMoodMiddleware(vary.Load().(string))(next).ServeHTTP(w, r)
			})
		}

		_, opts := varyMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.Storage = config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 1000,
			}
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: middleware},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// The refresh varies on another set, which leads the record from now on.
			vary.Store(varyLanguageHeader + ", X-Region")
			refresh := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  moodQuery,
				Header: http.Header{"Cache-Control": []string{"no-cache"}, varyLanguageHeader: []string{"en"}},
			})
			requireMood(t, refresh, "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"the refreshed record must still point at the first variant")
		})
	})

	t.Run("no-cache does not join an in-flight request that reads the cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: append(responseCacheOptions(t, time.Minute),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					EnableInboundRequestDeduplication: true,
				})),
			Subgraphs: testenv.SubgraphsConfig{
				// The uncacheable root fetch keeps a request in flight for the delay.
				Employees: testenv.SubgraphConfig{Delay: 300 * time.Millisecond, Middleware: cacheControlMiddleware("no-store")},
				Mood:      testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// The leader reads mood from the warm entry once its root fetch returns.
			leader := make(chan struct{})
			go func() {
				defer close(leader)
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			}()
			time.Sleep(100 * time.Millisecond)
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: noCache()})
			<-leader

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"a no-cache request must fetch mood itself, not take the leader's answer from the cache")
		})
	})

	t.Run("no-cache with no-store neither reads nor writes", func(t *testing.T) {
		t.Parallel()

		both := http.Header{"Cache-Control": []string{"no-cache, no-store"}}
		mood := newSwitchableResponse("public, max-age=60", moodBatch("HAPPY"))

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: mood.middleware},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			mood.set(moodBatch("SAD"))

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: both})
			require.Contains(t, second.Body, `"currentMood":"SAD"`,
				"a warm entry must not answer a no-cache request")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			third := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Contains(t, third.Body, `"currentMood":"HAPPY"`,
				"the no-store request must not have replaced the entry")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})
}
