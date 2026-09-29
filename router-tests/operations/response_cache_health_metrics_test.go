package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/pkg/config"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

const responseCacheMetricScope = "cosmo.router.response_cache"

// TestResponseCacheHealthMetrics covers the metrics of the response cache store itself.
func TestResponseCacheHealthMetrics(t *testing.T) {
	t.Parallel()

	const moodQuery = `query { employees { id currentMood } }`

	t.Run("lookups and writes are measured", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			MetricOptions: testenv.MetricOptions{EnableOTLPResponseCacheMetrics: true},
			RouterOptions: memoryCacheOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			keys := responseCacheKeysByResult(t, metricReader)
			stored := keys["write/stored"]
			require.Positive(t, stored, "mood answers with a Cache-Control, its entities are stored")
			require.Positive(t, keys["lookup/missing"])
			require.Zero(t, keys["lookup/found"])
			require.Zero(t, keys["write/failed"])

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			keys = responseCacheKeysByResult(t, metricReader)
			require.Equal(t, stored, keys["lookup/found"], "everything the first request stored is found by the second")
			require.Equal(t, stored, keys["write/stored"], "nothing is written for a hit")

			scope := responseCacheScope(t, metricReader)

			operations := map[string]int64{}
			sum, ok := testutils.GetMetricByName(scope, "router.response_cache.operations").Data.(metricdata.Sum[int64])
			require.True(t, ok)
			for _, dp := range sum.DataPoints {
				provider, _ := dp.Attributes.Value(otel.WgResponseCacheProvider)
				require.Equal(t, string(config.ResponseCacheStorageProviderMemory), provider.AsString())
				_, failed := dp.Attributes.Value(otel.WgErrorType)
				require.False(t, failed)

				operation, _ := dp.Attributes.Value(otel.WgResponseCacheOperation)
				operations[operation.AsString()] += dp.Value
			}
			require.Positive(t, operations[rmetric.ResponseCacheOperationLookup])
			require.Positive(t, operations[rmetric.ResponseCacheOperationWrite])

			duration, ok := testutils.GetMetricByName(scope, "router.response_cache.operation.duration_seconds").Data.(metricdata.Histogram[float64])
			require.True(t, ok)
			require.NotEmpty(t, duration.DataPoints)

			ttl, ok := testutils.GetMetricByName(scope, "router.response_cache.write.ttl_seconds").Data.(metricdata.Histogram[float64])
			require.True(t, ok)
			require.Len(t, ttl.DataPoints, 1)
			require.InDelta(t, 60, ttl.DataPoints[0].Sum/float64(ttl.DataPoints[0].Count), 1e-9, "the max-age mood answered with")

			bytes, ok := testutils.GetMetricByName(scope, "router.response_cache.write.bytes").Data.(metricdata.Sum[int64])
			require.True(t, ok)
			require.Positive(t, bytes.DataPoints[0].Value)

			for _, m := range scope.Metrics {
				require.NotContains(t, m.Name, "memory", "nothing is reported about a provider that is for tests only")
			}
		})
	})

	t.Run("invalidations are measured", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		addr := fmt.Sprintf("127.0.0.1:%d", freeport.GetOne(t))

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			MetricOptions: testenv.MetricOptions{EnableOTLPResponseCacheMetrics: true},
			RouterOptions: memoryCacheOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				cfg.Invalidation.Endpoint = config.ResponseCacheInvalidationEndpointConfig{
					Enabled:    true,
					ListenAddr: addr,
					Path:       "/invalidation",
					SharedKey:  responseCacheSharedKey,
				}
			}),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			status, removed := invalidateCacheKey(t, addr, responseCacheSharedKey,
				`[{"kind":"subgraph","subgraph":"mood"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Positive(t, removed)

			keys := responseCacheKeysByResult(t, metricReader)
			require.EqualValues(t, removed, keys["invalidate/removed"])
			require.Equal(t, keys["write/stored"], keys["invalidate/removed"], "everything stored for mood is removed")
		})
	})

	t.Run("fetches are counted with the type they resolve and what became of the response", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			TraceExporter: exporter,
			MetricOptions: testenv.MetricOptions{EnableOTLPResponseCacheMetrics: true},
			RouterOptions: memoryCacheOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("no-store")},
				Mood:      testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			span := attribute.NewSet(fetchSpanFor(t, exporter, "mood").Attributes()...)
			entityType, ok := span.Value(otel.WgEntityType)
			require.True(t, ok)
			require.Equal(t, "Employee", entityType.AsString())
			decision, ok := span.Value(otel.WgResponseCacheStoreDecision)
			require.True(t, ok)
			require.Equal(t, "stored", decision.AsString())
			_, ok = span.Value(otel.WgResponseCacheLookupDurationMs)
			require.True(t, ok)

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			fetches, ok := testutils.GetMetricByName(responseCacheScope(t, metricReader), "router.response_cache.fetches").Data.(metricdata.Sum[int64])
			require.True(t, ok)

			counts := map[string]int64{}
			for _, dp := range fetches.DataPoints {
				subgraph, _ := dp.Attributes.Value(otel.WgSubgraphName)
				entityType, _ := dp.Attributes.Value(otel.WgEntityType)
				status, _ := dp.Attributes.Value(otel.WgResponseCacheStatus)
				decision, _ := dp.Attributes.Value(otel.WgResponseCacheStoreDecision)
				counts[subgraph.AsString()+"/"+entityType.AsString()+"/"+status.AsString()+"/"+decision.AsString()] += dp.Value
			}
			require.Equal(t, map[string]int64{
				"employees/Query/miss/no_store": 2,
				"mood/Employee/miss/stored":     1,
				"mood/Employee/hit/":            1,
			}, counts)
		})
	})

	t.Run("prometheus exposes the metrics", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions:      testenv.MetricOptions{EnablePrometheusResponseCacheMetrics: true},
			RouterOptions:      memoryCacheOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			families, err := promRegistry.Gather()
			require.NoError(t, err)

			names := map[string]struct{}{}
			for _, family := range families {
				names[family.GetName()] = struct{}{}
			}
			for _, name := range []string{
				"router_response_cache_operations_total",
				"router_response_cache_operation_duration_seconds",
				"router_response_cache_keys_total",
				"router_response_cache_write_bytes_total",
				"router_response_cache_write_ttl_seconds",
				"router_response_cache_fetches_total",
			} {
				require.Contains(t, names, name)
			}

			require.Nil(t, testutils.GetMetricScopeByName(collectMetrics(t, metricReader).ScopeMetrics, responseCacheMetricScope),
				"only prometheus was enabled")
		})
	})

	t.Run("nothing is measured while the metrics are not enabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			RouterOptions: memoryCacheOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			require.Nil(t, testutils.GetMetricScopeByName(collectMetrics(t, metricReader).ScopeMetrics, responseCacheMetricScope))
		})
	})
}

func responseCacheScope(t *testing.T, reader *metric.ManualReader) *metricdata.ScopeMetrics {
	t.Helper()

	scope := testutils.GetMetricScopeByName(collectMetrics(t, reader).ScopeMetrics, responseCacheMetricScope)
	require.NotNil(t, scope)
	return scope
}

// responseCacheKeysByResult sums router.response_cache.keys, keyed by operation/result.
func responseCacheKeysByResult(t *testing.T, reader *metric.ManualReader) map[string]int64 {
	t.Helper()

	keys := testutils.GetMetricByName(responseCacheScope(t, reader), "router.response_cache.keys")
	require.NotNil(t, keys)
	sum, ok := keys.Data.(metricdata.Sum[int64])
	require.True(t, ok)

	counts := map[string]int64{}
	for _, dp := range sum.DataPoints {
		operation, _ := dp.Attributes.Value(otel.WgResponseCacheOperation)
		result, _ := dp.Attributes.Value(otel.WgResponseCacheResult)
		counts[operation.AsString()+"/"+result.AsString()] += dp.Value
	}
	return counts
}
