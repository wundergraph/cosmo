package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

type fetchCacheTrace struct {
	Status        string `json:"status"`
	StoreDecision string `json:"store_decision"`
	CacheControl  string `json:"cache_control"`
	Entries       []struct {
		Found         bool            `json:"found"`
		Served        bool            `json:"served"`
		Written       bool            `json:"written"`
		TypeName      string          `json:"type_name"`
		DeclaredTags  []string        `json:"declared_tags"`
		SurrogateKeys []string        `json:"surrogate_keys"`
		Value         json.RawMessage `json:"value"`
	} `json:"entries"`
}

type requestCacheTrace struct {
	SurrogateKeys []string `json:"surrogate_keys"`
	Details       struct {
		TagHeader *struct {
			Name    string   `json:"name"`
			Outcome string   `json:"outcome"`
			Emitted bool     `json:"emitted"`
			Dropped []string `json:"dropped"`
		} `json:"tag_header"`
		Invalidation struct {
			CacheTag bool   `json:"cache_tag"`
			Endpoint string `json:"endpoint"`
		} `json:"invalidation"`
	} `json:"details"`
}

// responseCacheTraces is the request's cache trace and each fetch's, keyed by subgraph.
func responseCacheTraces(t *testing.T, body string) (*requestCacheTrace, map[string]fetchCacheTrace) {
	t.Helper()
	var res struct {
		Extensions struct {
			Trace struct {
				ResponseCache *requestCacheTrace `json:"response_cache"`
				Fetches       json.RawMessage    `json:"fetches"`
			} `json:"trace"`
		} `json:"extensions"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &res))

	fetches := map[string]fetchCacheTrace{}
	var walk func(node map[string]any)
	walk = func(node map[string]any) {
		if fetch, ok := node["fetch"].(map[string]any); ok {
			if trace, ok := fetch["trace"].(map[string]any); ok && trace["response_cache"] != nil {
				raw, err := json.Marshal(trace["response_cache"])
				require.NoError(t, err)
				var parsed fetchCacheTrace
				require.NoError(t, json.Unmarshal(raw, &parsed))
				fetches[fetch["source_name"].(string)] = parsed
			}
		}
		children, _ := node["children"].([]any)
		for _, child := range children {
			walk(child.(map[string]any))
		}
	}
	var root map[string]any
	require.NoError(t, json.Unmarshal(res.Extensions.Trace.Fetches, &root))
	walk(root)
	return res.Extensions.Trace.ResponseCache, fetches
}

func TestResponseCacheTrace(t *testing.T) {
	t.Parallel()

	traced := func(options ...string) testenv.GraphQLRequest {
		if len(options) == 0 {
			options = []string{"true"}
		}
		return testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"X-WG-Trace": options}}
	}

	traceOptions := func(t *testing.T) []core.Option {
		return memoryCacheOptions(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.TagHeader = config.ResponseCacheTagHeaderConfig{Enabled: true, Name: "Cache-Tag", Delimiter: ",", MaxBytes: 16384}
			cfg.Invalidation.Endpoint = config.ResponseCacheInvalidationEndpointConfig{Enabled: true, ListenAddr: "localhost:0", Path: "/invalidation", SharedKey: "0123456789abcdef0123456789abcdef"}
		})
	}

	t.Run("a miss shows what was written, the hit after it what was served", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: traceOptions(t),
			Subgraphs:     tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(traced())
			require.Equal(t, "MISS", first.Response.Header.Get(core.ResponseCacheStatusHeader))
			request, fetches := responseCacheTraces(t, first.Body)

			mood := fetches["mood"]
			require.Equal(t, "miss", mood.Status)
			require.Equal(t, "stored", mood.StoreDecision)
			require.Equal(t, "public, max-age=60", mood.CacheControl)
			require.NotEmpty(t, mood.Entries)
			for _, entry := range mood.Entries {
				require.False(t, entry.Found)
				require.True(t, entry.Written)
				require.Equal(t, "Employee", entry.TypeName)
				require.Contains(t, entry.DeclaredTags, "moods")
				require.NotEmpty(t, entry.Value)
			}

			require.NotNil(t, request)
			require.Contains(t, request.SurrogateKeys, "subgraph-mood")
			require.NotNil(t, request.Details.TagHeader)
			require.Equal(t, "Cache-Tag", request.Details.TagHeader.Name)
			require.Equal(t, "complete", request.Details.TagHeader.Outcome)
			require.True(t, request.Details.TagHeader.Emitted)
			require.True(t, request.Details.Invalidation.CacheTag)
			require.Equal(t, "http://localhost:0/invalidation", request.Details.Invalidation.Endpoint)

			second := xEnv.MakeGraphQLRequestOK(traced())
			require.Equal(t, "HIT", second.Response.Header.Get(core.ResponseCacheStatusHeader))
			_, fetches = responseCacheTraces(t, second.Body)
			mood = fetches["mood"]
			require.Equal(t, "hit", mood.Status)
			require.Empty(t, mood.CacheControl)
			for _, entry := range mood.Entries {
				require.True(t, entry.Found)
				require.True(t, entry.Served)
				require.False(t, entry.Written)
				require.Contains(t, entry.DeclaredTags, "moods")
			}
		})
	})

	t.Run("a truncated tag header names what it dropped", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: memoryCacheOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				cfg.TagHeader = config.ResponseCacheTagHeaderConfig{Enabled: true, Name: "Cache-Tag", Delimiter: ",", MaxBytes: len("subgraph-employees")}
			}),
			Subgraphs: tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(traced())
			require.Equal(t, "subgraph-employees", res.Response.Header.Get("Cache-Tag"))
			request, _ := responseCacheTraces(t, res.Body)
			require.Equal(t, "truncated", request.Details.TagHeader.Outcome)
			require.Contains(t, request.Details.TagHeader.Dropped, "subgraph-mood")
			require.NotContains(t, request.Details.TagHeader.Dropped, "subgraph-employees")
		})
	})

	t.Run("excluded, there is no cache trace", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: traceOptions(t),
			Subgraphs:     tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(traced("exclude_response_cache"))
			request, fetches := responseCacheTraces(t, res.Body)
			require.Nil(t, request)
			require.Empty(t, fetches)
		})
	})

	t.Run("excluded output leaves the cached values out", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: traceOptions(t),
			Subgraphs:     tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(traced("exclude_output"))
			_, fetches := responseCacheTraces(t, res.Body)
			require.NotEmpty(t, fetches["mood"].Entries)
			for _, entry := range fetches["mood"].Entries {
				require.Empty(t, entry.Value)
				require.Equal(t, "Employee", entry.TypeName, "read before the value is left out")
			}
		})
	})

	t.Run("without tracing there is no trace, and the status header still is", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: traceOptions(t),
			Subgraphs:     tagHeaderSubgraphs(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.NotContains(t, res.Body, `"response_cache"`)
			require.Equal(t, "MISS", res.Response.Header.Get(core.ResponseCacheStatusHeader))
		})
	})

	t.Run("no status header unless cache debug headers are on", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: traceOptions(t),
			Subgraphs:     tagHeaderSubgraphs(),
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.Debug.EnableCacheResponseHeaders = false
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Empty(t, res.Response.Header.Values(core.ResponseCacheStatusHeader))
		})
	})
}
