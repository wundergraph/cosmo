package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"testing"

	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func prettifyJSON(data string) []byte {
	var prettyJSON bytes.Buffer
	err := json.Indent(&prettyJSON, []byte(data), "", "  ")
	if err != nil {
		panic(err)
	}
	return prettyJSON.Bytes()
}

func TestQueryPlans(t *testing.T) {

	g := goldie.New(
		t,
		goldie.WithFixtureDir("testdata/fixtures/query_plans"),
		goldie.WithNameSuffix(".json"),
		goldie.WithDiffEngine(goldie.ClassicDiff),
	)

	t.Run("always include query plan", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.Debug.AlwaysIncludeQueryPlan = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query Requires {
					  products {
						__typename
						... on Consultancy {
						  lead {
							__typename
							id
							derivedMood
						  }
						  isLeadAvailable
						}
					  }
					}`,
			})

			g.Assert(t, "response_with_query_plan", prettifyJSON(res.Body))
		})
	})
	t.Run("include query plan via header", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-WG-Include-Query-Plan": []string{"true"},
				},
				Query: `query Requires {
					  products {
						__typename
						... on Consultancy {
						  lead {
							__typename
							id
							derivedMood
						  }
						  isLeadAvailable
						}
					  }
					}`,
			})

			g.Assert(t, "response_with_query_plan", prettifyJSON(res.Body))
		})
	})
	t.Run("query plans disabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{core.WithQueryPlans(false)},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-WG-Include-Query-Plan": []string{"true"},
				},
				Query: `query Requires {
					  products {
						__typename
						... on Consultancy {
						  lead {
							__typename
							id
							derivedMood
						  }
						  isLeadAvailable
						}
					  }
					}`,
			})

			g.Assert(t, "response_without_query_plan", prettifyJSON(res.Body))
		})
	})
	t.Run("only query plan without data", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-WG-Include-Query-Plan": []string{"true"},
					"X-WG-Skip-Loader":        []string{"true"},
				},
				Query: `query Requires {
					  products {
						__typename
						... on Consultancy {
						  lead {
							__typename
							id
							derivedMood
						  }
						  isLeadAvailable
						}
					  }
					}`,
			})

			g.Assert(t, "only_query_plan", prettifyJSON(res.Body))
		})
	})
	t.Run("only query plan without data but with trace", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableRequestTracing = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-WG-Include-Query-Plan": []string{"true"},
					"X-WG-Skip-Loader":        []string{"true"},
					"X-WG-Trace":              []string{"true", "enable_predictable_debug_timings"},
				},
				Query: `query Requires {
					  products {
						__typename
						... on Consultancy {
						  lead {
							__typename
							id
							derivedMood
						  }
						  isLeadAvailable
						}
					  }
					}`,
			})

			rex, err := regexp.Compile(`http://127.0.0.1:\d+/graphql`)
			require.NoError(t, err)
			resultBody := rex.ReplaceAllString(res.Body, "http://localhost/graphql")
			g.Assert(t, "query_plan_with_trace_no_data", prettifyJSON(resultBody))
			if t.Failed() {
				t.Log(res.Body)
			}
		})
	})
}
