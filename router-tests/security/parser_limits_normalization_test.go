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

// Parser limits are checked on the original document, before normalization inlines
// fragment spreads. The expanded representation is cached and restored on later
// requests without repeating the check, so an operation that was accepted once
// stays accepted regardless of cache state.
func TestParserLimitsIgnoreFragmentExpansion(t *testing.T) {
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
	const expanded = `query Employees($first: Int!, $second: Int!) {
		a: employee(id: $first) { id details { forename } }
		b: employee(id: $second) { id details { forename } }
	}`
	const successBody = `{"data":{"a":{"id":1,"details":{"forename":"Jens"}},"b":{"id":2,"details":{"forename":"Dustin"}}}}`

	// Guard the fixture: the original document passes a limit that the expanded
	// representation exceeds.
	require.Equal(t, 11, countTokenizerFields(t, query))
	require.Equal(t, 14, countTokenizerFields(t, expanded))

	for _, persisted := range []bool{false, true} {
		name := "regular operation"
		if persisted {
			name = "persisted operation"
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			for _, tc := range []struct {
				name         string
				cacheEnabled bool
				fieldLimit   int
				statusCode   int
				body         string
			}{
				{
					name:         "accepts expanded fragments on cache misses and hits",
					cacheEnabled: true,
					fieldLimit:   13,
					statusCode:   http.StatusOK,
					body:         successBody,
				},
				{
					name:       "accepts expanded fragments with only plan cache",
					fieldLimit: 13,
					statusCode: http.StatusOK,
					body:       successBody,
				},
				{
					name:         "rejects the original document with cache enabled",
					cacheEnabled: true,
					fieldLimit:   10,
					statusCode:   http.StatusBadRequest,
					body:         `{"errors":[{"message":"allowed number of fields per GraphQL document of '10' exceeded"}]}`,
				},
				{
					name:       "rejects the original document with only plan cache",
					fieldLimit: 10,
					statusCode: http.StatusBadRequest,
					body:       `{"errors":[{"message":"allowed number of fields per GraphQL document of '10' exceeded"}]}`,
				},
			} {
				t.Run(tc.name, func(t *testing.T) {
					t.Parallel()

					cfg := parserLimitsConfig(config.ParserLimitsConfiguration{
						TotalFieldsLimit: tc.fieldLimit,
					}, tc.cacheEnabled)
					request := testenv.GraphQLRequest{Query: query}
					cacheHeader := core.NormalizationCacheHeader
					if persisted {
						// Serve the same document through the persisted-operation path,
						// including requests that never populate a normalization cache.
						hash := fmt.Sprintf("%x", sha256.Sum256([]byte(query)))
						cfg.CdnSever = parserLimitsCDN(t, hash, query)
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
							require.Equal(t, tc.statusCode, res.Response.StatusCode, "attempt %d: %s", attempt, res.Body)
							require.JSONEq(t, tc.body, res.Body, "attempt %d", attempt)

							if tc.statusCode != http.StatusOK {
								require.Zero(t, xEnv.SubgraphRequestCount.Employees.Load(), "the original document must be rejected before reaching the subgraph")
								continue
							}

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

func TestParserLimitsApplyToOriginalDocument(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		query      string
		limits     config.ParserLimitsConfiguration
		statusCode int
		body       string
	}{
		{
			name: "counts unused fragments before normalization removes them",
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
			name: "counts the cumulative depth of operations and fragments",
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
			testenv.Run(t, parserLimitsConfig(tc.limits, true), func(t *testing.T, xEnv *testenv.Environment) {
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

	cfg := parserLimitsConfig(config.ParserLimitsConfiguration{
		TotalFieldsLimit: 4,
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
}

func TestParserLimitsIgnorePersistedOperations(t *testing.T) {
	t.Parallel()

	// Five identifiers exceed the limit of four configured below.
	const query = `query Selected { employee(id: 1) { id } } fragment Unused on Employee { details { forename } }`
	const successBody = `{"data":{"employee":{"id":1}}}`
	const errorBody = `{"errors":[{"message":"allowed number of fields per GraphQL document of '4' exceeded"}]}`
	require.Equal(t, 5, countTokenizerFields(t, query))

	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(query)))
	extensions := []byte(fmt.Sprintf(`{"persistedQuery":{"version":1,"sha256Hash":%q}}`, hash))
	// The test environment mutates request headers, so parallel subtests need their own map.
	header := func() http.Header { return http.Header{"Graphql-Client-Name": {"parser-limits"}} }
	limits := config.ParserLimitsConfiguration{
		TotalFieldsLimit:          4,
		IgnorePersistedOperations: true,
	}

	t.Run("skips operations loaded from persisted operation storage", func(t *testing.T) {
		t.Parallel()

		for _, cacheEnabled := range []bool{false, true} {
			t.Run(fmt.Sprintf("cache=%t", cacheEnabled), func(t *testing.T) {
				t.Parallel()

				cfg := parserLimitsConfig(limits, cacheEnabled)
				cfg.CdnSever = parserLimitsCDN(t, hash, query)
				testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
					for attempt := 0; attempt < 3; attempt++ {
						res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
							OperationName: []byte(`"Selected"`),
							Extensions:    extensions,
							Header:        header(),
						})
						require.NoError(t, err)
						require.Equal(t, http.StatusOK, res.Response.StatusCode, "attempt %d: %s", attempt, res.Body)
						require.JSONEq(t, successBody, res.Body, "attempt %d", attempt)
						expectedCache := "MISS"
						if cacheEnabled && attempt > 0 {
							expectedCache = "HIT"
						}
						require.Equal(t, expectedCache, res.Response.Header.Get(core.PersistedOperationCacheHeader), "attempt %d", attempt)
					}

					// The same document sent as a regular operation is still checked.
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query:         query,
						OperationName: []byte(`"Selected"`),
					})
					require.NoError(t, err)
					require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
					require.JSONEq(t, errorBody, res.Body)
				})
			})
		}
	})

	t.Run("still checks automatic persisted queries", func(t *testing.T) {
		t.Parallel()

		cfg := parserLimitsConfig(limits, true)
		// No CDN client, so every persisted query hash resolves through APQ.
		cfg.RouterOptions = []core.Option{core.WithGraphApiToken("")}
		cfg.ApqConfig = config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache: config.AutomaticPersistedQueriesCacheConfig{
				Size: 1024 * 1024,
			},
		}
		testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
			// Registering the operation sends its body with the hash.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         query,
				OperationName: []byte(`"Selected"`),
				Extensions:    extensions,
				Header:        header(),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode, res.Body)
			require.JSONEq(t, errorBody, res.Body)

			// The body was stored before parsing. Requests by hash load it from the
			// APQ store and are checked again.
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Selected"`),
				Extensions:    extensions,
				Header:        header(),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode, res.Body)
			require.JSONEq(t, errorBody, res.Body)
			require.Zero(t, xEnv.SubgraphRequestCount.Employees.Load())
		})
	})
}

// parserLimitsCDN serves one persisted operation the way the Cosmo CDN does.
func parserLimitsCDN(t *testing.T, hash, query string) *httptest.Server {
	t.Helper()
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
	return cdn
}

// countTokenizerFields returns the field count the parser limits are checked against.
func countTokenizerFields(t *testing.T, document string) int {
	t.Helper()
	var input ast.Input
	input.ResetInputString(document)
	stats, err := astparser.NewTokenizer().TokenizeWithLimits(astparser.TokenizerLimits{}, &input)
	require.NoError(t, err)
	return stats.TotalFields
}

func parserLimitsConfig(limits config.ParserLimitsConfiguration, cacheEnabled bool) *testenv.Config {
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
