package integration

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

func TestParserLimitsAfterFragmentNormalization(t *testing.T) {
	t.Parallel()

	// The tokenizer counts eleven identifiers in the original selection sets,
	// including aliases and arguments. Inlining the nested fragments at both
	// EmployeeFields spread sites increases that count to fourteen. Explicit
	// variables keep argument extraction from changing the count in later stages.
	const query = `query Employees($first: Int!, $second: Int!) {
		a: employee(id: $first) { ...EmployeeFields }
		b: employee(id: $second) { ...EmployeeFields }
	}
	fragment EmployeeFields on Employee { id ...EmployeeDetails }
	fragment EmployeeDetails on Employee { details { forename } }`
	const successBody = `{"data":{"a":{"id":1,"details":{"forename":"Jens"}},"b":{"id":2,"details":{"forename":"Dustin"}}}}`
	const errorBody = `{"errors":[{"message":"allowed number of fields per GraphQL document of '13' exceeded"}]}`

	// Guard the regression fixture: rejection must be caused by fragment
	// expansion, not by the initial parsing of the original document.
	var input ast.Input
	input.ResetInputString(query)
	stats, err := astparser.NewTokenizer().TokenizeWithLimits(astparser.TokenizerLimits{MaxFields: 13}, &input)
	require.NoError(t, err)
	require.Equal(t, 11, stats.TotalFields)

	for _, persisted := range []bool{false, true} {
		name := "regular operation"
		if persisted {
			name = "persisted operation"
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			for _, tc := range []struct {
				name                      string
				cacheEnabled              bool
				enforceAfterNormalization bool
				fieldLimit                int
			}{
				{
					name:                      "rejects expanded fragments with cache enabled",
					cacheEnabled:              true,
					enforceAfterNormalization: true,
					fieldLimit:                13,
				},
				{
					name:                      "rejects expanded fragments with cache disabled",
					enforceAfterNormalization: true,
					fieldLimit:                13,
				},
				{
					name:                      "accepts the exact normalized field limit",
					cacheEnabled:              true,
					enforceAfterNormalization: true,
					fieldLimit:                14,
				},
				{
					name:                      "accepts the exact normalized field limit with only plan cache",
					enforceAfterNormalization: true,
					fieldLimit:                14,
				},
				{
					name:         "disabled enforcement allows expanded fragments on cache misses and hits",
					cacheEnabled: true,
					fieldLimit:   13,
				},
				{
					name:       "disabled enforcement allows expanded fragments with only plan cache",
					fieldLimit: 13,
				},
			} {
				t.Run(tc.name, func(t *testing.T) {
					t.Parallel()

					cfg := parserLimitsNormalizationConfig(config.ParserLimitsConfiguration{
						TotalFieldsLimit:          tc.fieldLimit,
						EnforceAfterNormalization: tc.enforceAfterNormalization,
					}, tc.cacheEnabled)
					request := testenv.GraphQLRequest{Query: query}
					cacheHeader := core.NormalizationCacheHeader
					if persisted {
						// Serve the same document through the persisted-operation path,
						// including requests that never populate a normalization cache.
						hash := fmt.Sprintf("%x", sha256.Sum256([]byte(query)))
						body, err := json.Marshal(map[string]any{"version": 1, "body": query})
						require.NoError(t, err)
						cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if !strings.HasSuffix(r.URL.Path, "/"+hash+".json") {
								http.NotFound(w, r)
								return
							}
							w.Header().Set("Content-Type", "application/json")
							_, _ = w.Write(body)
						}))
						t.Cleanup(cdn.Close)
						cfg.CdnSever = cdn
						request = testenv.GraphQLRequest{
							OperationName: []byte(`"Employees"`),
							Extensions:    []byte(fmt.Sprintf(`{"persistedQuery":{"version":1,"sha256Hash":%q}}`, hash)),
							Header:        http.Header{"Graphql-Client-Name": {"parser-limits"}},
						}
						cacheHeader = core.PersistedOperationCacheHeader
					}
					request.Variables = []byte(`{"first":1,"second":2}`)

					testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
						for attempt := 0; attempt < 3; attempt++ {
							res, err := xEnv.MakeGraphQLRequest(request)
							require.NoError(t, err)

							if tc.enforceAfterNormalization && tc.fieldLimit < 14 {
								require.Equal(t, http.StatusBadRequest, res.Response.StatusCode, "attempt %d", attempt)
								require.JSONEq(t, errorBody, res.Body, "attempt %d", attempt)
								require.Zero(t, xEnv.SubgraphRequestCount.Employees.Load(), "expanded fragments must be rejected before reaching the subgraph")
								continue
							}

							require.Equal(t, http.StatusOK, res.Response.StatusCode, "attempt %d: %s", attempt, res.Body)
							require.JSONEq(t, successBody, res.Body, "attempt %d", attempt)
							expectedCache := "MISS"
							if tc.cacheEnabled && attempt > 0 {
								expectedCache = "HIT"
							}
							require.Equal(t, expectedCache, res.Response.Header.Get(cacheHeader), "attempt %d", attempt)
							expectedPlanCache := "MISS"
							if attempt > 0 {
								expectedPlanCache = "HIT"
							}
							require.Equal(t, expectedPlanCache, res.Response.Header.Get(core.ExecutionPlanCacheHeader), "attempt %d", attempt)
						}
					})
				})
			}
		})
	}
}

