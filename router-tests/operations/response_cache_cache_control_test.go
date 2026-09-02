package integration

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// moodQuery reaches employees for the root fetch and mood for the entity fetch.
// Only the latter is response cached.
const moodQuery = `query { employees { id currentMood } }`

// TestResponseCacheClientCacheControl covers the lifetime of a cached fetch reaching
// the client. A fetch served from the cache sends no request and so has no
// Cache-Control of its own; its remaining TTL stands in for one.
func TestResponseCacheClientCacheControl(t *testing.T) {
	t.Parallel()

	t.Run("a cached fetch contributes its remaining lifetime", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			// The default is what mood has to beat: employees sends no Cache-Control,
			// so on a cache hit it is otherwise the only policy left in play.
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			firstMaxAge := maxAgeOf(t, first.Response.Header.Get("Cache-Control"))
			require.Positive(t, firstMaxAge)
			require.LessOrEqual(t, firstMaxAge, 60, "mood's 60 must beat the 300 default")

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the mood fetch must have been served from the cache")

			// Without the TTL reaching the policy only the 300 default would be left,
			// and the client would be told to cache five times too long.
			cacheControl := second.Response.Header.Get("Cache-Control")
			secondMaxAge := maxAgeOf(t, cacheControl)
			require.Positive(t, secondMaxAge)
			require.LessOrEqual(t, secondMaxAge, 60)

			// Nothing else in this request says public: employees falls back to the
			// default, which does not. So it can only have come from the cache hit.
			require.Contains(t, cacheControl, "public")
		})
	})

	t.Run("the reported lifetime shrinks as the entry ages", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(time.Minute),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=10")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// What the client is told is the life the entry has left, not the ten the
			// subgraph named. Polled rather than slept on, and it has to land before
			// the entry expires and mood is fetched again at a full ten.
			require.Eventually(t, func() bool {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				return maxAgeOf(t, res.Response.Header.Get("Cache-Control")) <= 8
			}, 6*time.Second, 250*time.Millisecond,
				"the reported max-age should fall as the cached entry ages")

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entry should not have expired while this was polling")
		})
	})

	t.Run("no-store elsewhere still overrides a cached fetch", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(time.Minute),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood:      testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
				Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("no-store")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// The TTL is handed to the most restrictive algorithm rather than written
			// straight to the response, so a no-store from another fetch still wins.
			require.Equal(t, "no-store", second.Response.Header.Get("Cache-Control"))
		})
	})

	t.Run("a cache hit emits nothing without a cache control policy", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.Empty(t, second.Response.Header.Get("Cache-Control"),
				"a cache hit must not emit a Cache-Control nobody configured")
		})
	})
}

// maxAgeOf returns the max-age of a Cache-Control header, or -1 when it has none.
func maxAgeOf(t *testing.T, header string) int {
	t.Helper()

	for _, part := range strings.Split(header, ",") {
		value, ok := strings.CutPrefix(strings.TrimSpace(part), "max-age=")
		if !ok {
			continue
		}
		seconds, err := strconv.Atoi(value)
		require.NoError(t, err, "unparsable max-age in %q", header)
		return seconds
	}
	return -1
}
