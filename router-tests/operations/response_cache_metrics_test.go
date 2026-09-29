package integration

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltracetest "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

// TestResponseCacheMetrics covers the wg.response_cache.status attribute the
// router attaches to subgraph metrics and spans while the response cache is on.
func TestResponseCacheMetrics(t *testing.T) {
	t.Parallel()

	const moodQuery = `query { employees { id currentMood } }`

	// The memory provider keeps these tests off redis. The attribute is read
	// from what the engine reports, which is the same for every provider.
	memoryCacheOptions := func(t *testing.T, mutate func(*config.ResponseCacheConfiguration)) []core.Option {
		t.Helper()
		cfg := responseCacheConfig(t, time.Minute)
		cfg.Storage = config.ResponseCacheStorageConfig{
			Provider:   config.ResponseCacheStorageProviderMemory,
			MaxEntries: 1000,
		}
		if mutate != nil {
			mutate(cfg)
		}
		return []core.Option{core.WithResponseCache(cfg)}
	}

	t.Run("a hit and a miss are told apart on the subgraph request counter", func(t *testing.T) {
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
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			counts := subgraphRequestsByCacheStatus(t, metricReader, "mood")
			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusMiss: 1,
				core.ResponseCacheStatusHit:  1,
			}, counts, "the first fetch missed and filled the cache, the second was answered from it")

			counts = subgraphRequestsByCacheStatus(t, metricReader, "employees")
			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusMiss: 2,
			}, counts, "employees answers without Cache-Control, so it is never cached and every fetch is a miss")
		})
	})

	t.Run("the latency histogram is split by status so a hit and a miss can be compared", func(t *testing.T) {
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
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			rm := collectMetrics(t, metricReader)
			scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scope)
			latency := testutils.GetMetricByName(scope, "router.http.request.duration_milliseconds")
			require.NotNil(t, latency)
			hist, ok := latency.Data.(metricdata.Histogram[float64])
			require.True(t, ok)

			seen := map[string]uint64{}
			for _, dp := range hist.DataPoints {
				if name, _ := dp.Attributes.Value(otel.WgSubgraphName); name.AsString() != "mood" {
					continue
				}
				status, ok := dp.Attributes.Value(otel.WgResponseCacheStatus)
				require.True(t, ok, "every mood fetch carries a cache status")
				seen[status.AsString()] += dp.Count
			}
			require.Equal(t, map[string]uint64{
				core.ResponseCacheStatusMiss: 1,
				core.ResponseCacheStatusHit:  1,
			}, seen)
		})
	})

	t.Run("the fetch span carries the status", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			RouterOptions: memoryCacheOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, core.ResponseCacheStatusMiss, fetchSpanCacheStatus(t, exporter, "mood"))

			exporter.Reset()

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, core.ResponseCacheStatusHit, fetchSpanCacheStatus(t, exporter, "mood"))
		})
	})

	t.Run("the fetch span carries the type, the store decision and the lookup time", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			RouterOptions: memoryCacheOptions(t, nil),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("no-store")},
				Mood:      testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			for subgraph, want := range map[string][2]string{
				"employees": {"Query", "no_store"},
				"mood":      {"Employee", "stored"},
			} {
				attrs := attribute.NewSet(fetchSpanFor(t, exporter, subgraph).Attributes()...)

				entityType, ok := attrs.Value(otel.WgEntityType)
				require.True(t, ok)
				require.Equal(t, want[0], entityType.AsString())

				decision, ok := attrs.Value(otel.WgResponseCacheStoreDecision)
				require.True(t, ok)
				require.Equal(t, want[1], decision.AsString())

				_, ok = attrs.Value(otel.WgResponseCacheLookupDurationMs)
				require.True(t, ok)
			}

			exporter.Reset()
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			attrs := attribute.NewSet(fetchSpanFor(t, exporter, "mood").Attributes()...)
			_, ok := attrs.Value(otel.WgResponseCacheStoreDecision)
			require.False(t, ok, "nothing is decided for a hit")
		})
	})

	t.Run("a mutation is not cacheable", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			RouterOptions: memoryCacheOptions(t, nil),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeTag(id: 1, tag: "cached") { id } }`,
			})

			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusNotCacheable: 1,
			}, subgraphRequestsByCacheStatus(t, metricReader, "employees"))
		})
	})

	t.Run("the status is available to expressions", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			RouterOptions: memoryCacheOptions(t, nil),
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Key: "cache",
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "subgraph.response.cache.status",
					},
				},
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			rm := collectMetrics(t, metricReader)
			scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scope)
			requests := testutils.GetMetricByName(scope, "router.http.requests")
			require.NotNil(t, requests)
			sum, ok := requests.Data.(metricdata.Sum[int64])
			require.True(t, ok)

			custom := map[string]int64{}
			for _, dp := range sum.DataPoints {
				if name, _ := dp.Attributes.Value(otel.WgSubgraphName); name.AsString() != "mood" {
					continue
				}
				value, ok := dp.Attributes.Value(attribute.Key("cache"))
				require.True(t, ok)
				custom[value.AsString()] += dp.Value
			}
			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusMiss: 1,
				core.ResponseCacheStatusHit:  1,
			}, custom)
		})
	})

	t.Run("the subgraph access log of a hit carries the status", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:             memoryCacheOptions(t, nil),
			SubgraphAccessLogsEnabled: true,
			SubgraphAccessLogFields: []config.CustomAttribute{
				{
					Key: "cache_status",
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "subgraph.response.cache.status",
					},
				},
				{
					Key: "operation_name",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const namedMoodQuery = `query Moods { employees { id currentMood } }`

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: namedMoodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: namedMoodQuery})

			var statuses []string
			for _, entry := range xEnv.Observer().FilterField(zap.String("subgraph_name", "mood")).All() {
				fields := entry.ContextMap()
				if fields["log_type"] != "client/subgraph" {
					continue
				}
				require.Equal(t, "Moods", fields["operation_name"])
				require.NotEmpty(t, fields["request_id"])
				statuses = append(statuses, fields["cache_status"].(string))
			}
			require.Equal(t, []string{core.ResponseCacheStatusMiss, core.ResponseCacheStatusHit}, statuses,
				"no request is sent for a hit, its fields must not depend on one")
		})
	})

	t.Run("the hit rate can be split by operation once the operation name is enabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			RouterOptions: memoryCacheOptions(t, nil),
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Key: string(otel.WgOperationName),
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const namedMoodQuery = `query Moods { employees { id currentMood } }`

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: namedMoodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: namedMoodQuery})

			rm := collectMetrics(t, metricReader)
			scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scope)
			requests := testutils.GetMetricByName(scope, "router.http.requests")
			require.NotNil(t, requests)
			sum, ok := requests.Data.(metricdata.Sum[int64])
			require.True(t, ok)

			byOperation := map[string]int64{}
			for _, dp := range sum.DataPoints {
				if name, _ := dp.Attributes.Value(otel.WgSubgraphName); name.AsString() != "mood" {
					continue
				}
				operation, _ := dp.Attributes.Value(otel.WgOperationName)
				status, _ := dp.Attributes.Value(otel.WgResponseCacheStatus)
				byOperation[operation.AsString()+"/"+status.AsString()] += dp.Value
			}
			require.Equal(t, map[string]int64{
				"Moods/" + core.ResponseCacheStatusMiss: 1,
				"Moods/" + core.ResponseCacheStatusHit:  1,
			}, byOperation)
		})
	})

	t.Run("a response is a partial hit while one of its subgraphs is never cached", func(t *testing.T) {
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
			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusMiss: 1,
			}, routerRequestsByCacheStatus(t, metricReader))

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusMiss:       1,
				core.ResponseCacheStatusPartialHit: 1,
			}, routerRequestsByCacheStatus(t, metricReader), "mood was answered from the cache, employees was not")
		})
	})

	t.Run("a response is a hit once every fetch is answered from the cache", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			TraceExporter: exporter,
			RouterOptions: memoryCacheOptions(t, nil),
			AccessLogFields: []config.CustomAttribute{
				{
					Key: "cache_status",
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "response.cache.status",
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
				Mood:      testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			exporter.Reset()

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load())
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			require.Equal(t, map[string]int64{
				core.ResponseCacheStatusMiss: 1,
				core.ResponseCacheStatusHit:  1,
			}, routerRequestsByCacheStatus(t, metricReader))

			for _, name := range []string{"Operation - Execute", "query unnamed"} {
				attrs := attribute.NewSet(spanByName(t, exporter, name).Attributes()...)
				status, ok := attrs.Value(otel.WgOperationResponseCacheStatus)
				require.True(t, ok, "span %q carries no cache status", name)
				require.Equal(t, core.ResponseCacheStatusHit, status.AsString())
			}

			var statuses []string
			for _, entry := range xEnv.Observer().FilterField(zap.String("log_type", "request")).All() {
				statuses = append(statuses, entry.ContextMap()["cache_status"].(string))
			}
			require.Equal(t, []string{core.ResponseCacheStatusMiss, core.ResponseCacheStatusHit}, statuses)
		})
	})

	t.Run("a response without a fetch has no status", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			RouterOptions: memoryCacheOptions(t, nil),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { __schema { queryType { name } } }`})

			require.Equal(t, map[string]int64{"": 1}, routerRequestsByCacheStatus(t, metricReader))
		})
	})

	t.Run("nothing is attached when the cache is not configured", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			MetricReader:  metricReader,
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			counts := subgraphRequestsByCacheStatus(t, metricReader, "mood")
			require.Equal(t, map[string]int64{"": 2}, counts,
				"without a cache every fetch would read as a miss, which is noise rather than a signal")

			attrs := attribute.NewSet(fetchSpanFor(t, exporter, "mood").Attributes()...)
			_, ok := attrs.Value(otel.WgResponseCacheStatus)
			require.False(t, ok)

			require.Equal(t, map[string]int64{"": 2}, routerRequestsByCacheStatus(t, metricReader))
		})
	})

	t.Run("a merged fetch with warm and cold entities in it is a partial hit", func(t *testing.T) {
		t.Parallel()

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

		metricReader := metric.NewManualReader()
		addr := fmt.Sprintf("127.0.0.1:%d", freeport.GetOne(t))

		employees := &entityRequestRecorder{}
		employees.cacheControl.Store("public, max-age=60")

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			RouterOptions: memoryCacheOptions(t, func(cfg *config.ResponseCacheConfiguration) {
				cfg.Invalidation.Endpoint = config.ResponseCacheInvalidationEndpointConfig{
					Enabled:    true,
					ListenAddr: addr,
					Path:       "/invalidation",
					SharedKey:  responseCacheSharedKey,
				}
			}),
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableMultiFetch = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{Middleware: employees.middleware},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Len(t, employees.entityRequests(), 1, "the two entity fetches were merged into one request")

			// Drop the Consultancy the merged fetch cached and keep the Employee,
			// so the next merged fetch is warm for one alias and cold for the other.
			status, count := invalidateCacheKey(t, addr, responseCacheSharedKey,
				`[{"kind":"type","subgraph":"employees","type":"Consultancy"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Equal(t, 1, count)

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Len(t, employees.entityRequests(), 2, "the cold alias sends the merged request out again")

			counts := subgraphRequestsByCacheStatus(t, metricReader, "employees")
			require.Equal(t, int64(1), counts[core.ResponseCacheStatusPartialHit],
				"the second merged fetch went out, but the Employee in it was served from the cache")
			require.Zero(t, counts[core.ResponseCacheStatusHit])
		})
	})
}

func collectMetrics(t *testing.T, reader *metric.ManualReader) metricdata.ResourceMetrics {
	t.Helper()
	rm := metricdata.ResourceMetrics{}
	require.NoError(t, reader.Collect(context.Background(), &rm))
	return rm
}

// subgraphRequestsByCacheStatus sums router.http.requests for one subgraph,
// keyed by wg.response_cache.status. Fetches without the attribute land under "".
func subgraphRequestsByCacheStatus(t *testing.T, reader *metric.ManualReader, subgraph string) map[string]int64 {
	t.Helper()

	rm := collectMetrics(t, reader)
	scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
	require.NotNil(t, scope)
	requests := testutils.GetMetricByName(scope, "router.http.requests")
	require.NotNil(t, requests)
	sum, ok := requests.Data.(metricdata.Sum[int64])
	require.True(t, ok)

	counts := map[string]int64{}
	for _, dp := range sum.DataPoints {
		if name, _ := dp.Attributes.Value(otel.WgSubgraphName); name.AsString() != subgraph {
			continue
		}
		status, _ := dp.Attributes.Value(otel.WgResponseCacheStatus)
		counts[status.AsString()] += dp.Value
	}
	return counts
}

// routerRequestsByCacheStatus sums router.http.requests of the router itself,
// keyed by wg.operation.response_cache.status. Responses without the attribute land under "".
func routerRequestsByCacheStatus(t *testing.T, reader *metric.ManualReader) map[string]int64 {
	t.Helper()

	rm := collectMetrics(t, reader)
	scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
	require.NotNil(t, scope)
	requests := testutils.GetMetricByName(scope, "router.http.requests")
	require.NotNil(t, requests)
	sum, ok := requests.Data.(metricdata.Sum[int64])
	require.True(t, ok)

	counts := map[string]int64{}
	for _, dp := range sum.DataPoints {
		if _, ok := dp.Attributes.Value(otel.WgSubgraphName); ok {
			continue
		}
		status, _ := dp.Attributes.Value(otel.WgOperationResponseCacheStatus)
		counts[status.AsString()] += dp.Value
	}
	return counts
}

func spanByName(t *testing.T, exporter *oteltracetest.InMemoryExporter, name string) sdktrace.ReadOnlySpan {
	t.Helper()

	for _, span := range exporter.GetSpans().Snapshots() {
		if span.Name() == name {
			return span
		}
	}
	require.FailNowf(t, "span not found", "no span named %q", name)
	return nil
}

// fetchSpanFor is the Engine - Fetch span of one subgraph among the exported spans.
func fetchSpanFor(t *testing.T, exporter *oteltracetest.InMemoryExporter, subgraph string) sdktrace.ReadOnlySpan {
	t.Helper()

	for _, span := range exporter.GetSpans().Snapshots() {
		if span.Name() != "Engine - Fetch" {
			continue
		}
		attrs := attribute.NewSet(span.Attributes()...)
		if name, _ := attrs.Value(otel.WgSubgraphName); name.AsString() == subgraph {
			return span
		}
	}
	require.FailNowf(t, "span not found", "no Engine - Fetch span for subgraph %q", subgraph)
	return nil
}

func fetchSpanCacheStatus(t *testing.T, exporter *oteltracetest.InMemoryExporter, subgraph string) string {
	t.Helper()

	attrs := attribute.NewSet(fetchSpanFor(t, exporter, subgraph).Attributes()...)
	status, ok := attrs.Value(otel.WgResponseCacheStatus)
	require.True(t, ok, "the fetch span for %q carries no cache status", subgraph)
	return status.AsString()
}
