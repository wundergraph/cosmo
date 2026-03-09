package integration

import (
	"context"
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

	// distinctQueries are queries that normalize to different plans, used to overflow a small main cache.
	distinctQueries := []testenv.GraphQLRequest{
		{Query: `{ employees { id } }`},
		{Query: `query { employees { id details { forename } } }`},
		{Query: `query { employees { id details { forename surname } } }`},
		{Query: `query m($id: Int!){ employee(id: $id) { id details { forename surname } } }`, Variables: []byte(`{"id": 1}`)},
	}

	// waitForExpensiveCacheHits sends all distinctQueries, retrying until each one
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
				expensiveHit := res.Response.Header.Get("X-WG-Expensive-Plan-Cache") == "HIT"
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
			if res.Response.Header.Get("X-WG-Expensive-Plan-Cache") == "HIT" {
				expensiveCacheHits++
			}
		}
		return expensiveCacheHits
	}

	t.Run("expensive cache serves evicted plans from small main cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				// Tiny main cache: only 1 plan fits in Ristretto
				cfg.ExecutionPlanCacheSize = 1
				// All plans qualify as expensive (threshold effectively zero)
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send all distinct queries — each is a MISS and gets planned via singleflight.
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			hits := waitForExpensiveCacheHits(t, xEnv, distinctQueries)
			require.Greater(t, hits, 0, "expected at least one query to be served from the expensive cache")
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
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
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
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Populate caches with multiple distinct queries
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Trigger config reload — new Ristretto cache is created (size 1).
			<-pm.ready
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			// After reload, all queries should still be available via expensive cache.
			hits := waitForExpensiveCacheHits(t, xEnv, distinctQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			})
			require.Greater(t, hits, 0, "expected at least one query to be served from the expensive cache after config reload")
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
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
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
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm up with distinct queries
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			<-pm.ready

			// First reload
			pm.initConfig.Version = "v2"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			waitForExpensiveCacheHits(t, xEnv, distinctQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "v2", res.Response.Header.Get("X-Router-Config-Version"))
			})

			// Second reload
			pm.initConfig.Version = "v3"
			require.NoError(t, pm.updateConfig(pm.initConfig, "v2"))

			hits := waitForExpensiveCacheHits(t, xEnv, distinctQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "v3", res.Response.Header.Get("X-Router-Config-Version"))
			})
			require.Greater(t, hits, 0, "expected at least one query to be served from the expensive cache after multiple reloads")
		})
	})

	t.Run("expensive cache works without config reload", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
				cfg.ExpensiveQueryCacheSize = 10
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send multiple distinct queries to overflow the tiny main cache
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			hits := waitForExpensiveCacheHits(t, xEnv, distinctQueries)
			require.Greater(t, hits, 0, "expected at least one query to be served from the expensive cache")
		})
	})

	t.Run("router shuts down cleanly with expensive cache enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
				cfg.ExpensiveQueryCacheSize = 50
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make some requests to populate both caches
			for _, q := range distinctQueries {
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
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send multiple distinct queries to overflow the tiny main cache
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Wait for caches to converge, then reset spans for a clean measurement
			waitForExpensiveCacheHits(t, xEnv, distinctQueries)
			exporter.Reset()

			// Final pass to generate spans with known state
			for _, q := range distinctQueries {
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
				cfg.ExpensiveQueryThreshold = 1 * time.Nanosecond
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Overflow the tiny main cache
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
			}

			// Wait for caches to converge, then make a final pass for Prometheus
			waitForExpensiveCacheHits(t, xEnv, distinctQueries)

			for _, q := range distinctQueries {
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
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				// Header must be absent when feature is disabled
				require.Empty(t, res.Response.Header.Get("X-WG-Expensive-Plan-Cache"),
					"X-WG-Expensive-Plan-Cache header should not be present when InMemoryFallback is disabled")
			}

			// Second pass — cache hits
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Empty(t, res.Response.Header.Get("X-WG-Expensive-Plan-Cache"))
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

	t.Run("high threshold prevents fast plans from entering expensive cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				// Threshold so high no plan will qualify
				cfg.ExpensiveQueryThreshold = 1 * time.Hour
				cfg.ExpensiveQueryCacheSize = 100
			},
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:          true,
					InMemoryFallback: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Populate — all plans are fast (well under 1h threshold)
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"))
				// Feature is enabled so header is present, but should be MISS
				require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Expensive-Plan-Cache"))
			}

			// Wait for Ristretto eviction
			time.Sleep(200 * time.Millisecond)

			// Re-query — with main cache size 1, most are evicted from Ristretto.
			// Since no plan met the 1h threshold, the expensive cache is empty.
			// These should be re-planned (MISS on both caches).
			for _, q := range distinctQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Expensive-Plan-Cache"),
					"no plan should be in the expensive cache with a 1h threshold")
			}
		})
	})
}
