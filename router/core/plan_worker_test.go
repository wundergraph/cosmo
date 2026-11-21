package core

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/staticdatasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/graphqlschemausage"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/planworker"
)

// planWorkerTestProcessEnv makes the test binary act as a plan worker process.
const planWorkerTestProcessEnv = "ROUTER_CORE_TEST_PLAN_WORKER_PROCESS"

func TestMain(m *testing.M) {
	if os.Getenv(planWorkerTestProcessEnv) != "" {
		err := RunPlanWorker(context.Background(), os.Stdin, os.Stdout, zap.NewNop(), func() { os.Exit(0) })
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// planWorkerTestOperations are operations against the graph of planCodecTestConfig whose
// plans can be transferred from a plan worker to the router.
var planWorkerTestOperations = map[string]string{
	"single subgraph": `query Employees { employees { id tag } }`,
	"entity fetches across subgraphs": `query Employees {
		employees { id details { forename surname } isAvailable currentMood derivedMood }
	}`,
	"nested entity fetches": `query Hobbies {
		employees {
			id
			hobbies {
				__typename
				... on Gaming { name genres yearsOfExperience }
				... on Exercise { category }
				employees { id details { forename } isAvailable }
			}
		}
	}`,
	"entity fetches merged into one request": `query Merged {
		employee(id: 1) { id isAvailable currentMood }
		employees { id isAvailable currentMood }
	}`,
	"defer": `query Deferred {
		employees {
			id
			... @defer(label: "details") { details { forename surname } }
			... @defer { isAvailable hobbies { __typename ... @defer { employees { id currentMood } } } }
		}
	}`,
	"variables": `query Employee($id: Int!) {
		employee(id: $id) {
			id
			tag
			details { forename location { key { name } } pets { name gender ... on Dog { breed } } }
			role { title departments ... on Engineer { engineerType } }
		}
	}`,
	"inline arguments and enums": `query Teammates { teammates(team: ENGINEERING) { id currentMood } }`,
	"input objects": `query Find($criteria: SearchInput) {
		findEmployees(criteria: $criteria) { id details { forename nationality } }
	}`,
	"unions": `query Products {
		products {
			__typename
			... on Consultancy { upc lead { id details { forename } } }
			... on Cosmo { upc engineers { id isAvailable } }
			... on SDK { upc owner { id } }
		}
	}`,
	"aliases and skip include": `query Flags($withTag: Boolean!, $withoutNotes: Boolean!) {
		first: employee(id: 1) { id tag @include(if: $withTag) notes @skip(if: $withoutNotes) }
		second: employee(id: 2) { ident: id mood: currentMood }
	}`,
	"mutation": `mutation UpdateTag($id: Int!, $tag: String!) {
		updateEmployeeTag(id: $id, tag: $tag) { id tag derivedMood }
	}`,
	"mutation across subgraphs": `mutation UpdateMood {
		updateMood(employeeID: 1, mood: HAPPY) { id currentMood details { forename } }
	}`,
}

type planWorkerTestGraph struct {
	settings     planWorkerSettings
	routerConfig *nodev1.RouterConfig
	executor     *Executor
	generator    *PlanGenerator
}

// newPlanWorkerTestGraph builds what the router has for a graph: an executor that plans
// its operations, and HTTP clients for its subgraphs.
func newPlanWorkerTestGraph(t *testing.T, execution config.EngineExecutionConfiguration) *planWorkerTestGraph {
	t.Helper()

	routerConfig, err := execution_config.FromFile(planCodecTestConfig)
	require.NoError(t, err)

	settings := planWorkerSettings{Introspection: true, Execution: execution}

	builder := &ExecutorConfigurationBuilder{
		introspection: settings.Introspection,
		logger:        zap.NewNop(),
		factoryResolver: &DefaultFactoryResolver{
			engineCtx: t.Context(),
			static:    &staticdatasource.Factory[staticdatasource.Configuration]{},
		},
	}
	executor, _, err := builder.buildPlanningExecutor(t.Context(), &ExecutorBuildOptions{
		EngineConfig: routerConfig.GetEngineConfig(),
		Subgraphs:    routerConfig.GetSubgraphs(),
		RouterEngineConfig: &RouterEngineConfiguration{
			Execution:         execution,
			Events:            planningEventsConfiguration(routerConfig.GetEngineConfig()),
			StreamMetricStore: metric.NewNoopStreamMetricStore(),
		},
	})
	require.NoError(t, err)

	executor.subgraphFetchClients = make(map[string]*http.Client)
	for _, ds := range routerConfig.GetEngineConfig().GetDatasourceConfigurations() {
		if ds.GetKind() == nodev1.DataSourceKind_GRAPHQL {
			executor.subgraphFetchClients[ds.GetId()] = &http.Client{}
		}
	}

	generator, err := NewPlanGeneratorFromConfig(routerConfig, zap.NewNop(), PlanGeneratorOptions{})
	require.NoError(t, err)

	return &planWorkerTestGraph{
		settings:     settings,
		routerConfig: routerConfig,
		executor:     executor,
		generator:    generator,
	}
}

// normalize turns an operation into what the router hands to the planner.
func (g *planWorkerTestGraph) normalize(t *testing.T, operation string) string {
	t.Helper()

	doc, report := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, report.HasErrors(), report.Error())

	planner, err := g.generator.GetPlanner()
	require.NoError(t, err)
	normalized, _, err := planner.PrepareOperation(&doc)
	require.NoError(t, err)

	content, err := astprinter.PrintString(normalized)
	require.NoError(t, err)
	return content
}

func (g *planWorkerTestGraph) remotePlanner(t *testing.T, pool *planworker.Pool, logger *zap.Logger) *remotePlanner {
	t.Helper()
	remote, err := newRemotePlanner(pool, g.settings, g.routerConfig.GetEngineConfig(), g.routerConfig.GetSubgraphs(), g.executor, logger)
	require.NoError(t, err)
	t.Cleanup(remote.close)
	return remote
}

func newTestPlanWorkerPool(t *testing.T, cfg config.EnginePlanWorkersConfiguration, launcher planworker.Launcher) *planworker.Pool {
	t.Helper()
	if cfg.Count == 0 {
		cfg.Count = 2
	}
	if cfg.QueueSize == 0 {
		cfg.QueueSize = 64
	}
	if cfg.PlanTimeout == 0 {
		cfg.PlanTimeout = 30 * time.Second
	}
	pool, err := newPlanWorkerPool(cfg, launcher, zap.NewNop())
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

// inProcessPlanWorkers runs the plan workers as goroutines of the test.
func inProcessPlanWorkers(t *testing.T) planworker.Launcher {
	return &planworker.PipeLauncher{
		NewHandler: func() planworker.Handler {
			return newPlanWorkerHandler(t.Context(), zap.NewNop())
		},
		Options: planworker.ServeOptions{Version: Version, PlanFormat: planWorkerFormat()},
	}
}

// planWorkerProcesses runs the plan workers as processes, like the router does.
func planWorkerProcesses() planworker.Launcher {
	return &planworker.ProcessLauncher{
		Command: []string{os.Args[0]},
		Env:     []string{planWorkerTestProcessEnv + "=1"},
	}
}

// withoutDataSources removes the data sources of a plan. They are the one thing that
// legitimately differs between a plan of the router and a plan of a worker.
func withoutDataSources(t *testing.T, p plan.Plan) plan.Plan {
	t.Helper()
	err := restorePlanDataSources(p, len(planFetches(t, p)), func(string) (resolve.DataSource, bool) {
		return nil, true
	})
	require.NoError(t, err)
	return p
}

func TestPlanWorkersPlanLikeTheRouter(t *testing.T) {
	t.Parallel()

	launchers := map[string]func(t *testing.T) planworker.Launcher{
		"in process":       inProcessPlanWorkers,
		"worker processes": func(*testing.T) planworker.Launcher { return planWorkerProcesses() },
	}
	executions := map[string]config.EngineExecutionConfiguration{
		"defaults": {
			EnableMultiFetch:         true,
			EnableScheduleFetches:    true,
			MinifySubgraphOperations: true,
		},
		"without multi fetch": {
			EnableSubgraphFetchOperationName: true,
			EnableRequireFetchReasons:        true,
		},
	}

	for launcherName, launcher := range launchers {
		for executionName, execution := range executions {
			t.Run(launcherName+"/"+executionName, func(t *testing.T) {
				t.Parallel()

				graph := newPlanWorkerTestGraph(t, execution)
				pool := newTestPlanWorkerPool(t, config.EnginePlanWorkersConfiguration{}, launcher(t))
				remote := graph.remotePlanner(t, pool, zap.NewNop())
				require.NoError(t, pool.Start(t.Context()))

				local := &OperationPlanner{executor: graph.executor}
				viaWorkers := &OperationPlanner{executor: graph.executor, remote: remote}

				for name, operation := range planWorkerTestOperations {
					for _, includeQueryPlan := range []bool{false, true} {
						opContext := &operationContext{
							content: graph.normalize(t, operation),
							name:    findOperationNameString(t, operation),
						}
						opContext.executionOptions.IncludeQueryPlanInResponse = includeQueryPlan

						expected, err := local.planOperation(opContext.content, opContext.name, includeQueryPlan)
						require.NoError(t, err, name)

						planned := remote.planned.Load()
						actual, err := viaWorkers.planOperationOnWorker(opContext)
						require.NoError(t, err, name)
						require.Equal(t, planned+1, remote.planned.Load(), "%s: must be planned by a worker", name)

						// The fetches of the worker's plan use the HTTP clients of the router.
						fetches := planFetches(t, actual.preparedPlan)
						require.NotEmpty(t, fetches, name)
						for _, fetch := range fetches {
							source, ok := fetchDataSource(fetch).(*subgraphFetchSource)
							require.True(t, ok, "%s: unexpected data source %T", name, fetchDataSource(fetch))
							require.Same(t, graph.executor.subgraphFetchClients[fetch.FetchInfo().DataSourceID], source.httpClient)
						}

						// Everything the router derives from a plan and its operation must
						// not depend on who planned it.
						require.Equal(t,
							graphqlschemausage.GetTypeFieldUsageInfo(expected.preparedPlan),
							graphqlschemausage.GetTypeFieldUsageInfo(actual.preparedPlan),
							name,
						)
						expectedArguments, err := graphqlschemausage.GetArgumentUsageInfo(expected.operationDocument, graph.executor.RouterSchema, nil, expected.preparedPlan, nil)
						require.NoError(t, err)
						actualArguments, err := graphqlschemausage.GetArgumentUsageInfo(actual.operationDocument, graph.executor.RouterSchema, nil, actual.preparedPlan, nil)
						require.NoError(t, err)
						require.Equal(t, expectedArguments, actualArguments, name)
						expectedInputs, err := graphqlschemausage.GetInputUsageInfo(expected.operationDocument, graph.executor.RouterSchema, nil, expected.preparedPlan, nil)
						require.NoError(t, err)
						actualInputs, err := graphqlschemausage.GetInputUsageInfo(actual.operationDocument, graph.executor.RouterSchema, nil, actual.preparedPlan, nil)
						require.NoError(t, err)
						require.Equal(t, expectedInputs, actualInputs, name)

						expectedDocument, err := astprinter.PrintString(expected.operationDocument)
						require.NoError(t, err)
						actualDocument, err := astprinter.PrintString(actual.operationDocument)
						require.NoError(t, err)
						require.Equal(t, expectedDocument, actualDocument, name)

						require.Same(t, graph.executor.RouterSchema, actual.schemaDocument)
						require.Equal(t,
							withoutDataSources(t, expected.preparedPlan),
							withoutDataSources(t, actual.preparedPlan),
							name,
						)
					}
				}

				require.Zero(t, remote.fallbacks.Load())
			})
		}
	}
}

func findOperationNameString(t *testing.T, operation string) string {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, report.HasErrors(), report.Error())
	name := findOperationName(&doc)
	require.NotEmpty(t, name)
	return string(name)
}

func TestRouterPlansWhatPlanWorkersCannot(t *testing.T) {
	t.Parallel()

	graph := newPlanWorkerTestGraph(t, config.EngineExecutionConfiguration{EnableMultiFetch: true, EnableScheduleFetches: true})
	pool := newTestPlanWorkerPool(t, config.EnginePlanWorkersConfiguration{}, inProcessPlanWorkers(t))
	core, logs := observer.New(zap.DebugLevel)
	remote := graph.remotePlanner(t, pool, zap.New(core))
	require.NoError(t, pool.Start(t.Context()))

	planner := &OperationPlanner{executor: graph.executor, remote: remote}

	t.Run("introspection", func(t *testing.T) {
		// The worker plans it, but the plan uses a data source only the router has.
		opContext := &operationContext{
			content: graph.normalize(t, `query Introspection { __schema { queryType { name } } }`),
			name:    "Introspection",
		}
		fallbacks := remote.fallbacks.Load()

		out, err := planner.planOperationOnWorker(opContext)
		require.NoError(t, err)
		require.IsType(t, &plan.SynchronousResponsePlan{}, out.preparedPlan)
		require.Equal(t, fallbacks+1, remote.fallbacks.Load())

		entries := logs.FilterMessageSnippet("planned by the router instead of a plan worker").TakeAll()
		require.Len(t, entries, 1)
		require.Equal(t, "unsupported", entries[0].ContextMap()["reason"])
		require.Contains(t, entries[0].ContextMap()["message"], "can only be planned by the router")
	})

	t.Run("event driven subgraph", func(t *testing.T) {
		opContext := &operationContext{
			content: graph.normalize(t, `mutation Publish { updateEmployeeMyKafka(employeeID: 1, update: {name: "a", email: "a@b.c"}) { success } }`),
			name:    "Publish",
		}
		fallbacks := remote.fallbacks.Load()

		out, err := planner.planOperationOnWorker(opContext)
		require.NoError(t, err)
		require.NotNil(t, out.preparedPlan)
		require.Equal(t, fallbacks+1, remote.fallbacks.Load())
	})

	t.Run("subscriptions are not sent to a worker", func(t *testing.T) {
		opContext := &operationContext{
			content: graph.normalize(t, `subscription Time { currentTime { unixTime } }`),
			name:    "Time",
			opType:  OperationTypeSubscription,
		}
		requests := pool.Stats().Requests
		fallbacks := remote.fallbacks.Load()

		out, err := planner.planOperationOnWorker(opContext)
		require.NoError(t, err)
		require.IsType(t, &plan.SubscriptionResponsePlan{}, out.preparedPlan)
		require.Equal(t, requests, pool.Stats().Requests)
		require.Equal(t, fallbacks, remote.fallbacks.Load())
	})

	t.Run("planning errors are reported by the router", func(t *testing.T) {
		opContext := &operationContext{content: `query Broken { doesNotExist }`, name: "Broken"}
		fallbacks := remote.fallbacks.Load()

		_, expectedErr := (&OperationPlanner{executor: graph.executor}).planOperation(opContext.content, opContext.name, false)
		require.Error(t, expectedErr)

		_, err := planner.planOperationOnWorker(opContext)
		var reportErr *reportError
		require.ErrorAs(t, err, &reportErr)
		require.Equal(t, expectedErr.Error(), err.Error())
		require.Equal(t, fallbacks+1, remote.fallbacks.Load())
	})

	t.Run("data source the router has no client for", func(t *testing.T) {
		// A plan the router can't execute must never be used.
		limited := *graph.executor
		limited.subgraphFetchClients = nil
		remote, err := newRemotePlanner(pool, graph.settings, graph.routerConfig.GetEngineConfig(), graph.routerConfig.GetSubgraphs(), &limited, zap.NewNop())
		require.NoError(t, err)
		t.Cleanup(remote.close)

		out, err := (&OperationPlanner{executor: &limited, remote: remote}).planOperationOnWorker(&operationContext{
			content: graph.normalize(t, `query Employees { employees { id } }`),
			name:    "Employees",
		})
		require.NoError(t, err)
		require.EqualValues(t, 1, remote.fallbacks.Load())
		require.Zero(t, remote.planned.Load())

		fetches := planFetches(t, out.preparedPlan)
		require.Len(t, fetches, 1)
		require.IsType(t, &graphql_datasource.Source{}, fetchDataSource(fetches[0]))
	})
}

func TestPlanWorkerFailuresAreNotRetriedByTheRouter(t *testing.T) {
	t.Parallel()

	graph := newPlanWorkerTestGraph(t, config.EngineExecutionConfiguration{})

	t.Run("timeout", func(t *testing.T) {
		t.Parallel()

		// Workers that never answer, like a worker stuck planning an operation.
		pool := newTestPlanWorkerPool(t, config.EnginePlanWorkersConfiguration{
			Count:       1,
			PlanTimeout: 100 * time.Millisecond,
		}, &blockingPlanWorkers{inner: inProcessPlanWorkers(t)})
		remote := graph.remotePlanner(t, pool, zap.NewNop())
		require.NoError(t, pool.Start(t.Context()))

		_, err := (&OperationPlanner{executor: graph.executor, remote: remote}).planOperationOnWorker(&operationContext{
			content: graph.normalize(t, `query Employees { employees { id } }`),
			name:    "Employees",
		})
		var httpErr HttpError
		require.ErrorAs(t, err, &httpErr)
		require.Equal(t, http.StatusGatewayTimeout, httpErr.StatusCode())
		require.Equal(t, "Query planning timed out", httpErr.Message())
		require.Zero(t, remote.fallbacks.Load())
	})
}

// blockingPlanWorkers starts workers that load configurations, but never answer a
// planning request.
type blockingPlanWorkers struct {
	inner planworker.Launcher
}

func (b *blockingPlanWorkers) Launch() (planworker.Conn, error) {
	conn, err := b.inner.Launch()
	if err != nil {
		return nil, err
	}
	return &blockingPlanWorkerConn{Conn: conn, release: make(chan struct{})}, nil
}

type blockingPlanWorkerConn struct {
	planworker.Conn
	// writes counts the messages sent to the worker. The first one loads the
	// configuration, everything after that is a planning request.
	mu      sync.Mutex
	writes  int
	release chan struct{}
	once    sync.Once
}

func (c *blockingPlanWorkerConn) Write(p []byte) (int, error) {
	c.mu.Lock()
	c.writes++
	block := c.writes > 1
	c.mu.Unlock()
	if block {
		<-c.release
		return 0, io.ErrClosedPipe
	}
	return c.Conn.Write(p)
}

func (c *blockingPlanWorkerConn) Close() error {
	c.once.Do(func() { close(c.release) })
	return c.Conn.Close()
}

func TestPlanWorkerConfigRoundTrip(t *testing.T) {
	t.Parallel()

	settings := planWorkerSettings{
		Introspection:  true,
		TrackUsageInfo: true,
		PluginsEnabled: true,
		// One value of every kind of type used in the settings.
		Execution: config.EngineExecutionConfiguration{
			Debug:                       config.EngineDebugConfiguration{PrintQueryPlans: true},
			EnableMultiFetch:            true,
			MaxConcurrentResolvers:      1024,
			ExecutionPlanCacheSize:      2048,
			SlowPlanCacheThreshold:      100 * time.Millisecond,
			WebSocketClientReadLimit:    config.BytesString(1 << 20),
			ValidateInlineArguments:     config.ValidateInlineArguments{ErrorMessage: "no inline arguments"},
			PlanWorkers:                 config.EnginePlanWorkersConfiguration{Enabled: true, Count: 4, PlanTimeout: 30 * time.Second},
			AllowStringLiteralsForEnums: true,
		},
	}
	routerConfig, err := execution_config.FromFile(planCodecTestConfig)
	require.NoError(t, err)

	cfg, err := newPlanWorkerConfig(settings, routerConfig.GetEngineConfig(), routerConfig.GetSubgraphs())
	require.NoError(t, err)

	var decoded planWorkerConfig
	_, err = planWorkerConfigCodec().Unmarshal(cfg.Payload, &decoded)
	require.NoError(t, err)
	require.Equal(t, settings, decoded.Settings)

	t.Run("the ID identifies the content", func(t *testing.T) {
		same, err := newPlanWorkerConfig(settings, routerConfig.GetEngineConfig(), routerConfig.GetSubgraphs())
		require.NoError(t, err)
		require.Equal(t, cfg.ID, same.ID)

		changed := settings
		changed.Execution.EnableMultiFetch = !changed.Execution.EnableMultiFetch
		other, err := newPlanWorkerConfig(changed, routerConfig.GetEngineConfig(), routerConfig.GetSubgraphs())
		require.NoError(t, err)
		require.NotEqual(t, cfg.ID, other.ID)
	})
}

// TestSubgraphFetchSourceMatchesEngine makes sure that fetches of plans from a plan worker
// send the same requests as fetches of plans the router planned itself.
func TestSubgraphFetchSourceMatchesEngine(t *testing.T) {
	type request struct {
		Method string
		Header http.Header
		Body   string
	}
	var (
		mu       sync.Mutex
		requests []request
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requests = append(requests, request{Method: r.Method, Header: r.Header.Clone(), Body: string(body)})
		mu.Unlock()
		_, _ = w.Write([]byte(`{"data":{"ok":true}}`))
	}))
	t.Cleanup(server.Close)

	// The engine only hands out its data source as part of a plan.
	graph := newPlanWorkerTestGraph(t, config.EngineExecutionConfiguration{})
	planned, err := (&OperationPlanner{executor: graph.executor}).planOperation(
		graph.normalize(t, `query Employees { employees { id } }`), "Employees", false,
	)
	require.NoError(t, err)
	fetches := planFetches(t, planned.preparedPlan)
	require.Len(t, fetches, 1)
	engineSource, ok := fetchDataSource(fetches[0]).(*graphql_datasource.Source)
	require.True(t, ok)

	// The planning-only data source of the engine uses the default client.
	ours := &subgraphFetchSource{httpClient: http.DefaultClient}

	inputs := map[string]string{
		"no variables":          `{"method":"POST","url":"%s","body":{"query":"{a}"}}`,
		"empty variables":       `{"method":"POST","url":"%s","body":{"query":"{a}","variables":{}}}`,
		"null variables":        `{"method":"POST","url":"%s","body":{"query":"{a}","variables":null}}`,
		"variables":             `{"method":"POST","url":"%s","body":{"query":"query($a: Int){a(a: $a)}","variables":{"a":1,"b":{"c":[1,2,null]}}}}`,
		"null variable":         `{"method":"POST","url":"%s","body":{"query":"query($a: Int){a(a: $a)}","variables":{"a":null,"b":2}}}`,
		"undefined variables":   `{"method":"POST","url":"%s","body":{"query":"query($a: Int, $b: Int){a(a: $a, b: $b)}","variables":{"a":null,"b":null,"c":3}},"undefined":["a"]}`,
		"all undefined":         `{"method":"POST","url":"%s","body":{"query":"query($a: Int){a(a: $a)}","variables":{"a":null}},"undefined":["a"]}`,
		"whitespace":            `{"method":"POST","url":"%s","body":{"query":"query($a: String){a(a: $a)}","variables":{"a":"x y", "b": [ 1, 2 ]}}}`,
		"headers":               `{"method":"POST","url":"%s","header":{"X-Static":["one","two"]},"body":{"query":"{a}","variables":{"a":1}}}`,
		"operation name":        `{"method":"POST","url":"%s","body":{"query":"query Q{a}","operationName":"Q","variables":{"a":"b"}}}`,
		"representations":       `{"method":"POST","url":"%s","body":{"query":"query($representations: [_Any!]!){_entities(representations: $representations){__typename}}","variables":{"representations":[{"__typename":"Employee","id":1},{"__typename":"Employee","id":2}]}}}`,
		"extensions":            `{"method":"POST","url":"%s","body":{"query":"{a}","variables":{"a":1},"extensions":{"fetch_reasons":[{"typename":"A","field":"b"}]}}}`,
		"get":                   `{"method":"GET","url":"%s","body":{"query":"{a}","variables":{"a":1}}}`,
		"not a graphql request": `{"method":"POST","url":"%s"}`,
	}

	headers := http.Header{"X-Request": []string{"1"}, "Authorization": []string{"Bearer token"}}

	for name, template := range inputs {
		t.Run(name, func(t *testing.T) {
			input := fmt.Sprintf(template, server.URL)

			capture := func(load func() ([]byte, error)) (request, string, error) {
				mu.Lock()
				requests = nil
				mu.Unlock()
				data, err := load()
				mu.Lock()
				defer mu.Unlock()
				if len(requests) == 0 {
					return request{}, string(data), err
				}
				require.Len(t, requests, 1)
				return requests[0], string(data), err
			}

			// The data sources are free to modify the input, each gets its own copy.
			expectedRequest, expectedData, expectedErr := capture(func() ([]byte, error) {
				return engineSource.Load(t.Context(), headers.Clone(), []byte(input))
			})
			actualRequest, actualData, actualErr := capture(func() ([]byte, error) {
				return ours.Load(t.Context(), headers.Clone(), []byte(input))
			})

			require.Equal(t, expectedErr, actualErr)
			require.Equal(t, expectedData, actualData)
			require.Equal(t, expectedRequest, actualRequest)
		})
	}
}
