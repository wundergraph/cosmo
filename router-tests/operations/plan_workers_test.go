package integration

import (
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/planworker"
)

// withPlanWorkers makes the router of a test plan its operations in worker processes.
func withPlanWorkers(cfg *testenv.Config, workers config.EnginePlanWorkersConfiguration) *testenv.Config {
	if workers.Count == 0 {
		workers.Count = 2
	}
	if workers.QueueSize == 0 {
		workers.QueueSize = 64
	}
	if workers.PlanTimeout == 0 {
		workers.PlanTimeout = 30 * time.Second
	}
	workers.Enabled = true

	modifyEngine := cfg.ModifyEngineExecutionConfiguration
	cfg.ModifyEngineExecutionConfiguration = func(engine *config.EngineExecutionConfiguration) {
		if modifyEngine != nil {
			modifyEngine(engine)
		}
		engine.PlanWorkers = workers
	}
	cfg.RouterOptions = append(cfg.RouterOptions, core.WithPlanWorkerLauncher(&planworker.ProcessLauncher{
		Command: []string{os.Args[0]},
		Env:     []string{planWorkerProcessEnv + "=1"},
	}))
	cfg.LogObservation = testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.DebugLevel}
	return cfg
}

const (
	plannedByWorkerLog = "Operation planned by a plan worker"
	plannedByRouterLog = "Operation is planned by the router instead of a plan worker"
)

