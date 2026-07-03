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
// The first request misses the cache and succeeds; ristretto's Set is buffered, so
// the entry lands shortly after, and every subsequent identical request hits the
// cache and fails until the router restarts. The test uses the debug cache response
// header to deterministically wait for the first HIT instead of sleeping.
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
			// The real updateAvailability resolver publishes to NATS, which is not
			// available here. The subgraph response is irrelevant to the bug (it is
			// about router-side normalization caching), so stub it out.
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
		makeRequest := func() *testenv.TestResponse {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     query,
				Variables: []byte(variables),
			})
			require.NoError(t, err)
			return res
		}

		// First request populates the cache (miss path) and must succeed.
		res := makeRequest()
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, expected, res.Body)

		// Repeat the identical request until the normalization cache entry lands
		// (ristretto sets are async) and we observe the first cache hit. Every
		// response — miss or hit — must return the same data as the first request.
		// Before the fix, the first cache hit instead returns:
		// Variable "$flag" of required type "Boolean!" was not provided.
		deadline := time.Now().Add(10 * time.Second)
		for {
			res := makeRequest()
			require.Equal(t, expected, res.Body)
			if res.Response.Header.Get(core.NormalizationCacheHeader) == "HIT" {
				break
			}
			require.False(t, time.Now().After(deadline), "normalization cache entry never became visible")
			time.Sleep(10 * time.Millisecond)
		}
	})
}
