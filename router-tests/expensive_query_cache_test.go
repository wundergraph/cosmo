package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestExpensiveQueryCache(t *testing.T) {
	t.Parallel()

	// slowQueries are queries whose planning duration is overridden to exceed the threshold.
	slowQueries := []testenv.GraphQLRequest{
		{Query: `{ employees { id } }`},
		{Query: `query { employees { id details { forename } } }`},
	}

	// fastQueries are queries whose planning duration stays below the threshold.
	fastQueries := []testenv.GraphQLRequest{
		{Query: `query { employees { id details { forename surname } } }`},
		{Query: `query m($id: Int!){ employee(id: $id) { id details { forename surname } } }`, Variables: []byte(`{"id": 1}`)},
	}

	allQueries := make([]testenv.GraphQLRequest, 0, len(slowQueries)+len(fastQueries))
	allQueries = append(allQueries, slowQueries...)
	allQueries = append(allQueries, fastQueries...)

	expensiveThreshold := 1 * time.Second

	// The override function receives the normalized (minified) query content.
	// Both slow queries lack "surname", while all fast queries contain it.
	planningDurationOverride := core.WithPlanningDurationOverride(func(content string) time.Duration {
		if !strings.Contains(content, "surname") {
			return 10 * time.Second
		}
		return 0
	})

	// waitForExpensiveCacheHits sends all queries, retrying until each one
	// is served from either the main or expensive cache. Then it does a single
	// final pass and returns the number of expensive cache hits.
	waitForExpensiveCacheHits := func(t *testing.T, xEnv *testenv.Environment, queries []testenv.GraphQLRequest, extraChecks ...func(*assert.CollectT, *testenv.TestResponse)) int {
		t.Helper()

		// Wait until every query is served from some cache
		for _, q := range queries {
			require.EventuallyWithT(t, func(ct *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(q)
				assert.Equal(ct, 200, res.Response.StatusCode)
				planHit := res.Response.Header.Get("x-wg-execution-plan-cache") == "HIT"
				expensiveHit := res.Response.Header.Get("x-wg-expensive-plan-cache") == "HIT"
				assert.True(ct, planHit || expensiveHit, "expected plan to be served from main or expensive cache")
				for _, check := range extraChecks {
					check(ct, res)
				}
			}, 2*time.Second, 100*time.Millisecond)
		}

		// Single pass to count expensive cache hits
		expensiveCacheHits := 0
		for _, q := range queries {
			res := xEnv.MakeGraphQLRequestOK(q)
			if res.Response.Header.Get("x-wg-expensive-plan-cache") == "HIT" {
				expensiveCacheHits++
			}
		}
		return expensiveCacheHits
	}

	t.Run("expensive cache serves evicted plans from small main cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				planningDurationOverride,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send all queries — each is a MISS and gets planned via singleflight.
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Only slow queries should end up in the expensive cache
			hits := waitForExpensiveCacheHits(t, xEnv, slowQueries)
			require.Positive(t, hits, "expected at least one slow query to be served from the expensive cache")
		})
	})

	t.Run("fast queries do not enter expensive cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				planningDurationOverride,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send all queries
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
			}

			// Wait for Ristretto eviction
			time.Sleep(200 * time.Millisecond)

			// Fast queries should never be served from the expensive cache
			for _, q := range fastQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-expensive-plan-cache"),
					"fast query should not be in the expensive cache")
			}
		})
	})

	t.Run("evicted plans survive config reload via expensive cache with small main cache", func(t *testing.T) {
		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
					Source: config.CacheWarmupSource{
						CdnSource: config.CacheWarmupCDNSource{
							Enabled: true,
						},
					},
				}),
				core.WithConfigVersionHeader(true),
				planningDurationOverride,
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Populate caches with slow queries
			for _, q := range slowQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Trigger config reload — new Ristretto cache is created (size 1).
			<-pm.ready
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			// After reload, slow queries should still be available via expensive cache.
			hits := waitForExpensiveCacheHits(t, xEnv, slowQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			})
			require.Positive(t, hits, "expected at least one query to be served from the expensive cache after config reload")
		})
	})

	t.Run("only expensive queries persist across config reload, fast queries do not", func(t *testing.T) {
		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				// Large enough to hold all queries — no evictions before reload
				cfg.ExecutionPlanCacheSize = 1024
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
					Source: config.CacheWarmupSource{
						CdnSource: config.CacheWarmupCDNSource{
							Enabled: true,
						},
					},
				}),
				core.WithConfigVersionHeader(true),
				planningDurationOverride,
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Populate caches with both slow and fast queries
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Verify all queries are cached in the main plan cache before reload
			for _, q := range allQueries {
				require.EventuallyWithT(t, func(ct *assert.CollectT) {
					res := xEnv.MakeGraphQLRequestOK(q)
					assert.Equal(ct, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
				}, 2*time.Second, 100*time.Millisecond)
			}

			// Trigger config reload — main plan cache is reset.
			<-pm.ready
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			// Wait for reload to complete by checking a slow query (which will be
			// served from the expensive cache, confirming the new server is active).
			require.EventuallyWithT(t, func(ct *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(slowQueries[0])
				assert.Equal(ct, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			}, 2*time.Second, 100*time.Millisecond)

			// After reload, fast queries must not be persisted anywhere — the first
			// request on the new server should be a MISS on both caches.
			for _, q := range fastQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "updated", res.Response.Header.Get("X-Router-Config-Version"))
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"),
					"fast query should not be in main plan cache after config reload")
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-expensive-plan-cache"),
					"fast query should not be in expensive cache after config reload")
			}
		})
	})

	t.Run("plans survive multiple config reloads with small main cache", func(t *testing.T) {
		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
					Source: config.CacheWarmupSource{
						CdnSource: config.CacheWarmupCDNSource{
							Enabled: true,
						},
					},
				}),
				core.WithConfigVersionHeader(true),
				planningDurationOverride,
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm up with slow queries
			for _, q := range slowQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			<-pm.ready

			// First reload
			pm.initConfig.Version = "v2"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			waitForExpensiveCacheHits(t, xEnv, slowQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "v2", res.Response.Header.Get("X-Router-Config-Version"))
			})

			// Second reload
			pm.initConfig.Version = "v3"
			require.NoError(t, pm.updateConfig(pm.initConfig, "v2"))

			hits := waitForExpensiveCacheHits(t, xEnv, slowQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "v3", res.Response.Header.Get("X-Router-Config-Version"))
			})
			require.Positive(t, hits, "expected at least one query to be served from the expensive cache after multiple reloads")
		})
	})

	t.Run("expensive cache works without config reload", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 10
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				planningDurationOverride,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send slow queries to overflow the tiny main cache
			for _, q := range slowQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			hits := waitForExpensiveCacheHits(t, xEnv, slowQueries)
			require.Positive(t, hits, "expected at least one query to be served from the expensive cache")
		})
	})

	t.Run("router shuts down cleanly with expensive cache enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 50
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				planningDurationOverride,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make some requests to populate both caches
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
			}
			// testenv.Run handles shutdown — test verifies no panic or hang
		})
	})

	t.Run("expensive cache hit is recorded in span attributes", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				planningDurationOverride,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send slow queries to overflow the tiny main cache
			for _, q := range slowQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Wait for caches to converge, then reset spans for a clean measurement
			waitForExpensiveCacheHits(t, xEnv, slowQueries)
			exporter.Reset()

			// Final pass to generate spans with known state
			for _, q := range slowQueries {
				xEnv.MakeGraphQLRequestOK(q)
			}

			// Verify spans contain the expensive_plan_cache_hit attribute
			sn := exporter.GetSpans().Snapshots()
			expensiveHitSpanFound := false
			for _, span := range sn {
				if span.Name() == "Operation - Plan" {
					for _, attr := range span.Attributes() {
						if attr.Key == otel.WgEngineExpensivePlanCacheHit && attr.Value.AsBool() {
							expensiveHitSpanFound = true
							// plan_cache_hit should be false for expensive cache hits
							require.Contains(t, span.Attributes(), otel.WgEnginePlanCacheHit.Bool(false))
						}
					}
				}
			}
			require.True(t, expensiveHitSpanFound, "expected at least one 'Operation - Plan' span with wg.engine.expensive_plan_cache_hit=true")

			// Verify OTEL metrics include the expensive_plan_cache_hit attribute
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			metricScope := GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, metricScope)

			planningMetric := GetMetricByName(metricScope, "router.graphql.operation.planning_time")
			require.NotNil(t, planningMetric)

			hist := planningMetric.Data.(metricdata.Histogram[float64])
			expensiveHitMetricFound := false
			for _, dp := range hist.DataPoints {
				val, found := dp.Attributes.Value(otel.WgEngineExpensivePlanCacheHit)
				if found && val.AsBool() {
					expensiveHitMetricFound = true
					// plan_cache_hit should be false for expensive cache hits
					planVal, planFound := dp.Attributes.Value(otel.WgEnginePlanCacheHit)
					require.True(t, planFound)
					require.False(t, planVal.AsBool())
					break
				}
			}
			require.True(t, expensiveHitMetricFound, "expected planning_time metric with wg.engine.expensive_plan_cache_hit=true")
		})
	})

	t.Run("expensive cache hit is recorded in Prometheus metrics", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				planningDurationOverride,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Overflow the tiny main cache with slow queries
			for _, q := range slowQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Wait for caches to converge, then make a final pass for Prometheus
			waitForExpensiveCacheHits(t, xEnv, slowQueries)

			for _, q := range slowQueries {
				xEnv.MakeGraphQLRequestOK(q)
			}

			// Gather Prometheus metrics
			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			planningTime := findMetricFamilyByName(mf, "router_graphql_operation_planning_time")
			require.NotNil(t, planningTime, "expected router_graphql_operation_planning_time metric")

			// Verify the expensive_plan_cache_hit label exists
			expensiveHitFound := false
			for _, m := range planningTime.GetMetric() {
				for _, label := range m.GetLabel() {
					if label.GetName() == "wg_engine_expensive_plan_cache_hit" && label.GetValue() == "true" {
						expensiveHitFound = true
						// plan_cache_hit should be false for expensive cache hits
						for _, subLabel := range m.GetLabel() {
							if subLabel.GetName() == "wg_engine_plan_cache_hit" {
								require.Equal(t, "false", subLabel.GetValue(), "plan_cache_hit should be false when expensive_plan_cache_hit is true")
							}
						}
					}
				}
			}
			require.True(t, expensiveHitFound, "expected Prometheus metric with wg_engine_expensive_plan_cache_hit=true")

			// Also verify that the false value exists (from initial MISS requests)
			expensiveMissFound := false
			for _, m := range planningTime.GetMetric() {
				for _, label := range m.GetLabel() {
					if label.GetName() == "wg_engine_expensive_plan_cache_hit" && label.GetValue() == "false" {
						expensiveMissFound = true
					}
				}
			}
			require.True(t, expensiveMissFound, "expected Prometheus metric with wg_engine_expensive_plan_cache_hit=false")
		})
	})

	t.Run("no expensive cache header or telemetry when feature is disabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			// InMemoryFallback is NOT set — expensive cache is disabled
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				// Header must be absent when feature is disabled
				require.Empty(t, res.Response.Header.Get("x-wg-expensive-plan-cache"),
					"x-wg-expensive-plan-cache header should not be present when InMemoryFallback is disabled")
			}

			// Second pass — cache hits
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Empty(t, res.Response.Header.Get("x-wg-expensive-plan-cache"))
			}

			// Verify spans do NOT contain the expensive_plan_cache_hit attribute
			sn := exporter.GetSpans().Snapshots()
			for _, span := range sn {
				if span.Name() == "Operation - Plan" {
					for _, attr := range span.Attributes() {
						require.NotEqual(t, otel.WgEngineExpensivePlanCacheHit, attr.Key,
							"wg.engine.expensive_plan_cache_hit attribute should not be present when feature is disabled")
					}
				}
			}

			// Verify OTEL metrics do NOT contain the attribute
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			metricScope := GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			if metricScope != nil {
				planningMetric := GetMetricByName(metricScope, "router.graphql.operation.planning_time")
				if planningMetric != nil {
					hist := planningMetric.Data.(metricdata.Histogram[float64])
					for _, dp := range hist.DataPoints {
						_, found := dp.Attributes.Value(otel.WgEngineExpensivePlanCacheHit)
						require.False(t, found,
							"wg.engine.expensive_plan_cache_hit attribute should not be present in OTEL metrics when feature is disabled")
					}
				}
			}

			// Verify Prometheus metrics do NOT contain the label
			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			planningTime := findMetricFamilyByName(mf, "router_graphql_operation_planning_time")
			if planningTime != nil {
				for _, m := range planningTime.GetMetric() {
					for _, label := range m.GetLabel() {
						require.NotEqual(t, "wg_engine_expensive_plan_cache_hit", label.GetName(),
							"wg_engine_expensive_plan_cache_hit label should not be present in Prometheus when feature is disabled")
					}
				}
			}
		})
	})

	t.Run("expensive cache entries survive static execution config reload", func(t *testing.T) {
		t.Parallel()

		configFile := t.TempDir() + "/config.json"
		writeTestConfig(t, "initial", configFile)

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1024
				cfg.ExpensiveQueryThreshold = expensiveThreshold
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
				core.WithExecutionConfig(&core.ExecutionConfig{
					Path:          configFile,
					Watch:         true,
					WatchInterval: 100 * time.Millisecond,
				}),
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				// "hello" is slow (enters expensive cache), "world" is fast (does not)
				core.WithPlanningDurationOverride(func(content string) time.Duration {
					if strings.Contains(content, "hello") {
						return 10 * time.Second
					}
					return 0
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			slowQ := testenv.GraphQLRequest{Query: `query { hello }`}
			fastQ := testenv.GraphQLRequest{Query: `query { world }`}

			// Plan both queries
			for _, q := range []testenv.GraphQLRequest{slowQ, fastQ} {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))
			}

			// Trigger schema reload
			writeTestConfig(t, "updated", configFile)

			// Wait for reload to complete — slow query should survive via expensive cache
			require.EventuallyWithT(t, func(ct *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(slowQ)
				assert.Equal(ct, "updated", res.Response.Header.Get("X-Router-Config-Version"))
				planHit := res.Response.Header.Get("x-wg-execution-plan-cache") == "HIT"
				expensiveHit := res.Response.Header.Get("x-wg-expensive-plan-cache") == "HIT"
				assert.True(ct, planHit || expensiveHit, "expected slow plan to survive schema reload")
			}, 2*time.Second, 100*time.Millisecond)

			// Fast query must not be persisted anywhere after reload
			res := xEnv.MakeGraphQLRequestOK(fastQ)
			require.Equal(t, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"),
				"fast query should not be in main plan cache after schema reload")
			require.Equal(t, "MISS", res.Response.Header.Get("x-wg-expensive-plan-cache"),
				"fast query should not survive schema reload via expensive cache")
		})
	})

	t.Run("high threshold prevents fast plans from entering expensive cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = 1 * time.Hour
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
				// No planning duration override — all plans are fast
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Populate — all plans are fast (well under 1h threshold)
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
				// Feature is enabled so header is present, but should be MISS
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-expensive-plan-cache"))
			}

			// Wait for Ristretto eviction
			time.Sleep(200 * time.Millisecond)

			// Re-query — with main cache size 1, most are evicted from Ristretto.
			// Since no plan met the 1h threshold, the expensive cache is empty.
			// These should be re-planned (MISS on both caches).
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-expensive-plan-cache"),
					"no plan should be in the expensive cache with a 1h threshold")
			}
		})
	})
}