func TestPlanWorkers(t *testing.T) {
	t.Parallel()

	requests := map[string]testenv.GraphQLRequest{
		"single subgraph": {
			Query: `query Employees { employees { id tag } }`,
		},
		"entity fetches across subgraphs": {
			Query: `query Employees { employees { id details { forename surname } isAvailable currentMood } }`,
		},
		"nested entity fetches": {
			Query: `query Hobbies { employees { id hobbies { __typename ... on Gaming { name genres } ... on Exercise { category } employees { id details { forename } } } } }`,
		},
		"entity fetches merged into one request": {
			Query: `query Merged { employee(id: 1) { id isAvailable currentMood } employees { id isAvailable currentMood } }`,
		},
		"variables": {
			Query:     `query Employee($id: Int!) { employee(id: $id) { id details { forename pets { name ... on Dog { breed } } } role { title ... on Engineer { engineerType } } } }`,
			Variables: []byte(`{"id": 3}`),
		},
		"unions": {
			Query: `query Products { products { __typename ... on Consultancy { upc lead { id details { forename } } } ... on Cosmo { upc engineers { id isAvailable } } } }`,
		},
		"skip and include": {
			Query:     `query Flags($yes: Boolean!, $no: Boolean!) { employees { id tag @include(if: $no) details @skip(if: $no) { forename surname @skip(if: $yes) } } }`,
			Variables: []byte(`{"yes": true, "no": false}`),
		},
		"mutation": {
			Query:     `mutation UpdateTag($id: Int!, $tag: String!) { updateEmployeeTag(id: $id, tag: $tag) { id tag } }`,
			Variables: []byte(`{"id": 1, "tag": "planned by a worker"}`),
		},
	}

	t.Run("responses are the same as when the router plans", func(t *testing.T) {
		t.Parallel()

		expected := make(map[string]string, len(requests))
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			for name, request := range requests {
				res, err := xEnv.MakeGraphQLRequest(request)
				require.NoError(t, err, name)
				require.Equal(t, http.StatusOK, res.Response.StatusCode, name)
				expected[name] = res.Body
			}
		})

		testenv.Run(t, withPlanWorkers(&testenv.Config{}, config.EnginePlanWorkersConfiguration{}), func(t *testing.T, xEnv *testenv.Environment) {
			for name, request := range requests {
				// The second request is served from the plan cache of the router.
				for range 2 {
					res, err := xEnv.MakeGraphQLRequest(request)
					require.NoError(t, err, name)
					require.Equal(t, http.StatusOK, res.Response.StatusCode, name)
					require.Equal(t, expected[name], res.Body, name)
				}
			}

			logs := xEnv.Observer()
			require.Equal(t, len(requests), logs.FilterMessage(plannedByWorkerLog).Len(), "every operation must be planned by a worker, once")
			require.Zero(t, logs.FilterMessage(plannedByRouterLog).Len())
		})
	})

	t.Run("feature flags are planned with their own graph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, withPlanWorkers(&testenv.Config{}, config.EnginePlanWorkersConfiguration{}), func(t *testing.T, xEnv *testenv.Environment) {
			// The field only exists in the graph of the feature flag.
			request := testenv.GraphQLRequest{Query: `query Flag { employees { id productCount } }`}

			res := xEnv.MakeGraphQLRequestOK(request)
			require.Contains(t, res.Body, `Cannot query field \"productCount\" on type \"Employee\".`)

			request.Header = map[string][]string{"X-Feature-Flag": {"myff"}}
			res = xEnv.MakeGraphQLRequestOK(request)
			require.Equal(t, "myff", res.Response.Header.Get("X-Feature-Flag"))
			require.JSONEq(t, `{"data":{"employees":[{"id":1,"productCount":5},{"id":2,"productCount":2},{"id":3,"productCount":2},{"id":4,"productCount":3},{"id":5,"productCount":2},{"id":7,"productCount":0},{"id":8,"productCount":2},{"id":10,"productCount":3},{"id":11,"productCount":1},{"id":12,"productCount":4}]}}`, res.Body)

			logs := xEnv.Observer().FilterMessage(plannedByWorkerLog).All()
			require.Len(t, logs, 1)
			require.Equal(t, "Flag", logs[0].ContextMap()["operation_name"])
		})
	})

	t.Run("the router plans what workers can't", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, withPlanWorkers(&testenv.Config{}, config.EnginePlanWorkersConfiguration{}), func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query Introspection { __schema { queryType { name } } }`,
			})
			require.JSONEq(t, `{"data":{"__schema":{"queryType":{"name":"Query"}}}}`, res.Body)

			logs := xEnv.Observer()
			require.Zero(t, logs.FilterMessage(plannedByWorkerLog).Len())
			fallbacks := logs.FilterMessage(plannedByRouterLog).All()
			require.Len(t, fallbacks, 1)
			require.Equal(t, "unsupported", fallbacks[0].ContextMap()["reason"])
		})
	})

	t.Run("request tracing and query plans", func(t *testing.T) {
		t.Parallel()

		request := testenv.GraphQLRequest{
			Query:  `query Employees { employees { id details { forename } } }`,
			Header: map[string][]string{"X-WG-Include-Query-Plan": {"true"}},
		}

		var expected string
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			expected = xEnv.MakeGraphQLRequestOK(request).Body
			require.Contains(t, expected, `"queryPlan"`)
		})

		testenv.Run(t, withPlanWorkers(&testenv.Config{}, config.EnginePlanWorkersConfiguration{}), func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(request)
			require.JSONEq(t, expected, res.Body)
			require.Equal(t, 1, xEnv.Observer().FilterMessage(plannedByWorkerLog).Len())
		})
	})

	t.Run("cost control keeps planning in the router", func(t *testing.T) {
		t.Parallel()

		cfg := withPlanWorkers(&testenv.Config{
			ModifySecurityConfiguration: func(security *config.SecurityConfiguration) {
				security.CostControl = &config.CostControl{Enabled: true, EstimatedListSize: 10}
			},
		}, config.EnginePlanWorkersConfiguration{})
		testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query Employees { employees { id } }`})
			require.Contains(t, res.Body, `"employees"`)

			logs := xEnv.Observer()
			require.Equal(t, 1, logs.FilterMessageSnippet("Plan workers are not started").Len())
			require.Zero(t, logs.FilterMessage(plannedByWorkerLog).Len())
		})
	})
}