func TestParserLimitsAfterNormalizationBoundaries(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		query      string
		limits     config.ParserLimitsConfiguration
		statusCode int
		body       string
	}{
		{
			name: "still checks the original document before unused fragments are removed",
			// Five original identifiers would shrink to four after normalization
			// removes the unused fragment and extracts the inline argument.
			query: `{ employee(id: 1) { id } } fragment Unused on Employee { details { forename } }`,
			limits: config.ParserLimitsConfiguration{
				TotalFieldsLimit: 4,
			},
			statusCode: http.StatusBadRequest,
			body:       `{"errors":[{"message":"allowed number of fields per GraphQL document of '4' exceeded"}]}`,
		},
		{
			name: "preserves the original document depth limit",
			// The original operation and fragment have cumulative depth four.
			// Inlining would reduce the normalized depth to three.
			query: `{ employee(id: 1) { ...EmployeeFields } } fragment EmployeeFields on Employee { details { forename } }`,
			limits: config.ParserLimitsConfiguration{
				ApproximateDepthLimit: 3,
			},
			statusCode: http.StatusBadRequest,
			body:       `{"errors":[{"message":"allowed parsing depth per GraphQL document of '3' exceeded"}]}`,
		},
		{
			name:       "zero keeps both parser limits disabled",
			query:      `{ employee(id: 1) { ...EmployeeFields } } fragment EmployeeFields on Employee { id details { forename } }`,
			statusCode: http.StatusOK,
			body:       `{"data":{"employee":{"id":1,"details":{"forename":"Jens"}}}}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.limits.EnforceAfterNormalization = true
			testenv.Run(t, parserLimitsNormalizationConfig(tc.limits, true), func(t *testing.T, xEnv *testenv.Environment) {
				for attempt := 0; attempt < 3; attempt++ {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: tc.query})
					require.NoError(t, err)
					require.Equal(t, tc.statusCode, res.Response.StatusCode, "attempt %d", attempt)
					require.JSONEq(t, tc.body, res.Body, "attempt %d", attempt)
				}
			})
		})
	}
}

func TestParserLimitsCheckOriginalDocumentWithCachedPlan(t *testing.T) {
	t.Parallel()

	for _, enforce := range []bool{false, true} {
		t.Run(fmt.Sprintf("enforce after normalization=%t", enforce), func(t *testing.T) {
			t.Parallel()
			cfg := parserLimitsNormalizationConfig(config.ParserLimitsConfiguration{
				TotalFieldsLimit:          4,
				EnforceAfterNormalization: enforce,
			}, true)
			testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
				const query = `{ employee(id: 1) { id } }`
				for _, expectedCache := range []string{"MISS", "HIT"} {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: query})
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, res.Response.StatusCode)
					require.Equal(t, expectedCache, res.Response.Header.Get(core.ExecutionPlanCacheHeader))
				}

				// Removing this unused fragment would produce the already cached
				// plan, but its fields must still count towards the original limit.
				before := xEnv.SubgraphRequestCount.Global.Load()
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: query + ` fragment Unused on Employee { details { forename } }`,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.JSONEq(t, `{"errors":[{"message":"allowed number of fields per GraphQL document of '4' exceeded"}]}`, res.Body)
				require.Equal(t, before, xEnv.SubgraphRequestCount.Global.Load())
			})
		})
	}
}

func parserLimitsNormalizationConfig(limits config.ParserLimitsConfiguration, cacheEnabled bool) *testenv.Config {
	return &testenv.Config{
		// Each attempt must be a single request so cache assertions are deterministic.
		NoRetryClient: true,
		ModifySecurityConfiguration: func(c *config.SecurityConfiguration) {
			c.ParserLimits = limits
		},
		ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
			c.EnableNormalizationCache = cacheEnabled
			c.EnablePersistedOperationsCache = cacheEnabled
			c.Debug.EnableCacheResponseHeaders = true
			// Wait for the cache's asynchronous writes before the next request.
			c.Debug.SynchronousCacheWrites = true
		},
	}
}
