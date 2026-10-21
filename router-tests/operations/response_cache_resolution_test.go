package integration

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

func TestResponseCacheStoresOnlyResolvedResponses(t *testing.T) {
	t.Parallel()

	// employees is a list; a string there fails resolution.
	const malformedRoot = `{"data":{"employees":"oops"}}`
	// currentMood is an enum; a number fails resolution.
	malformedMoods := `{"data":{"_entities":[` + strings.Repeat(`{"__typename":"Employee","currentMood":5},`, 9) +
		`{"__typename":"Employee","currentMood":5}]}}`

	for _, tc := range []struct {
		name      string
		subgraphs testenv.SubgraphsConfig
		query     string
		calls     func(*testenv.Environment) int64
		want      int64
		valid     bool
	}{
		{
			name:      "a well-formed response is cached",
			valid:     true,
			subgraphs: testenv.SubgraphsConfig{Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")}},
			query:     `query { employees { id } }`,
			calls:     func(xEnv *testenv.Environment) int64 { return xEnv.SubgraphRequestCount.Employees.Load() },
			want:      1,
		},
		{
			name:      "a malformed root response is not cached",
			subgraphs: testenv.SubgraphsConfig{Employees: testenv.SubgraphConfig{Middleware: fixedResponseMiddleware("public, max-age=60", malformedRoot)}},
			query:     `query { employees { id } }`,
			calls:     func(xEnv *testenv.Environment) int64 { return xEnv.SubgraphRequestCount.Employees.Load() },
			want:      2,
		},
		{
			name:      "a malformed entity is not cached",
			subgraphs: testenv.SubgraphsConfig{Mood: testenv.SubgraphConfig{Middleware: fixedResponseMiddleware("public, max-age=60", malformedMoods)}},
			query:     moodQuery,
			calls:     func(xEnv *testenv.Environment) int64 { return xEnv.SubgraphRequestCount.Mood.Load() },
			want:      2,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(responseCacheConfig(t, time.Minute))},
				Subgraphs:     tc.subgraphs,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for range 2 {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: tc.query})
					require.NoError(t, err)
					if tc.valid {
						require.NotContains(t, res.Body, `"errors"`)
					} else {
						require.Contains(t, res.Body, `"errors"`)
					}
				}
				require.EqualValues(t, tc.want, tc.calls(xEnv))
			})
		})
	}
}
