package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
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
			RouterOptions: responseCacheOptions(t, time.Minute),
			// The default is what mood has to beat: employees sends no Cache-Control,
			// so on a cache hit it is otherwise the only policy left in play.
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			firstMaxAge := maxAgeFrom(t, first.Response.Header.Get("Cache-Control"))
			require.Positive(t, firstMaxAge)
			require.LessOrEqual(t, firstMaxAge, 60, "mood's 60 must beat the 300 default")

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the mood fetch must have been served from the cache")

			// Without the TTL reaching the policy only the 300 default would be left,
			// and the client would be told to cache five times too long.
			cacheControl := second.Response.Header.Get("Cache-Control")
			secondMaxAge := maxAgeFrom(t, cacheControl)
			require.Positive(t, secondMaxAge)
			require.LessOrEqual(t, secondMaxAge, 60)

			// employees falls back to the default, which does not say public, so
			// the response isn't public even though the cached mood entry is.
			require.NotContains(t, cacheControl, "public")
		})
	})

	t.Run("the reported lifetime shrinks as the entry ages", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
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
				return maxAgeFrom(t, res.Response.Header.Get("Cache-Control")) <= 8
			}, 6*time.Second, 250*time.Millisecond,
				"the reported max-age should fall as the cached entry ages")

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entry should not have expired while this was polling")
		})
	})

	t.Run("no-store elsewhere still overrides a cached fetch", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
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

	t.Run("a stored miss reports the lifetime it was stored with", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, 30*time.Second),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				// No max-age: stored for the 30s fallback.
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			// The default fills the max-age mood left out; shared caches keep what
			// was stored. No public: employees' default does not grant it.
			require.Equal(t, "max-age=300, s-maxage=30", first.Response.Header.Get("Cache-Control"))
		})
	})

	t.Run("s-maxage alone reaches the client without a max-age", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: headersMiddleware("Cache-Control", "s-maxage=300", "Age", "240")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, "s-maxage=60", first.Response.Header.Get("Cache-Control"))

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			cc := second.Response.Header.Get("Cache-Control")
			require.Equal(t, -1, maxAgeFrom(t, cc), "a hit makes up no max-age either: %q", cc)
			require.LessOrEqual(t, sMaxAgeFrom(t, cc), 60)
			require.Greater(t, sMaxAgeFrom(t, cc), 0)
		})
	})

	t.Run("a public fallback reaches shared caches only", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, 30*time.Second),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, "s-maxage=30, public", first.Response.Header.Get("Cache-Control"))

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			cc := second.Response.Header.Get("Cache-Control")
			require.Equal(t, -1, maxAgeFrom(t, cc), "%q", cc)
			require.LessOrEqual(t, sMaxAgeFrom(t, cc), 30)
			require.Contains(t, cc, "public")
		})
	})

	t.Run("field-specific no-cache keeps the lifetime", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware(`public, max-age=60, no-cache="Set-Cookie"`)},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, `max-age=60, no-cache="Set-Cookie", public`, first.Response.Header.Get("Cache-Control"))

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.Greater(t, maxAgeFrom(t, second.Response.Header.Get("Cache-Control")), 0)
		})
	})

	t.Run("Age shortens the stored lifetime", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: headersMiddleware("Cache-Control", "public, max-age=45", "Age", "40")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, "max-age=5", first.Response.Header.Get("Cache-Control"))

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.LessOrEqual(t, maxAgeFrom(t, second.Response.Header.Get("Cache-Control")), 5)
		})
	})

	t.Run("a response that arrived stale is neither stored nor kept by the client", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: headersMiddleware("Cache-Control", "public, max-age=10", "Age", "30")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, "no-cache", res.Response.Header.Get("Cache-Control"))
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("field-specific no-cache is stored", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware(`public, max-age=60, no-cache="Set-Cookie"`)},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("a cache hit emits nothing without a cache control policy", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
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

// TestResponseCacheClientCacheControlFromEntries covers what a hit tells the
// client, and request directives that bypass or skip the cache.
func TestResponseCacheClientCacheControlFromEntries(t *testing.T) {
	t.Parallel()

	moodCached := testenv.SubgraphsConfig{
		Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
	}
	policy := config.CacheControlPolicy{Enabled: true, Value: "max-age=300"}

	t.Run("a hit does not stretch max-age to s-maxage", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
			CacheControlPolicy: policy,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60, s-maxage=600")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			hit := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.LessOrEqual(t, maxAgeFrom(t, hit.Response.Header.Get("Cache-Control")), 60,
				"browsers must not keep it longer than the subgraph's max-age")
			require.Contains(t, hit.Response.Header.Get("Cache-Control"), "s-maxage=", "shared caches keep the longer life")
		})
	})

	t.Run("a hit is not made public when the subgraph did not say so", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions:      responseCacheOptions(t, time.Minute),
			CacheControlPolicy: policy,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			miss := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			hit := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.Equal(t, "max-age=60", miss.Response.Header.Get("Cache-Control"))
			require.NotContains(t, hit.Response.Header.Get("Cache-Control"), "public",
				"a hit should say what the miss said")
		})
	})

	for _, tc := range []struct {
		name   string
		header http.Header
	}{
		{name: "request max-age=0 revalidates", header: http.Header{"Cache-Control": {"max-age=0"}}},
		{name: "request Pragma: no-cache revalidates", header: http.Header{"Pragma": {"no-cache"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: responseCacheOptions(t, time.Minute),
				Subgraphs:     moodCached,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: tc.header})
				require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
			})
		})
	}

	t.Run("max-age=0 with no-store neither reads nor writes", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs:     moodCached,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			bypass := testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"Cache-Control": {"max-age=0, no-store"}}}
			xEnv.MakeGraphQLRequestOK(bypass)
			xEnv.MakeGraphQLRequestOK(bypass)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "the first wrote an entry, or the second read one")
		})
	})

	t.Run("a no-store request does not report its answer as stored", func(t *testing.T) {
		t.Parallel()
		exporter := tracetest.NewInMemoryExporter(t)
		cfg := responseCacheConfig(t, time.Minute)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs:     moodCached,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"Cache-Control": {"no-store"}}})
			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries, "no-store wrote an entry")

			attrs := attribute.NewSet(fetchSpanFor(t, exporter, "mood").Attributes()...)
			decision, _ := attrs.Value(otel.WgResponseCacheStoreDecision)
			require.NotEqual(t, "stored", decision.AsString(), "the span reports a write that never happened")
		})
	})

	t.Run("only-if-cached answers from the cache or with 504", func(t *testing.T) {
		t.Parallel()
		// Every fetch cached: an uncached one would refuse the warm request too.
		allCached := testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			Mood:      testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
		}
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs:     allCached,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			onlyIfCached := testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"Cache-Control": {"only-if-cached"}}}
			// The router client retries a 504.
			body, err := json.Marshal(onlyIfCached)
			require.NoError(t, err)
			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(body))
			require.NoError(t, err)
			req.Header = onlyIfCached.Header.Clone()
			cold, err := testenv.MakeGraphQLRequestRawFromClient(req, http.DefaultClient)
			require.NoError(t, err)
			require.Equal(t, http.StatusGatewayTimeout, cold.Response.StatusCode)
			require.Contains(t, cold.Body, "only-if-cached")
			require.Zero(t, xEnv.SubgraphRequestCount.Employees.Load())
			require.Zero(t, xEnv.SubgraphRequestCount.Mood.Load())

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			warm := xEnv.MakeGraphQLRequestOK(onlyIfCached)
			require.Equal(t, http.StatusOK, warm.Response.StatusCode)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// no-cache, no-store bypass the cache: nothing stored is acceptable.
			req, err = http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(body))
			require.NoError(t, err)
			req.Header = http.Header{"Cache-Control": {"only-if-cached, no-cache, no-store"}}
			bypassed, err := testenv.MakeGraphQLRequestRawFromClient(req, http.DefaultClient)
			require.NoError(t, err)
			require.Equal(t, http.StatusGatewayTimeout, bypassed.Response.StatusCode)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})
}

// headersMiddleware makes a subgraph answer with the given name, value pairs.
// An empty value sets nothing.
func headersMiddleware(pairs ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for i := 0; i+1 < len(pairs); i += 2 {
				if pairs[i+1] != "" {
					w.Header().Set(pairs[i], pairs[i+1])
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// maxAgeFrom returns the max-age of a Cache-Control header, or -1 when it has none.
func maxAgeFrom(t *testing.T, header string) int {
	t.Helper()
	return deltaSecondsFrom(t, header, "max-age")
}

// sMaxAgeFrom returns the s-maxage of a Cache-Control header, or -1 when it has none.
func sMaxAgeFrom(t *testing.T, header string) int {
	t.Helper()
	return deltaSecondsFrom(t, header, "s-maxage")
}

func deltaSecondsFrom(t *testing.T, header, directive string) int {
	t.Helper()

	for part := range strings.SplitSeq(header, ",") {
		value, ok := strings.CutPrefix(strings.TrimSpace(part), directive+"=")
		if !ok {
			continue
		}
		seconds, err := strconv.Atoi(value)
		require.NoError(t, err, "unparsable %s in %q", directive, header)
		return seconds
	}
	return -1
}
