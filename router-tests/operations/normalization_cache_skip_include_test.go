package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestNormalizationCacheHitWithIncludeVariableAlsoUsedAsArgument reproduces ENG-9772:
// an operation whose Boolean variable is used BOTH as a field argument AND in an
// @include directive succeeds on the first request but fails on every normalization
// cache hit with:
//
//	Variable "$flag" of required type "Boolean!" was not provided.
//
// Root cause:
//
//   - On a cache MISS, the normalizer only strips a skip/include variable from the
//     operation and the request variables when it is not used anywhere else. A
//     dual-use variable (also a field argument) is kept in both the cached
//     normalized representation and the variables.
//   - On a cache HIT, normalizeNonPersistedOperation unconditionally deletes every
//     skip/include variable from Request.Variables. The cached normalized operation
//     still declares the variable as Boolean!, so validation fails.
//
// See also TestPersistedOperationSkipIncludeConcurrency for the related (already
// fixed) persisted-operation cache-key aliasing bug.
func TestNormalizationCacheHitWithIncludeVariableAlsoUsedAsArgument(t *testing.T) {
	t.Parallel()

	// $flag is used as the isAvailable argument AND as the @include condition.
	const query = `mutation Repro($employeeID: Int!, $flag: Boolean!) { updateAvailability(employeeID: $employeeID, isAvailable: $flag) { id isAvailable @include(if: $flag) } }`
	const variables = `{"employeeID":3,"flag":true}`
	const expected = `{"data":{"updateAvailability":{"id":3,"isAvailable":true}}}`

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
			c.Debug.EnableNormalizationCacheResponseHeader = true
		},
		Subgraphs: testenv.SubgraphsConfig{
			// Stub the subgraph: the real updateAvailability resolver needs NATS,
			// and the bug is entirely router-side.
			Availability: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						_, _ = w.Write([]byte(`{"data":{"updateAvailability":{"id":3,"isAvailable":true}}}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		makeRequest := func() (*testenv.TestResponse, error) {
			return xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     query,
				Variables: []byte(variables),
			})
		}

		// First request populates the cache (miss path) and must succeed.
		res, err := makeRequest()
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, expected, res.Body)

		// Flush the async ristretto write so the entry is visible, then repeat the
		// identical request: it must be served from the cache with the same data.
		// Before the fix, cache hits instead return:
		// Variable "$flag" of required type "Boolean!" was not provided.
		xEnv.WaitForCacheWrites()

		res, err = makeRequest()
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, expected, res.Body)
	})
}
