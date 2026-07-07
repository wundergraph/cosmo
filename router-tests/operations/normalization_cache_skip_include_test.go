package integration

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// The ENG-9772 scenario: $flag is used BOTH as the isAvailable argument AND as
// the @include condition, so normalization must keep it in the operation and in
// the request variables.
const (
	dualUseSkipIncludeQuery     = `mutation Repro($employeeID: Int!, $flag: Boolean!) { updateAvailability(employeeID: $employeeID, isAvailable: $flag) { id isAvailable @include(if: $flag) } }`
	dualUseSkipIncludeVariables = `{"employeeID":3,"flag":true}`
	dualUseSkipIncludeExpected  = `{"data":{"updateAvailability":{"id":3,"isAvailable":true}}}`
)

// availabilityStub replaces the availability subgraph: the real updateAvailability
// resolver needs NATS, and the scenarios under test are entirely router-side.
func availabilityStub() testenv.SubgraphsConfig {
	return testenv.SubgraphsConfig{
		Availability: testenv.SubgraphConfig{
			Middleware: func(_ http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(dualUseSkipIncludeExpected))
				})
			},
		},
	}
}

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

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
			c.Debug.EnableNormalizationCacheResponseHeader = true
			c.Debug.SynchronousCacheWrites = true
		},
		Subgraphs: availabilityStub(),
	}, func(t *testing.T, xEnv *testenv.Environment) {
		makeRequest := func() (*testenv.TestResponse, error) {
			return xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     dualUseSkipIncludeQuery,
				Variables: []byte(dualUseSkipIncludeVariables),
			})
		}

		res, err := makeRequest()
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, dualUseSkipIncludeExpected, res.Body)

		res, err = makeRequest()
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, dualUseSkipIncludeExpected, res.Body)
	})
}

// TestPersistedOperationCacheHitWithIncludeVariableAlsoUsedAsArgument covers the
// ENG-9772 scenario on the persisted operation path: after registering the
// operation via APQ, hash-only requests are served from the persisted operation
// normalization cache (handleFoundPersistedOperationEntry), which must not strip
// the dual-use variable from the request variables.
func TestPersistedOperationCacheHitWithIncludeVariableAlsoUsedAsArgument(t *testing.T) {
	t.Parallel()

	sum := sha256.Sum256([]byte(dualUseSkipIncludeQuery))
	extensions := fmt.Sprintf(`{"persistedQuery": {"version": 1, "sha256Hash": %q}}`, hex.EncodeToString(sum[:]))

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
			c.Debug.EnablePersistedOperationsCacheResponseHeader = true
			c.Debug.SynchronousCacheWrites = true
		},
		ApqConfig: config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache: config.AutomaticPersistedQueriesCacheConfig{
				Size: 1024 * 1024,
			},
		},
		Subgraphs: availabilityStub(),
	}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "dual-use-client")

		// Register the operation via APQ with the full query body.
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         dualUseSkipIncludeQuery,
			OperationName: []byte(`"Repro"`),
			Variables:     []byte(dualUseSkipIncludeVariables),
			Extensions:    []byte(extensions),
			Header:        header,
		})
		require.NoError(t, err)
		require.Equal(t, dualUseSkipIncludeExpected, res.Body)

		// Repeated hash-only requests must keep succeeding with the variable intact.
		for i := 0; i < 2; i++ {
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Repro"`),
				Variables:     []byte(dualUseSkipIncludeVariables),
				Extensions:    []byte(extensions),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, dualUseSkipIncludeExpected, res.Body)
		}
	})
}

// TestCacheWarmupWithIncludeVariableAlsoUsedAsArgument covers the ENG-9772
// scenario with the cache warmer enabled: the dual-use operation is warmed at
// startup (without variables, so the warmed entry is keyed by the absent
// skip/include values) and real requests must still work through the regular
// normalization cache miss/hit sequence afterwards.
func TestCacheWarmupWithIncludeVariableAlsoUsedAsArgument(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
				Enabled: true,
				Source: config.CacheWarmupSource{
					Filesystem: &config.CacheWarmupFileSystemSource{
						Path: "testdata/cache_warmup/skip_include_dual_use",
					},
				},
			}),
		},
		ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
			c.Debug.EnableNormalizationCacheResponseHeader = true
			c.Debug.SynchronousCacheWrites = true
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		},
		Subgraphs: availabilityStub(),
	}, func(t *testing.T, xEnv *testenv.Environment) {
		// The warmup must have processed the dual-use operation without errors.
		// One warmup pass runs per graph mux (base graph and feature flag).
		completed := xEnv.Observer().FilterMessage("Warmup completed").All()
		require.NotEmpty(t, completed)
		for _, entry := range completed {
			require.EqualValues(t, 1, entry.ContextMap()["processed_items"])
		}
		require.Empty(t, xEnv.Observer().FilterMessage("Failed to process operation, skipping").All())

		makeRequest := func() (*testenv.TestResponse, error) {
			return xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     dualUseSkipIncludeQuery,
				Variables: []byte(dualUseSkipIncludeVariables),
			})
		}

		// The warmed entry was stored without variable values, so a request with
		// $flag set takes the regular miss path first — and must succeed.
		res, err := makeRequest()
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, dualUseSkipIncludeExpected, res.Body)

		res, err = makeRequest()
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, dualUseSkipIncludeExpected, res.Body)
	})
}
