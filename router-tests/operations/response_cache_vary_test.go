package integration

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const varyLanguageHeader = "Accept-Language"

// varyMoodMiddleware answers the mood entity batch in the language asked for
// and says so with Vary, as a localising subgraph would.
func varyMoodMiddleware(vary string) func(http.Handler) http.Handler {
	return func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mood := "HAPPY"
			if r.Header.Get(varyLanguageHeader) == "de" {
				mood = "SAD"
			}
			entity := fmt.Sprintf(`{"__typename":"Employee","currentMood":%q}`, mood)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=60")
			if vary != "" {
				w.Header().Set("Vary", vary)
			}
			_, _ = fmt.Fprintf(w, `{"data":{"_entities":[%s]}}`, strings.Repeat(entity+",", 9)+entity)
		})
	}
}

// varyMoodConfig forwards the language header so the subgraph can vary on it.
func varyMoodConfig(t *testing.T, mutate func(cfg *config.ResponseCacheConfiguration)) (*config.ResponseCacheConfiguration, []core.Option) {
	t.Helper()

	cfg := responseCacheConfig(t, time.Minute)
	if mutate != nil {
		mutate(cfg)
	}
	return cfg, []core.Option{
		responseCacheStorageProviders(),
		core.WithResponseCache(cfg),
		core.WithHeaderRules(config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Named: varyLanguageHeader},
				},
			},
		}),
	}
}

func moodIn(t *testing.T, xEnv *testenv.Environment, language string) *testenv.TestResponse {
	t.Helper()
	req := testenv.GraphQLRequest{Query: moodQuery}
	if language != "" {
		req.Header = http.Header{varyLanguageHeader: []string{language}}
	}
	return xEnv.MakeGraphQLRequestOK(req)
}

// requireVariants checks the store holds one record per entity and the given
// number of variants under each, a variant key carrying a '+' segment.
func requireVariants(t *testing.T, prefix string, entities, variants int) {
	t.Helper()
	entries, _ := responseCacheStored(t, prefix)
	records, bodies := 0, 0
	for _, entry := range entries {
		if strings.Contains(entry, "+") {
			bodies++
		} else {
			records++
		}
	}
	require.Equal(t, entities, records, "records")
	require.Equal(t, entities*variants, bodies, "variants")
}

func TestResponseCacheVary(t *testing.T) {
	t.Parallel()

	t.Run("each header value is served its own variant", func(t *testing.T) {
		t.Parallel()

		cfg, opts := varyMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: varyMoodMiddleware("Accept-Language")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "the second request is a hit")

			requireMood(t, moodIn(t, xEnv, "en"), "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "another language is not served the first one's entry")
			requireMood(t, moodIn(t, xEnv, "en"), "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "the first variant is still there")

			requireMood(t, moodIn(t, xEnv, ""), "HAPPY")
			require.EqualValues(t, 3, xEnv.SubgraphRequestCount.Mood.Load(), "no header is a variant of its own")

			requireVariants(t, cfg.KeyPrefix, 10, 3)
		})
	})

	t.Run("without Vary one entry serves every language", func(t *testing.T) {
		t.Parallel()

		cfg, opts := varyMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: varyMoodMiddleware("")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			requireMood(t, moodIn(t, xEnv, "en"), "SAD")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "the subgraph did not say it varies")

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10)
			for _, entry := range entries {
				require.NotContains(t, entry, "+")
			}
		})
	})

	t.Run("a header the router does not forward never splits the cache", func(t *testing.T) {
		t.Parallel()

		cfg, opts := varyMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: varyMoodMiddleware("X-Region")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"X-Region": []string{"eu"}}})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"X-Region": []string{"us"}}})
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			requireVariants(t, cfg.KeyPrefix, 10, 1)
		})
	})

	t.Run("Vary: * is never cached", func(t *testing.T) {
		t.Parallel()

		cfg, opts := varyMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: varyMoodMiddleware("*")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries)
		})
	})

	t.Run("the in memory provider serves variants the same way", func(t *testing.T) {
		t.Parallel()

		_, opts := varyMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.Storage = config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 1000,
			}
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: varyMoodMiddleware("Accept-Language")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			requireMood(t, moodIn(t, xEnv, "en"), "HAPPY")
			requireMood(t, moodIn(t, xEnv, "en"), "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
			requireMood(t, moodIn(t, xEnv, "de"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})
}
