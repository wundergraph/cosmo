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
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func indentedJSON(data string) []byte {
	var prettyJSON bytes.Buffer
	err := json.Indent(&prettyJSON, []byte(data), "", "  ")
	if err != nil {
		panic(err)
	}
	return prettyJSON.Bytes()
}

func TestQueryPlans(t *testing.T) {
	t.Parallel()

	g := goldie.New(
		t,
		goldie.WithFixtureDir("testdata/fixtures/query_plans"),
		goldie.WithNameSuffix(".json"),
		goldie.WithDiffEngine(goldie.ClassicDiff),
	)

	t.Run("always include query plan", func(t *testing.T) {
		t.Parallel()

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

			g.Assert(t, "response_with_query_plan", indentedJSON(res.Body))
		})
	})
	t.Run("include query plan via header", func(t *testing.T) {
		t.Parallel()

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

			g.Assert(t, "response_with_query_plan", indentedJSON(res.Body))
		})
	})
	t.Run("query plans disabled", func(t *testing.T) {
		t.Parallel()

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

			g.Assert(t, "response_without_query_plan", indentedJSON(res.Body))
		})
	})
	t.Run("only query plan without data", func(t *testing.T) {
		t.Parallel()

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

			g.Assert(t, "only_query_plan", indentedJSON(res.Body))
		})
	})
	t.Run("only query plan without data but with trace", func(t *testing.T) {
		t.Parallel()

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
			g.Assert(t, "query_plan_with_trace_no_data", indentedJSON(resultBody))
			if t.Failed() {
				t.Log(res.Body)
			}
		})
	})
	t.Run("enabling subgraph fetch operation name should return valid data and include the subgraph and fetch id in the plan", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.Debug.AlwaysIncludeQueryPlan = true
				cfg.EnableSubgraphFetchOperationName = true
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

			g.Assert(t, "response_with_query_plan_operation_name", indentedJSON(res.Body))
		})
	})

	t.Run("modified mood and availability subgraphs include sanitized operation names in query plan", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				for _, subgraph := range routerConfig.Subgraphs {
					if subgraph.GetName() == "mood" {
						subgraph.Name = "--_$mo&o-d_-$-_-"
					}
					if subgraph.GetName() == "availability" {
						subgraph.Name = "--_$av_ai-la%bi$lit-y_-$-_-"
					}
				}
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.Debug.AlwaysIncludeQueryPlan = true
				cfg.EnableSubgraphFetchOperationName = true
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

			require.Contains(t, res.Body, "query Requires__mo_o_d")
			require.Contains(t, res.Body, "query Requires__av_ai_la_bi_lit_y")
		})
	})

	t.Run("modified mood and availability subgraphs should provide valid execution plan with no data but trace", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				for _, subgraph := range routerConfig.Subgraphs {
					if subgraph.GetName() == "mood" {
						subgraph.Name = "--_$mo&o-d_-$-_-"
					}
					if subgraph.GetName() == "availability" {
						subgraph.Name = "--_$av_ai-la%bi$lit-y_-$-_-"
					}
				}
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableRequestTracing = true
				cfg.EnableSubgraphFetchOperationName = true
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

			g.Assert(t, "response_with_query_plan_operation_name_sanitized_no_data", indentedJSON(res.Body))
		})
	})
	t.Run("query plan on skip load for a subscription", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.Debug.AlwaysIncludeQueryPlan = true
				cfg.Debug.AlwaysSkipLoader = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `subscription Q1 { currentTime { unixTime } }`,
			})

			g.Assert(t, "subscription_response_with_query_plan", indentedJSON(res.Body))
		})
	})

}
