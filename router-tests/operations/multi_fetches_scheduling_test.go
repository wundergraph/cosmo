package integration

import (
	"encoding/json"
	"testing"

	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestMultiFetch(t *testing.T) {
	t.Parallel()

	// multiFetchQuery resolves Consultancy.lead from the employees subgraph, then needs
	// two follow-up entity fetches: Employee.derivedMood and Consultancy.isLeadAvailable
	const multiFetchQuery = `query Requires {
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
	}`
	const multiFetchExpectedResponse = `{"data":{"products":[{"__typename":"Consultancy","lead":{"__typename":"Employee","id":1,"derivedMood":"HAPPY"},"isLeadAvailable":false},{"__typename":"Cosmo"},{"__typename":"SDK"}]}}`

	t.Run("merges same-wave entity fetches to the same subgraph when enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableMultiFetch = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: multiFetchQuery})
			require.JSONEq(t, multiFetchExpectedResponse, res.Body)

			// Root fetch + one merged entity fetch.
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load())

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load())
			require.EqualValues(t, 4, xEnv.SubgraphRequestCount.Global.Load())
		})
	})

	t.Run("sends one request per entity fetch by default", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: multiFetchQuery})
			// Merging must not change the result: same response as the merged case above.
			require.JSONEq(t, multiFetchExpectedResponse, res.Body)

			// Root fetch + two separate entity fetches.
			require.EqualValues(t, 3, xEnv.SubgraphRequestCount.Employees.Load())

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load())
			require.EqualValues(t, 5, xEnv.SubgraphRequestCount.Global.Load())
		})
	})
}

// queryPlanNode is a minimal mirror of the query plan JSON for structural assertions.
type queryPlanNode struct {
	Kind     string          `json:"kind"`
	Children []queryPlanNode `json:"children"`
	Fetch    *struct {
		Kind         string `json:"kind"`
		SubgraphName string `json:"subgraphName"`
	} `json:"fetch"`
}

func (n *queryPlanNode) fetchKinds() []string {
	var kinds []string
	if n.Fetch != nil {
		kinds = append(kinds, n.Fetch.Kind)
	}
	for i := range n.Children {
		kinds = append(kinds, n.Children[i].fetchKinds()...)
	}
	return kinds
}

// TestMultiFetchAndScheduleFetches verifies that enable_multi_fetch and enable_schedule_fetches
// can be enabled together and that both affect the generated query plan.
func TestMultiFetchAndScheduleFetches(t *testing.T) {
	t.Parallel()

	newGoldie := func(t *testing.T) *goldie.Goldie {
		return goldie.New(
			t,
			goldie.WithFixtureDir("testdata/fixtures/query_plans"),
			goldie.WithNameSuffix(".json"),
			goldie.WithDiffEngine(goldie.ClassicDiff),
		)
	}
	bothFlags := func(cfg *config.EngineExecutionConfiguration) {
		cfg.EnableMultiFetch = true
		cfg.EnableScheduleFetches = true
		cfg.Debug.AlwaysIncludeQueryPlan = true
	}

	queryPlanFromBody := func(t *testing.T, body string) queryPlanNode {
		t.Helper()
		var resp struct {
			Extensions struct {
				QueryPlan queryPlanNode `json:"queryPlan"`
			} `json:"extensions"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &resp))
		return resp.Extensions.QueryPlan
	}

	t.Run("same-subgraph entity fetches merge into one MultiEntity fetch", func(t *testing.T) {
		t.Parallel()

		// Both employees entity fetches (derivedMood, isLeadAvailable requires)
		// execute at the same point of the plan and merge.
		const query = `query Requires {
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
		}`

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: bothFlags,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			newGoldie(t).Assert(t, "response_with_query_plan_multi_fetch_schedule", indentedJSON(res.Body))

			plan := queryPlanFromBody(t, res.Body)
			require.Contains(t, plan.fetchKinds(), "MultiEntity")

			// root fetch + 1 merged entity fetch to employees
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load())

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load())
			require.EqualValues(t, 4, xEnv.SubgraphRequestCount.Global.Load())
		})
	})

	t.Run("independent chains are scheduled without wave barriers", func(t *testing.T) {
		t.Parallel()

		// Two independent chains: employee -> mood -> employees (derivedMood requires currentMood)
		// and findEmployees (family) -> availability.
		// The legacy organizer produces Sequence(Parallel, Parallel, ...) waves;
		// the scheduler runs both chains side by side under a Parallel root.
		const query = `query IndependentChains {
		  employee(id: 1) {
			id
			derivedMood
		  }
		  findEmployees(criteria: { nationality: GERMAN }) {
			id
			isAvailable
		  }
		}`

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: bothFlags,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			newGoldie(t).Assert(t, "response_with_query_plan_schedule_chains", indentedJSON(res.Body))

			plan := queryPlanFromBody(t, res.Body)
			require.Equal(t, "Parallel", plan.Kind, "scheduled plan must run independent chains in parallel")
			require.Len(t, plan.Children, 2)
			for _, chain := range plan.Children {
				require.Equal(t, "Sequence", chain.Kind)
			}

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Family.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load())
			require.EqualValues(t, 5, xEnv.SubgraphRequestCount.Global.Load())
		})
	})
}
