package integration

import (
	"testing"

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

	t.Run("merges same-wave entity fetches to the same subgraph by default", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: multiFetchQuery})
			require.JSONEq(t, multiFetchExpectedResponse, res.Body)

			// Root fetch + one merged entity fetch.
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load())

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load())
			require.EqualValues(t, 4, xEnv.SubgraphRequestCount.Global.Load())
		})
	})

	t.Run("sends one request per entity fetch when multi-fetch is disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.DisableMultiFetch = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: multiFetchQuery})
			// Merging must not change the result: same response as the default case above.
			require.JSONEq(t, multiFetchExpectedResponse, res.Body)

			// Root fetch + two separate entity fetches.
			require.EqualValues(t, 3, xEnv.SubgraphRequestCount.Employees.Load())

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load())
			require.EqualValues(t, 5, xEnv.SubgraphRequestCount.Global.Load())
		})
	})
}
