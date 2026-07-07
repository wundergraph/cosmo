package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestSubgraphMergeResults(t *testing.T) {
	t.Parallel()
	t.Run("valid", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{sharedThings(numOfA: 1,numOfB: 1) {a b}}`,
			})
			require.Equal(t, `{"data":{"sharedThings":[{"a":"a-0","b":"b-0"}]}}`, res.Body)
		})
	})
	// The sharedThings list field is @shareable across the "products" and "test1"
	// subgraphs, which are fetched in parallel. When their array lengths differ the
	// merge fails, but which subgraph is named in the error depends on which parallel
	// fetch completes its merge second, so both attributions are valid.
	differingArrayLengths := []string{
		`{"errors":[{"message":"unable to merge results from subgraph products: differing array lengths"}],"data":null}`,
		`{"errors":[{"message":"unable to merge results from subgraph test1: differing array lengths"}],"data":null}`,
	}
	t.Run("first 1 second 2", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{sharedThings(numOfA: 1,numOfB: 2) {a b}}`,
			})
			require.Contains(t, differingArrayLengths, res.Body)
		})
	})
	t.Run("first 2 second 1", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{sharedThings(numOfA: 1,numOfB: 2) {a b}}`,
			})
			require.Contains(t, differingArrayLengths, res.Body)
		})
	})
	t.Run("incompatible types", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							_, err := w.Write([]byte(`{"data":{"sharedThings":[{"a":1,"b":"b-0"}]}}`))
							require.NoError(t, err)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{sharedThings(numOfA: 1,numOfB: 1) {a b}}`,
			})
			require.Contains(t, []string{
				`{"errors":[{"message":"unable to merge results from subgraph products: differing types"}],"data":null}`,
				`{"errors":[{"message":"unable to merge results from subgraph test1: differing types"}],"data":null}`,
			}, res.Body)
		})
	})
}
