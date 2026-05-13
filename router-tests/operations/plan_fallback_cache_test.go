package integration

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
)

func TestPlanFallbackCache(t *testing.T) {
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

	fallbackThreshold := 1 * time.Second

	// The override function receives the normalized (minified) query content.
	// Both slow queries lack "surname", while all fast queries contain it.
	planningDurationOverride := core.WithPlanningDurationOverride(func(content string) time.Duration {
		if !strings.Contains(content, "surname") {
			return 10 * time.Second
		}
		return 0
	})

	// waitForPlanCacheHits sends all queries, retrying until each one
	// is served from the plan cache (which includes fallback cache promotions).
	waitForPlanCacheHits := func(t *testing.T, xEnv *testenv.Environment, queries []testenv.GraphQLRequest, extraChecks ...func(*assert.CollectT, *testenv.TestResponse)) {
		t.Helper()

		for _, q := range queries {
			require.EventuallyWithT(t, func(ct *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(q)
				assert.Equal(ct, 200, res.Response.StatusCode)
				assert.Equal(ct, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"),
					"expected plan to be served from cache")
				for _, check := range extraChecks {
					check(ct, res)
				}
			}, 2*time.Second, 100*time.Millisecond)
		}
	}

	t.Run("fallback cache serves evicted plans from small main cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 100
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

			// Slow queries should be served from cache (via fallback promotion)
			waitForPlanCacheHits(t, xEnv, slowQueries)
		})
	})

	t.Run("fast queries do not enter fallback cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 100
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

			// Fast queries should not be cached after eviction from the tiny main cache
			for _, q := range fastQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"),
					"fast query should not be in cache after eviction")
			}
		})
	})

	t.Run("evicted plans survive config reload via fallback cache with small main cache", func(t *testing.T) {
		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 100
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
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			// After reload, slow queries should still be available via fallback cache.
			waitForPlanCacheHits(t, xEnv, slowQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			})
		})
	})

	t.Run("only slow queries persist across config reload, fast queries do not", func(t *testing.T) {
		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				// Large enough to hold all queries — no evictions before reload
				cfg.ExecutionPlanCacheSize = 1024
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 100
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
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			// Wait for reload to complete by checking a slow query (which will be
			// served from the fallback cache, confirming the new server is active).
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
					"fast query should not be in plan cache after config reload")
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
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 100
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
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			waitForPlanCacheHits(t, xEnv, slowQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "v2", res.Response.Header.Get("X-Router-Config-Version"))
			})

			// Second reload
			pm.initConfig.Version = "v3"
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			waitForPlanCacheHits(t, xEnv, slowQueries, func(ct *assert.CollectT, res *testenv.TestResponse) {
				assert.Equal(ct, "v3", res.Response.Header.Get("X-Router-Config-Version"))
			})
		})
	})

	t.Run("fallback cache works without config reload", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 10
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

			waitForPlanCacheHits(t, xEnv, slowQueries)
		})
	})

	t.Run("router shuts down cleanly with fallback cache enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 50
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

	t.Run("fallback cache entries survive static execution config reload", func(t *testing.T) {
		t.Parallel()

		configFile := t.TempDir() + "/config.json"
		writeTestConfig(t, "initial", configFile)

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1024
				cfg.SlowPlanCacheThreshold = fallbackThreshold
				cfg.SlowPlanCacheSize = 100
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
				// "hello" is slow (enters fallback cache), "world" is fast (does not)
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

			// Wait for reload to complete — slow query should survive via fallback cache
			require.EventuallyWithT(t, func(ct *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(slowQ)
				assert.Equal(ct, "updated", res.Response.Header.Get("X-Router-Config-Version"))
				assert.Equal(ct, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"),
					"expected slow plan to survive schema reload")
			}, 2*time.Second, 100*time.Millisecond)

			// Fast query must not be persisted anywhere after reload
			res := xEnv.MakeGraphQLRequestOK(fastQ)
			require.Equal(t, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"),
				"fast query should not be in plan cache after schema reload")
		})
	})

	t.Run("high threshold prevents fast plans from entering fallback cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.ExecutionPlanCacheSize = 1
				cfg.SlowPlanCacheThreshold = 1 * time.Hour
				cfg.SlowPlanCacheSize = 100
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
			}

			// Wait for Ristretto eviction
			time.Sleep(200 * time.Millisecond)

			// Re-query — with main cache size 1, most are evicted from Ristretto.
			// Since no plan met the 1h threshold, the fallback cache is empty.
			// These should be re-planned (MISS).
			for _, q := range allQueries {
				res := xEnv.MakeGraphQLRequestOK(q)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, "MISS", res.Response.Header.Get("x-wg-execution-plan-cache"),
					"no plan should be cached with a 1h threshold")
			}
		})
	})
}
