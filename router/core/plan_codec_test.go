package core

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	"github.com/wundergraph/cosmo/router/internal/graphcodec"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const planCodecTestConfig = "../pkg/plan_generator/testdata/execution_config/base.json"

func fetchDataSource(fetch resolve.Fetch) resolve.DataSource {
	switch f := fetch.(type) {
	case *resolve.SingleFetch:
		return f.DataSource
	case *resolve.EntityFetch:
		return f.DataSource
	case *resolve.BatchEntityFetch:
		return f.DataSource
	case *resolve.MultiEntityFetch:
		return f.DataSource
	}
	return nil
}

// planFetches returns all fetches of a plan.
func planFetches(t *testing.T, p plan.Plan) []resolve.Fetch {
	t.Helper()
	var out []resolve.Fetch
	err := forEachPlanFetch(p, func(fetch resolve.Fetch) error {
		out = append(out, fetch)
		return nil
	})
	require.NoError(t, err)
	return out
}

func TestPlanCodec(t *testing.T) {
	t.Parallel()

	executions := map[string]config.EngineExecutionConfiguration{
		"defaults": {
			EnableMultiFetch:         true,
			EnableScheduleFetches:    true,
			MinifySubgraphOperations: true,
		},
		"without multi fetch": {},
	}

	// fetchTypes are the types of the fetches seen across all operations.
	fetchTypes := make(map[string]struct{})

	for executionName, execution := range executions {
		graph := newPlanWorkerTestGraph(t, execution)
		planner := &OperationPlanner{executor: graph.executor}

		for name, operation := range planWorkerTestOperations {
			for _, includeQueryPlan := range []bool{false, true} {
				testName := executionName + "/" + name
				if includeQueryPlan {
					testName += "/with query plan"
				}
				t.Run(testName, func(t *testing.T) {
					planned, err := planner.planOperation(graph.normalize(t, operation), findOperationNameString(t, operation), includeQueryPlan)
					require.NoError(t, err)
					original := planned.preparedPlan

					data, err := encodePlan(original)
					require.NoError(t, err)

					decoded, dataSources, err := decodePlan(data)
					require.NoError(t, err)

					fetches := planFetches(t, original)
					require.Equal(t, len(fetches), dataSources)
					require.NotEmpty(t, fetches)
					for _, fetch := range fetches {
						fetchTypes[fmt.Sprintf("%T", fetch)] = struct{}{}
					}
					for _, fetch := range planFetches(t, decoded) {
						require.Nil(t, fetchDataSource(fetch), "data sources are not transferred")
					}

					sources := make(map[string]resolve.DataSource)
					for _, fetch := range fetches {
						require.NotNil(t, fetchDataSource(fetch))
						sources[fetch.FetchInfo().DataSourceID] = fetchDataSource(fetch)
					}
					err = restorePlanDataSources(decoded, dataSources, func(id string) (resolve.DataSource, bool) {
						ds, ok := sources[id]
						return ds, ok
					})
					require.NoError(t, err)

					// With the original data sources back in place, the decoded plan must be
					// indistinguishable from the one the planner produced.
					require.Equal(t, original, decoded)

					again, err := encodePlan(decoded)
					require.NoError(t, err)
					require.Equal(t, data, again, "encoding must be deterministic")
				})
			}
		}
	}

	// The operations are only worth something if they cover everything a plan can be made of.
	require.Equal(t, map[string]struct{}{
		"*resolve.SingleFetch":      {},
		"*resolve.EntityFetch":      {},
		"*resolve.BatchEntityFetch": {},
		"*resolve.MultiEntityFetch": {},
	}, fetchTypes)
}

func TestPlanCodecRejectsWhatItCannotTransfer(t *testing.T) {
	t.Parallel()

	graph := newPlanWorkerTestGraph(t, config.EngineExecutionConfiguration{})
	planner := &OperationPlanner{executor: graph.executor}

	planOperation := func(t *testing.T, operation string) plan.Plan {
		t.Helper()
		planned, err := planner.planOperation(graph.normalize(t, operation), findOperationNameString(t, operation), false)
		require.NoError(t, err)
		return planned.preparedPlan
	}

	requireUnsupported := func(t *testing.T, p plan.Plan, reason string) {
		t.Helper()
		_, err := encodePlan(p)
		var unsupported *graphcodec.UnsupportedError
		require.ErrorAs(t, err, &unsupported)
		require.Contains(t, unsupported.Reason, reason)
	}

	t.Run("introspection", func(t *testing.T) {
		p := planOperation(t, `query Introspection { __schema { queryType { name } } }`)
		requireUnsupported(t, p, "can only be planned by the router")
	})

	t.Run("event driven subgraph", func(t *testing.T) {
		p := planOperation(t, `mutation Publish { updateEmployeeMyKafka(employeeID: 1, update: {name: "a", email: "a@b.c"}) { success } }`)
		requireUnsupported(t, p, "can only be planned by the router")
	})

	t.Run("subscription", func(t *testing.T) {
		p := planOperation(t, `subscription Time { currentTime { unixTime } }`)
		require.IsType(t, &plan.SubscriptionResponsePlan{}, p)
		requireUnsupported(t, p, "can't be transferred")
	})

	t.Run("cost calculator", func(t *testing.T) {
		p := planOperation(t, `query Employees { employees { id } }`)
		p.SetCostCalculator(plan.NewCostCalculator(graph.executor.PlanConfig))
		requireUnsupported(t, p, "unexported field")
	})

	t.Run("data source can't be restored", func(t *testing.T) {
		p := planOperation(t, `query Employees { employees { id } }`)
		data, err := encodePlan(p)
		require.NoError(t, err)
		decoded, dataSources, err := decodePlan(data)
		require.NoError(t, err)
		require.Equal(t, 1, dataSources)

		err = restorePlanDataSources(decoded, dataSources, func(string) (resolve.DataSource, bool) {
			return nil, false
		})
		require.ErrorContains(t, err, "no transferable data source")
	})

	t.Run("fetch in a place we don't look", func(t *testing.T) {
		// If a plan needs more data sources than we find fetches for, some fetch
		// would be left without one.
		p := planOperation(t, `query Employees { employees { id } }`)
		data, err := encodePlan(p)
		require.NoError(t, err)
		decoded, dataSources, err := decodePlan(data)
		require.NoError(t, err)

		err = restorePlanDataSources(decoded, dataSources+1, func(string) (resolve.DataSource, bool) {
			return &subgraphFetchSource{}, true
		})
		require.ErrorContains(t, err, "plan needs 2 data sources, but 1 fetches were found")
	})
}
