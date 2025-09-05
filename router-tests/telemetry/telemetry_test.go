package telemetry

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.19.0"
	"go.opentelemetry.io/otel/trace"

	integration "github.com/wundergraph/cosmo/router-tests"
)

const (
	defaultExposedScopedMetricsCount = 1
	defaultCosmoRouterMetricsCount   = 7
)

func TestFlakyEngineStatisticsTelemetry(t *testing.T) {
	t.Parallel()

	t.Run("Should provide correct metrics for one subscription over SSE", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				OTLPEngineStatsOptions: testenv.EngineStatOptions{
					EnableSubscription: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var wg sync.WaitGroup
			wg.Add(2)

			var sentMessages int64 = 0

			go xEnv.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Accept":        {"text/event-stream"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
				},
			}, func(data string) {
				defer wg.Done()

				sentMessages += 1

				xEnv.WaitForMinMessagesSent(uint64(sentMessages), time.Second*5)

				xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
					Subscriptions: 1,
					Connections:   1,
					MessagesSent:  sentMessages,
					Triggers:      1,
				})
			})

			wg.Wait()

			cancel()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 0,
				Connections:   0,
				MessagesSent:  sentMessages,
				Triggers:      0,
			})
		})
	})

	t.Run("Should provide correct metrics for multiple subscriptions over SSE", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				OTLPEngineStatsOptions: testenv.EngineStatOptions{
					EnableSubscription: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var wg1 sync.WaitGroup
			var wg2 sync.WaitGroup
			wg1.Add(2)
			wg2.Add(2)

			sentMessages := &atomic.Int64{}

			go xEnv.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Accept":        {"text/event-stream"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
				},
			}, func(data string) {
				defer wg2.Done()
				xEnv.WaitForSubscriptionCount(2, time.Second*5)

				sentMessages.Add(1)
				xEnv.WaitForMinMessagesSent(uint64(sentMessages.Load()), time.Second*5)

				xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
					Subscriptions: 2,
					Connections:   2,
					MessagesSent:  sentMessages.Load(),
					Triggers:      1,
				})
			})

			go xEnv.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Accept":        {"text/event-stream"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
				},
			}, func(data string) {
				defer wg1.Done()

				xEnv.WaitForSubscriptionCount(2, time.Second*5)

				sentMessages.Add(1)
				xEnv.WaitForMinMessagesSent(uint64(sentMessages.Load()), time.Second*5)

				xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
					Subscriptions: 2,
					Connections:   2,
					MessagesSent:  sentMessages.Load(),
					Triggers:      1,
				})
			})

			wg1.Wait()
			wg2.Wait()

			cancel()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 0,
				Connections:   0,
				MessagesSent:  sentMessages.Load(),
				Triggers:      0,
			})
		})
	})

	t.Run("Should provide correct metrics for active connections, subscription and triggers and count the number of messages sent for websocket", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				OTLPEngineStatsOptions: testenv.EngineStatOptions{
					EnableSubscription: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})

			xEnv.WaitForSubscriptionCount(1, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 1,
				Connections:   1,
				MessagesSent:  0,
				Triggers:      1,
			})

			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)

			xEnv.WaitForMinMessagesSent(1, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 1,
				Connections:   1,
				MessagesSent:  1,
				Triggers:      1,
			})

			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)

			xEnv.WaitForMinMessagesSent(2, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 1,
				Connections:   1,
				MessagesSent:  2,
				Triggers:      1,
			})

			require.NoError(t, conn.Close())

			xEnv.WaitForConnectionCount(0, time.Second*5)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 0,
				Connections:   0,
				MessagesSent:  2,
				Triggers:      0,
			})
		})
	})

	t.Run("Should provide correct metrics for active connections, subscription and triggers and count the number of messages sent for multiple websockets", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				OTLPEngineStatsOptions: testenv.EngineStatOptions{
					EnableSubscription: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			conn2 := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

			xEnv.WaitForConnectionCount(2, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 0,
				Connections:   2,
				MessagesSent:  0,
				Triggers:      0,
			})

			wg := sync.WaitGroup{}
			wg.Add(2)

			go func() {
				defer wg.Done()
				err := conn1.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)
			}()

			go func() {
				defer wg.Done()
				err := conn2.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)
			}()

			wg.Wait()

			xEnv.WaitForSubscriptionCount(2, time.Second*5)
			xEnv.WaitForTriggerCount(1, time.Second*5)

			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 2,
				Connections:   2,
				MessagesSent:  0,
				Triggers:      1,
			})

			var res testenv.WebSocketMessage
			err := conn1.ReadJSON(&res)
			require.NoError(t, err)

			xEnv.WaitForMinMessagesSent(1, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 2,
				Connections:   2,
				MessagesSent:  1,
				Triggers:      1,
			})

			err = conn2.ReadJSON(&res)
			require.NoError(t, err)

			xEnv.WaitForMinMessagesSent(2, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 2,
				Connections:   2,
				MessagesSent:  2,
				Triggers:      1,
			})

			var complete testenv.WebSocketMessage
			err = conn1.ReadJSON(&complete)
			require.NoError(t, err)

			err = conn2.ReadJSON(&complete)
			require.NoError(t, err)

			xEnv.WaitForMinMessagesSent(4, time.Second*5)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 2,
				Connections:   2,
				MessagesSent:  4,
				Triggers:      1,
			})

			require.NoError(t, conn1.Close())

			xEnv.WaitForSubscriptionCount(1, time.Second*10)
			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 1,
				Connections:   1,
				MessagesSent:  4,
				Triggers:      1,
			})

			require.NoError(t, conn2.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*10)

			xEnv.AssertEngineStatistics(t, metricReader, testenv.EngineStatisticAssertion{
				Subscriptions: 0,
				Connections:   0,
				MessagesSent:  4,
				Triggers:      0,
			})
		})
	})

	t.Run("Should contain only base attributes in metrics", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				OTLPEngineStatsOptions: testenv.EngineStatOptions{
					EnableSubscription: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})

			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			rm := metricdata.ResourceMetrics{}
			err = metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			baseAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
			}

			engineScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.engine")
			connectionMetrics := metricdata.Metrics{
				Name:        "router.engine.connections",
				Description: "Number of connections in the engine. Contains both websocket and http connections",

				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(baseAttributes...),
							Value:      1,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, connectionMetrics, *integration.GetMetricByName(engineScope, "router.engine.connections"), metricdatatest.IgnoreTimestamp())

			subscriptionMetrics := metricdata.Metrics{
				Name:        "router.engine.subscriptions",
				Description: "Number of subscriptions in the engine.",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(baseAttributes...),
							Value:      1,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, subscriptionMetrics, *integration.GetMetricByName(engineScope, "router.engine.subscriptions"), metricdatatest.IgnoreTimestamp())

			triggerMetrics := metricdata.Metrics{
				Name:        "router.engine.triggers",
				Description: "Number of triggers in the engine.",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(baseAttributes...),
							Value:      1,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, triggerMetrics, *integration.GetMetricByName(engineScope, "router.engine.triggers"), metricdatatest.IgnoreTimestamp())

			messagesSentMetrics := metricdata.Metrics{
				Name:        "router.engine.messages.sent",
				Description: "Number of subscription updates in the engine.",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(baseAttributes...),
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, messagesSentMetrics, *integration.GetMetricByName(engineScope, "router.engine.messages.sent"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})
}

// Is set as Flaky so that when running the tests it will be run separately and retried if it fails
func TestFlakyOperationCacheTelemetry(t *testing.T) {
	t.Parallel()

	const (
		// The base cost to store any item in the cache with the current configuration
		baseCost         = 1
		employeesIDData  = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
		employeesTagData = `{"data":{"employees":[{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""}]}}`
	)

	t.Run("Validate operation cache telemetry based on default cache size configurations without feature flags", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			ModifyRouterConfig: func(config *nodev1.RouterConfig) {
				config.FeatureFlagConfigs = nil
			},
			MetricOptions: testenv.MetricOptions{
				EnableOTLPRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { tag } }`,
			})

			require.JSONEq(t, employeesTagData, res.Body)

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)

			require.NoError(t, err)
			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

			cacheScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.cache")
			require.NotNil(t, cacheScope)

			require.Len(t, cacheScope.Metrics, 4)

			baseAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
			}

			hitStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.requests.stats",
				Description: "Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, hitStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.requests.stats"), metricdatatest.IgnoreTimestamp())

			keyStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.keys.stats",
				Description: "Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, keyStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.keys.stats"), metricdatatest.IgnoreTimestamp())

			costStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.stats",
				Description: "Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, costStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.stats"), metricdatatest.IgnoreTimestamp())

			maxCostMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.max",
				Description: "Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
							)...),
							Value: 1024,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, maxCostMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.max"), metricdatatest.IgnoreTimestamp())
		})
	})

	t.Run("Validate operation cache telemetry for persisted and non persisted operations", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			ModifyRouterConfig: func(config *nodev1.RouterConfig) {
				config.FeatureFlagConfigs = nil
			},
			MetricOptions: testenv.MetricOptions{
				EnableOTLPRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// miss
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			// hit
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			// miss
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { tag } }`,
			})

			require.JSONEq(t, employeesTagData, res.Body)

			// Persisted query is already in the plan and validation cache because the same query content was used in the previous request
			// hit and normalization miss
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

			// This wasn't cache before
			// miss and normalization miss
			expected := `{"data":{"employees":[{"details":{"forename":"Jens","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"Dustin","hasChildren":false,"location":{"key":{"name":"Germany"}},"maritalStatus":"ENGAGED","middlename":"Klaus","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Deus"}},{"details":{"forename":"Stefan","hasChildren":false,"location":{"key":{"name":"America"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"AMERICAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"REPTILE","gender":"UNKNOWN","name":"Snappy","__typename":"Alligator","dangerous":"yes"}],"surname":"Avram"}},{"details":{"forename":"Björn","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"Volker","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER"},{"class":"MAMMAL","gender":"MALE","name":"Survivor","__typename":"Pony"}],"surname":"Schwenzer"}},{"details":{"forename":"Sergiy","hasChildren":false,"location":{"key":{"name":"Ukraine"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"UKRAINIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Blotch","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Grayone","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Rusty","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Manya","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Peach","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Panda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Mommy","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Terry","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Tilda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Vasya","__typename":"Cat","type":"HOME"}],"surname":"Petrunin"}},{"details":{"forename":"Suvij","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Surya"}},{"details":{"forename":"Nithin","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Kumar"}},{"details":{"forename":"Eelco","hasChildren":false,"location":{"key":{"name":"Netherlands"}},"maritalStatus":null,"middlename":"","nationality":"DUTCH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"UNKNOWN","name":"Vanson","__typename":"Mouse"}],"surname":"Wiersma"}},{"details":{"forename":"Alexandra","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"David","hasChildren":false,"location":{"key":{"name":"England"}},"maritalStatus":"MARRIED","middlename":null,"nationality":"ENGLISH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Pepper","__typename":"Cat","type":"HOME"}],"surname":"Stutt"}}]}}`
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, expected, res.Body)

			// hit and normalization hit
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, expected, res.Body)

			rm := metricdata.ResourceMetrics{}
			err = metricReader.Collect(context.Background(), &rm)

			require.NoError(t, err)
			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

			cacheScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.cache")
			require.NotNil(t, cacheScope)

			require.Len(t, cacheScope.Metrics, 4)

			baseAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
			}

			hitStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.requests.stats",
				Description: "Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "hits"),
							)...),
							Value: 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "misses"),
							)...),
							Value: 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "hits"),
							)...),
							Value: 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "misses"),
							)...),
							Value: 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 4,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, hitStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.requests.stats"), metricdatatest.IgnoreTimestamp())

			keyStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.keys.stats",
				Description: "Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, keyStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.keys.stats"), metricdatatest.IgnoreTimestamp())

			costStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.stats",
				Description: "Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 3,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, costStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.stats"), metricdatatest.IgnoreTimestamp())

			maxCostMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.max",
				Description: "Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
							)...),
							Value: 1024,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, maxCostMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.max"), metricdatatest.IgnoreTimestamp())
		})
	})

	t.Run("Validate operation cache telemetry when prometheus is also enabled", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			ModifyRouterConfig: func(config *nodev1.RouterConfig) {
				config.FeatureFlagConfigs = nil
			},
			MetricOptions: testenv.MetricOptions{
				EnableOTLPRouterCache:       true,
				EnablePrometheusRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { tag } }`,
			})

			require.JSONEq(t, employeesTagData, res.Body)

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)

			require.NoError(t, err)
			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

			cacheScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.cache")
			require.NotNil(t, cacheScope)

			require.Len(t, cacheScope.Metrics, 4)

			baseAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
			}

			hitStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.requests.stats",
				Description: "Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, hitStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.requests.stats"), metricdatatest.IgnoreTimestamp())

			keyStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.keys.stats",
				Description: "Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, keyStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.keys.stats"), metricdatatest.IgnoreTimestamp())

			costStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.stats",
				Description: "Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, costStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.stats"), metricdatatest.IgnoreTimestamp())

			maxCostMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.max",
				Description: "Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
							)...),
							Value: 1024,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, maxCostMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.max"), metricdatatest.IgnoreTimestamp())
		})
	})

	t.Run("Validate key and cost eviction metrics with small validation cache size without feature flags", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(config *nodev1.RouterConfig) {
				config.FeatureFlagConfigs = nil
			},
			ModifyEngineExecutionConfiguration: func(eec *config.EngineExecutionConfiguration) {
				eec.ValidationCacheSize = baseCost // allow only one item in the cache
			},
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableOTLPRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { tag } }`,
			})

			require.JSONEq(t, employeesTagData, res.Body)

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)

			require.NoError(t, err)
			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

			cacheScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.cache")
			require.NotNil(t, cacheScope)

			require.Len(t, cacheScope.Metrics, 4)

			baseAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
			}

			requestStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.requests.stats",
				Description: "Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, requestStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.requests.stats"), metricdatatest.IgnoreTimestamp())

			keyStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.keys.stats",
				Description: "Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, keyStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.keys.stats"), metricdatatest.IgnoreTimestamp())

			costStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.stats",
				Description: "Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: baseCost,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, costStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.stats"), metricdatatest.IgnoreTimestamp())

			maxCostMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.max",
				Description: "Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "plan"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								baseAttributes,
								attribute.String("cache_type", "query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "validation"),
							)...),
							Value: baseCost,
						},
						{
							Attributes: attribute.NewSet(append(baseAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
							)...),
							Value: 1024,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, maxCostMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.max"), metricdatatest.IgnoreTimestamp())
		})
	})

	t.Run("Validate operation cache telemetry for default configuration including feature flags", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableOTLPRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { tag } }`,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})

			require.JSONEq(t, employeesTagData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { tag } }`,
			})

			require.JSONEq(t, employeesTagData, res.Body)

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)

			require.NoError(t, err)
			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

			cacheScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.cache")
			require.NotNil(t, cacheScope)

			require.Len(t, cacheScope.Metrics, 4)

			mainAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterVersion.String("dev"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
			}

			featureFlagAttributes := []attribute.KeyValue{
				otel.WgRouterClusterName.String(""),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterVersion.String("dev"),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
				otel.WgFeatureFlag.String("myff"),
			}

			requestStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.requests.stats",
				Description: "Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						// Feature flag cache stats
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "hits"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("type", "misses"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "hits"),
							)...),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("type", "misses"),
							)...),
							Value: 2,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, requestStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.requests.stats"), metricdatatest.IgnoreTimestamp())

			keyStatMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.keys.stats",
				Description: "Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						// Feature flag key stats

						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "updated"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, keyStatMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.keys.stats"), metricdatatest.IgnoreTimestamp())

			costStatsMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.stats",
				Description: "Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						// Feature flag cost stats
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "added"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "added"),
							)...),
							Value: baseCost * 2,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
								attribute.String("operation", "evicted"),
							)...),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, costStatsMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.stats"), metricdatatest.IgnoreTimestamp())

			maxCostMetrics := metricdata.Metrics{
				Name:        "router.graphql.cache.cost.max",
				Description: "Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "plan"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								mainAttributes,
								attribute.String("cache_type", "validation"),
							)...),
							Value: 1024,
						},
						// Feature flag max cost
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "plan"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "persisted_query_normalization"),
							)...),
							Value: 1024,
						},
						{
							Attributes: attribute.NewSet(append(
								featureFlagAttributes,
								attribute.String("cache_type", "validation"),
							)...),
							Value: 1024,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, maxCostMetrics, *integration.GetMetricByName(cacheScope, "router.graphql.cache.cost.max"), metricdatatest.IgnoreTimestamp())
		})
	})
}

// Is set as Flaky so that when running the tests it will be run separately and retried if it fails
func TestFlakyRuntimeTelemetry(t *testing.T) {
	t.Parallel()

	const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

	t.Run("Trace unnamed GraphQL operation and validate all runtime metrics / including a feature graph", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableRuntimeMetrics: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

			// Runtime metrics

			runtimeScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.runtime")
			require.NotNil(t, runtimeScope)
			require.Len(t, runtimeScope.Metrics, 15)

			metricRuntimeUptime := integration.GetMetricByName(runtimeScope, "process.uptime")
			require.NotNil(t, metricRuntimeUptime)
			metricRuntimeUptimeDataType := metricRuntimeUptime.Data.(metricdata.Gauge[int64])
			require.Len(t, metricRuntimeUptimeDataType.DataPoints, 1)
			runtimeUptimeMetric := metricdata.Metrics{
				Name:        "process.uptime",
				Description: "Seconds since application was initialized",
				Unit:        "s",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: metricRuntimeUptimeDataType.DataPoints[0].Value,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, runtimeUptimeMetric, *metricRuntimeUptime, metricdatatest.IgnoreTimestamp())

			processCpuUsageMetric := metricdata.Metrics{
				Name:        "process.cpu.usage",
				Description: "Total CPU usage of this process in percentage of host total CPU capacity",
				Unit:        "percent",
				Data: metricdata.Gauge[float64]{
					DataPoints: []metricdata.DataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processCpuUsageMetric, *integration.GetMetricByName(runtimeScope, "process.cpu.usage"), metricdatatest.IgnoreTimestamp())

			metricServerUptime := integration.GetMetricByName(runtimeScope, "server.uptime")
			require.NotNil(t, metricServerUptime)
			metricServerUptimeDataType := metricServerUptime.Data.(metricdata.Gauge[int64])
			require.Len(t, metricServerUptimeDataType.DataPoints, 1)
			serverUptimeMetric := metricdata.Metrics{
				Name:        "server.uptime",
				Description: "Seconds since the server started. Resets between router config changes.",
				Unit:        "s",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: metricServerUptimeDataType.DataPoints[0].Value,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, serverUptimeMetric, *metricServerUptime, metricdatatest.IgnoreTimestamp())

			processRuntimeGoMemHeapAllocMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.heap_alloc",
				Description: "Bytes of allocated heap objects",
				Unit:        "By",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemHeapAllocMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.heap_alloc"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoMemHeapIdleMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.heap_idle",
				Description: "Bytes in idle (unused) spans",
				Unit:        "By",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemHeapIdleMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.heap_idle"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoMemHeapInUseMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.heap_inuse",
				Description: "Bytes in in-use spans",
				Unit:        "By",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemHeapInUseMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.heap_inuse"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoMemHeapObjectsMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.heap_objects",
				Description: "Number of allocated heap objects",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemHeapObjectsMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.heap_objects"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoMemHeapReleasedMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.heap_released",
				Description: "Bytes of idle spans whose physical memory has been returned to the OS",
				Unit:        "By",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemHeapReleasedMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.heap_released"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoMemHeapSysMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.heap_sys",
				Description: "Bytes of heap memory obtained from the OS",
				Unit:        "By",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemHeapSysMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.heap_sys"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoMemLiveObjectsMetric := metricdata.Metrics{
				Name:        "process.runtime.go.mem.live_objects",
				Description: "Number of live objects is the number of cumulative Mallocs - Frees",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoMemLiveObjectsMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.mem.live_objects"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoGcCountMetric := metricdata.Metrics{
				Name:        "process.runtime.go.gc.count",
				Description: "Number of completed garbage collection cycles",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoGcCountMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.gc.count"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoGoRoutinesCountMetric := metricdata.Metrics{
				Name:        "process.runtime.go.goroutines.count",
				Description: "Number of goroutines that currently exist",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoGoRoutinesCountMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.goroutines.count"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoInfoMetric := metricdata.Metrics{
				Name:        "process.runtime.go.info",
				Description: "Information about the Go runtime environment",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: false,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								attribute.String("version", runtime.Version()),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoInfoMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.info"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoGcPauseTotalMetric := metricdata.Metrics{
				Name:        "process.runtime.go.gc.pause_total",
				Description: "Cumulative nanoseconds in GC stop-the-world pauses since the program started",
				Unit:        "ns",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoGcPauseTotalMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.gc.pause_total"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			processRuntimeGoGcPauseMetric := metricdata.Metrics{
				Name:        "process.runtime.go.gc.pause",
				Description: "Amount of nanoseconds in GC stop-the-world pauses",
				Unit:        "ns",
				Data: metricdata.Histogram[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[int64]{
						{},
					},
				},
			}

			metricdatatest.AssertEqual(t, processRuntimeGoGcPauseMetric, *integration.GetMetricByName(runtimeScope, "process.runtime.go.gc.pause"), metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})
}

// Is set as Flaky so that when running the tests it will be run separately and retried if it fails
func TestFlakyTelemetry(t *testing.T) {
	t.Parallel()

	const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

	t.Run("Trace unnamed GraphQL operation and validate all metrics and spans", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation Read

			require.Equal(t, "HTTP - Read Body", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())
			require.Len(t, sn[0].Attributes(), 7)
			require.Contains(t, sn[0].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[0].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[0].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[0].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[0].Attributes(), otel.WgOperationProtocol.String("http"))

			// Pre-Handler Operation Parse

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			// Span Resource attributes

			rs := attribute.NewSet(sn[1].Resource().Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[1].Attributes(), 7)
			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[1].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[1].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[2].Resource().Attributes()...)

			require.Len(t, sn[2].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[2].Attributes(), 10)

			require.Contains(t, sn[2].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[2].Attributes(), otel.WgNormalizationCacheHit.Bool(false))
			require.Contains(t, sn[2].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[2].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[3].Resource().Attributes()...)

			require.Len(t, sn[3].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[3].Attributes(), 11)

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Contains(t, sn[3].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgFederatedGraphID.String("graph"))

			require.Contains(t, sn[3].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			require.Contains(t, sn[3].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationType.String("query"))

			require.Contains(t, sn[3].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			// Span Resource attributes

			rs = attribute.NewSet(sn[4].Resource().Attributes()...)

			require.Len(t, sn[4].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[4].Attributes(), 12)
			require.Contains(t, sn[4].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[4].Attributes(), otel.WgEngineRequestTracingEnabled.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgEnginePlanCacheHit.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[4].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationHash.String("1163600561566987607"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[5].Resource().Attributes()...)

			require.Len(t, sn[5].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			sa := attribute.NewSet(sn[5].Attributes()...)

			require.Len(t, sn[5].Attributes(), 21)
			require.True(t, sa.HasValue(semconv.HTTPURLKey))
			require.True(t, sa.HasValue(semconv.NetPeerPortKey))

			require.Contains(t, sn[5].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[5].Attributes(), otel.WgComponentName.String("engine-transport"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[5].Attributes(), semconv.NetPeerName("127.0.0.1"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPRequestContentLength(28))
			require.Contains(t, sn[5].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[5].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPResponseContentLength(117))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[6].Resource().Attributes()...)

			require.Len(t, sn[6].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[6].Attributes(), 14)

			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[6].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[6].Attributes(), otel.WgComponentName.String("engine-loader"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[7].Resource().Attributes()...)

			require.Len(t, sn[7].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[7].Attributes(), 11)
			require.Contains(t, sn[7].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[7].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationHash.String("1163600561566987607"))

			require.Contains(t, sn[7].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[7].Attributes(), otel.WgAcquireResolverWaitTimeMs.Int64(0))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[8].Resource().Attributes()...)

			require.Len(t, sn[8].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			sa = attribute.NewSet(sn[8].Attributes()...)

			require.Len(t, sn[8].Attributes(), 26)
			require.True(t, sa.HasValue(semconv.NetHostPortKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerAddrKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerPortKey))
			require.True(t, sa.HasValue(otel.WgRouterConfigVersion))
			require.True(t, sa.HasValue(otel.WgFederatedGraphID))
			require.True(t, sa.HasValue("http.user_agent"))
			require.True(t, sa.HasValue("http.host"))
			require.True(t, sa.HasValue("http.read_bytes"))
			require.True(t, sa.HasValue("http.wrote_bytes"))

			require.Contains(t, sn[8].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPScheme("http"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[8].Attributes(), semconv.NetHostName("localhost"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgComponentName.String("router-server"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterRootSpan.Bool(true))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPTarget("/graphql"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationContent.String("{employees {id}}"))
			require.Contains(t, sn[8].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPStatusCode(200))

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			rs = attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			// make a second request and assert that we're now hitting the validation cache

			exporter.Reset()

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn = exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Len(t, sn[3].Attributes(), 11)
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(true))
		})
	})

	t.Run("Telemetry works with subgraph timeouts", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(
					core.NewSubgraphTransportOptions(config.TrafficShapingRules{
						All: config.GlobalSubgraphRequestRule{
							RequestTimeout: integration.ToPtr(10 * time.Second),
						},
						Subgraphs: map[string]config.GlobalSubgraphRequestRule{
							"hobbies": {
								RequestTimeout: integration.ToPtr(3 * time.Second),
							},
						},
					})),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id:1) { id details { forename surname } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation Read

			require.Equal(t, "HTTP - Read Body", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())
			require.Len(t, sn[0].Attributes(), 7)
			require.Contains(t, sn[0].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[0].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[0].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[0].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[0].Attributes(), otel.WgOperationProtocol.String("http"))

			// Pre-Handler Operation Parse

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			// Span Resource attributes

			rs := attribute.NewSet(sn[1].Resource().Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[1].Attributes(), 7)
			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[1].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[1].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[2].Resource().Attributes()...)

			require.Len(t, sn[2].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[2].Attributes(), 10)

			require.Contains(t, sn[2].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[2].Attributes(), otel.WgNormalizationCacheHit.Bool(false))
			require.Contains(t, sn[2].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[2].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[3].Resource().Attributes()...)

			require.Len(t, sn[3].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[3].Attributes(), 11)

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Contains(t, sn[3].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgFederatedGraphID.String("graph"))

			require.Contains(t, sn[3].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			require.Contains(t, sn[3].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationType.String("query"))

			require.Contains(t, sn[3].Attributes(), otel.WgOperationHash.String("14671468813149144966"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			// Span Resource attributes

			rs = attribute.NewSet(sn[4].Resource().Attributes()...)

			require.Len(t, sn[4].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[4].Attributes(), 12)
			require.Contains(t, sn[4].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[4].Attributes(), otel.WgEngineRequestTracingEnabled.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgEnginePlanCacheHit.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[4].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationHash.String("14671468813149144966"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[5].Resource().Attributes()...)

			require.Len(t, sn[5].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			sa := attribute.NewSet(sn[5].Attributes()...)

			require.Len(t, sn[5].Attributes(), 21)
			require.True(t, sa.HasValue(semconv.HTTPURLKey))
			require.True(t, sa.HasValue(semconv.NetPeerPortKey))

			require.Contains(t, sn[5].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[5].Attributes(), otel.WgComponentName.String("engine-transport"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[5].Attributes(), semconv.NetPeerName("127.0.0.1"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPRequestContentLength(96))
			require.Contains(t, sn[5].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[5].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationHash.String("14671468813149144966"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPResponseContentLength(78))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[6].Resource().Attributes()...)

			require.Len(t, sn[6].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[6].Attributes(), 14)

			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[6].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[6].Attributes(), otel.WgComponentName.String("engine-loader"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationHash.String("14671468813149144966"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[7].Resource().Attributes()...)

			require.Len(t, sn[7].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[7].Attributes(), 11)
			require.Contains(t, sn[7].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[7].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationHash.String("14671468813149144966"))

			require.Contains(t, sn[7].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[7].Attributes(), otel.WgAcquireResolverWaitTimeMs.Int64(0))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[8].Resource().Attributes()...)

			require.Len(t, sn[8].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			sa = attribute.NewSet(sn[8].Attributes()...)

			require.Len(t, sn[8].Attributes(), 26)
			require.True(t, sa.HasValue(semconv.NetHostPortKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerAddrKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerPortKey))
			require.True(t, sa.HasValue(otel.WgRouterConfigVersion))
			require.True(t, sa.HasValue(otel.WgFederatedGraphID))
			require.True(t, sa.HasValue("http.user_agent"))
			require.True(t, sa.HasValue("http.host"))
			require.True(t, sa.HasValue("http.read_bytes"))
			require.True(t, sa.HasValue("http.wrote_bytes"))

			require.Contains(t, sn[8].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPScheme("http"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[8].Attributes(), semconv.NetHostName("localhost"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgComponentName.String("router-server"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterRootSpan.Bool(true))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPTarget("/graphql"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationContent.String("query($a: Int!){employee(id: $a){id details {forename surname}}}"))
			require.Contains(t, sn[8].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationHash.String("14671468813149144966"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPStatusCode(200))

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			rs = attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)
		})
	})

	t.Run("Trace persisted operation", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			listArgQuery := "1000000000000000000000000000000000000000000000000000000000000000"
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"MyQuery"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQuery + `"}}`),
				Header:        header,
				Variables:     []byte(`{"arg": "a"}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
			require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))

			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 10, "expected 10 spans, got %d", len(sn))
			require.Equal(t, "Load Persisted Operation", sn[1].Name())
			require.Equal(t, trace.SpanKindClient, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())
			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), semconv.HTTPMethod(http.MethodGet))
			require.Contains(t, sn[1].Attributes(), semconv.HTTPStatusCode(200))

			// Ensure the persisted operation span is a child of the root span
			require.Equal(t, sn[1].Parent().SpanID(), sn[9].SpanContext().SpanID())

			exporter.Reset()

			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"MyQuery"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQuery + `"}}`),
				Header:        header,
				Variables:     []byte(`{"arg": "a"}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
			assert.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

			sn = exporter.GetSpans().Snapshots()

			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Equalf(t, "Load Persisted Operation", sn[1].Name(), "A cache hit")
			require.Contains(t, sn[1].Attributes(), otel.WgEnginePersistedOperationCacheHit.Bool(true))
		})
	})

	t.Run("Should exclude high cardinality attributes only from metrics if custom exporter is defined", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter:                exporter,
			MetricReader:                 metricReader,
			DisableSimulateCloudExporter: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation Read

			require.Equal(t, "HTTP - Read Body", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())
			require.Len(t, sn[0].Attributes(), 7)
			require.Contains(t, sn[0].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[0].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[0].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[0].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[0].Attributes(), otel.WgOperationProtocol.String("http"))

			// Pre-Handler Operation Parse

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			// Span Resource attributes

			rs := attribute.NewSet(sn[1].Resource().Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[1].Attributes(), 7)
			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[1].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[1].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[2].Resource().Attributes()...)

			require.Len(t, sn[2].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[2].Attributes(), 10)

			require.Contains(t, sn[2].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[2].Attributes(), otel.WgNormalizationCacheHit.Bool(false))
			require.Contains(t, sn[2].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[2].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[3].Resource().Attributes()...)

			require.Len(t, sn[3].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[3].Attributes(), 11)

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Contains(t, sn[3].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgFederatedGraphID.String("graph"))

			require.Contains(t, sn[3].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			require.Contains(t, sn[3].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationType.String("query"))

			require.Contains(t, sn[3].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			// Span Resource attributes

			rs = attribute.NewSet(sn[4].Resource().Attributes()...)

			require.Len(t, sn[4].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[4].Attributes(), 12)
			require.Contains(t, sn[4].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[4].Attributes(), otel.WgEngineRequestTracingEnabled.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgEnginePlanCacheHit.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[4].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationHash.String("1163600561566987607"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[5].Resource().Attributes()...)

			require.Len(t, sn[5].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			sa := attribute.NewSet(sn[5].Attributes()...)

			require.Len(t, sn[5].Attributes(), 21)
			require.True(t, sa.HasValue(semconv.HTTPURLKey))
			require.True(t, sa.HasValue(semconv.NetPeerPortKey))

			require.Contains(t, sn[5].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[5].Attributes(), otel.WgComponentName.String("engine-transport"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[5].Attributes(), semconv.NetPeerName("127.0.0.1"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPRequestContentLength(28))
			require.Contains(t, sn[5].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[5].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPResponseContentLength(117))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[6].Resource().Attributes()...)

			require.Len(t, sn[6].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[6].Attributes(), 14)

			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[6].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[6].Attributes(), otel.WgComponentName.String("engine-loader"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[7].Resource().Attributes()...)

			require.Len(t, sn[7].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[7].Attributes(), 11)
			require.Contains(t, sn[7].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[7].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationHash.String("1163600561566987607"))

			require.Contains(t, sn[7].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[7].Attributes(), otel.WgAcquireResolverWaitTimeMs.Int64(0))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[8].Resource().Attributes()...)

			require.Len(t, sn[8].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			sa = attribute.NewSet(sn[8].Attributes()...)

			require.Len(t, sn[8].Attributes(), 26)
			require.True(t, sa.HasValue(semconv.NetHostPortKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerAddrKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerPortKey))
			require.True(t, sa.HasValue(otel.WgRouterConfigVersion))
			require.True(t, sa.HasValue(otel.WgFederatedGraphID))
			require.True(t, sa.HasValue("http.user_agent"))
			require.True(t, sa.HasValue("http.host"))
			require.True(t, sa.HasValue("http.read_bytes"))
			require.True(t, sa.HasValue("http.wrote_bytes"))

			require.Contains(t, sn[8].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPScheme("http"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[8].Attributes(), semconv.NetHostName("localhost"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgComponentName.String("router-server"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterRootSpan.Bool(true))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPTarget("/graphql"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationContent.String("{employees {id}}"))
			require.Contains(t, sn[8].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationHash.String("1163600561566987607"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPStatusCode(200))

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			rs = attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, rm.ScopeMetrics[0].Metrics[6], metricdatatest.IgnoreTimestamp())

			// make a second request and assert that we're now hitting the validation cache

			exporter.Reset()

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn = exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Len(t, sn[3].Attributes(), 11)
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(true))
		})
	})

	t.Run("Should include operation name and hash if defined in the configuration", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Default:   "",
					ValueFrom: &config.CustomDynamicAttribute{ContextField: "operation_name"},
				},
				{
					Default:   "",
					ValueFrom: &config.CustomDynamicAttribute{ContextField: "operation_hash"},
				},
			},
			DisableSimulateCloudExporter: true,
			MetricReader:                 metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationName.String(""),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationName.String(""),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			rs := attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

		})
	})

	t.Run("Should remap metric name to configured value", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Key:       "my_operation_name",
					ValueFrom: &config.CustomDynamicAttribute{ContextField: "operation_name"},
				},
				{
					Key:       "my_operation_hash",
					ValueFrom: &config.CustomDynamicAttribute{ContextField: "operation_hash"},
				},
			},
			DisableSimulateCloudExporter: true,
			MetricReader:                 metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								attribute.String("my_operation_name", ""),
								attribute.String("my_operation_hash", "1163600561566987607"),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			rs := attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})

	t.Run("Custom span and resource attributes are attached to all metrics and spans / from header", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			CustomResourceAttributes: []config.CustomStaticAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			CustomTelemetryAttributes: []config.CustomAttribute{
				{
					Key:     "custom",
					Default: "value",
					ValueFrom: &config.CustomDynamicAttribute{
						RequestHeader: "x-custom-header",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: map[string][]string{
					"x-custom-header": {"value"},
				},
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())
			require.Contains(t, sn[1].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())
			require.Contains(t, sn[2].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())
			require.Contains(t, sn[3].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())
			require.Contains(t, sn[4].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())
			require.Contains(t, sn[5].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())
			require.Contains(t, sn[6].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())
			require.Contains(t, sn[7].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
			require.Contains(t, sn[8].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("custom.resource", "value"))

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			rs := attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.Contains(t, rm.Resource.Attributes(), attribute.String("custom.resource", "value"))
			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})

	t.Run("Custom span and resource attributes are attached to all metrics and spans / static", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			CustomResourceAttributes: []config.CustomStaticAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			CustomTelemetryAttributes: []config.CustomAttribute{
				{
					Key:     "custom",
					Default: "value",
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: map[string][]string{
					"x-custom-header": {"value_different"},
				},
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())
			require.Contains(t, sn[1].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())
			require.Contains(t, sn[2].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())
			require.Contains(t, sn[3].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())
			require.Contains(t, sn[4].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())
			require.Contains(t, sn[5].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())
			require.Contains(t, sn[6].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())
			require.Contains(t, sn[7].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
			require.Contains(t, sn[8].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("custom.resource", "value"))

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			rs := attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.Contains(t, rm.Resource.Attributes(), attribute.String("custom.resource", "value"))
			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})

	t.Run("Requesting a feature flags will emit different router config version and add the feature flag attribute", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Len(t, sn[1].Attributes(), 8)
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[1].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Len(t, sn[2].Attributes(), 11)
			require.Contains(t, sn[2].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[2].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Len(t, sn[3].Attributes(), 12)
			require.Contains(t, sn[3].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[3].Attributes(), otel.WgFeatureFlag.String("myff"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Len(t, sn[4].Attributes(), 13)
			require.Contains(t, sn[4].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[4].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "query unnamed", sn[5].Name())
			require.Len(t, sn[5].Attributes(), 22)
			require.Contains(t, sn[5].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[5].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Len(t, sn[6].Attributes(), 15)
			require.Contains(t, sn[6].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[6].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Len(t, sn[7].Attributes(), 12)
			require.Contains(t, sn[7].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[7].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "query unnamed", sn[8].Name())
			require.Len(t, sn[8].Attributes(), 27)

			require.Contains(t, sn[8].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[8].Attributes(), otel.WgFeatureFlag.String("myff"))

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Sum: 0,
						},
					},
				},
			}

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
					routerInfoMetric,
					operationPlanningTimeMetric,
				},
			}

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, scopeMetric.Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})

	t.Run("Spans are sampled because parent based sampling is disabled and ratio based sampler is set 1 (always)", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter:             exporter,
			DisableParentBasedSampler: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header without sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 00 = not sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sn[1].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sn[2].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sn[3].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sn[4].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sn[5].Parent().SpanID(), sn[6].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, sn[6].Parent().SpanID(), sn[7].SpanContext().SpanID())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sn[7].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[8].Name())
			require.Equal(t, sn[8].ChildSpanCount(), 6)
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
		})
	})

	t.Run("Spans are sampled because parent based sampler is enabled by default and parent span sample flag is set", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header with sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01"}, // 01 = sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sn[1].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sn[2].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sn[3].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sn[4].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sn[5].Parent().SpanID(), sn[6].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, sn[6].Parent().SpanID(), sn[7].SpanContext().SpanID())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sn[7].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[8].Name())
			require.Equal(t, sn[8].ChildSpanCount(), 6)
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
		})
	})

	t.Run("Spans are not sampled because parent based sampler is enabled by default and parent span sample flag is not set", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header without sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 00 = not sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 0, "expected 0 spans, got %d", len(sn))
		})
	})

	t.Run("Client TraceID is respected with parent based sampler", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header without sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01"}, // 01 = sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Equal(t, "0af7651916cd43dd8448eb211c80319c", sn[0].SpanContext().TraceID().String())
		})
	})

	t.Run("Trace named operation with parent-child relationship", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			require.Equal(t, "HTTP - Read Body", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sn[0].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sn[1].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sn[2].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sn[3].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sn[4].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sn[5].Parent().SpanID(), sn[6].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, sn[6].Parent().SpanID(), sn[7].SpanContext().SpanID())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sn[7].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[8].Name())
			require.Equal(t, sn[8].ChildSpanCount(), 6)
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
		})
	})

	t.Run("Origin connectivity issue is traced", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					CloseOnStart: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Lenf(t, sn[6].Attributes(), 14, "expected 14 attributes, got %d", len(sn[8].Attributes()))
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			require.Equal(t, "Engine - Fetch", sn[8].Name())
			require.Equal(t, trace.SpanKindInternal, sn[8].SpanKind())
			require.Equal(t, codes.Error, sn[8].Status().Code)
			require.Lenf(t, sn[8].Attributes(), 14, "expected 14 attributes, got %d", len(sn[8].Attributes()))
			require.Contains(t, sn[8].Status().Description, "connect: connection refused\nFailed to fetch from Subgraph 'products' at Path: 'employees'.")

			events := sn[8].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL request failed")
			require.Equal(t, "exception", events[0].Name)

			// Validate if the root span has the correct status and error
			require.Equal(t, "query unnamed", sn[10].Name())
			require.Equal(t, trace.SpanKindServer, sn[10].SpanKind())
			require.Equal(t, codes.Error, sn[10].Status().Code)
			require.Contains(t, sn[10].Status().Description, "connect: connection refused\nFailed to fetch from Subgraph 'products' at Path: 'employees'.")
		})
	})

	t.Run("Subgraph error produces a span event per GraphQL error", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","path": ["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path": ["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","path":["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path":["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

			// The request to the employees subgraph succeeded
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			require.Lenf(t, sn[6].Attributes(), 14, "expected 14 attributes, got %d", len(sn[6].Attributes()))

			given := attribute.NewSet(sn[6].Attributes()...)
			want := attribute.NewSet([]attribute.KeyValue{
				semconv.HTTPStatusCode(200),
				otel.WgClientName.String("unknown"),
				otel.WgClientVersion.String("missing"),
				otel.WgComponentName.String("engine-loader"),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgOperationHash.String("13939103824696605913"),
				otel.WgOperationProtocol.String("http"),
				otel.WgOperationType.String("query"),
				otel.WgRouterClusterName.String(""),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
				otel.WgOperationName.String("myQuery"),
				otel.WgSubgraphName.String("employees"),
				otel.WgSubgraphID.String("0"),
			}...)

			require.True(t, given.Equals(&want))

			// The request to the products subgraph failed with a 403 status code
			require.Equal(t, "Engine - Fetch", sn[8].Name())
			require.Equal(t, trace.SpanKindInternal, sn[8].SpanKind())

			require.Lenf(t, sn[8].Attributes(), 14, "expected 14 attributes, got %d", len(sn[6].Attributes()))

			given = attribute.NewSet(sn[8].Attributes()...)
			want = attribute.NewSet([]attribute.KeyValue{
				otel.WgSubgraphName.String("products"),
				otel.WgSubgraphID.String("3"),
				semconv.HTTPStatusCode(403),
				otel.WgComponentName.String("engine-loader"),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterClusterName.String(""),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
				otel.WgClientName.String("unknown"),
				otel.WgClientVersion.String("missing"),
				otel.WgOperationName.String("myQuery"),
				otel.WgOperationType.String("query"),
				otel.WgOperationProtocol.String("http"),
				otel.WgOperationHash.String("13939103824696605913"),
			}...)

			require.True(t, given.Equals(&want))

			require.Equal(t, sdktrace.Status{Code: codes.Error, Description: `Failed to fetch from Subgraph 'products' at Path: 'employees'.`}, sn[8].Status())

			events := sn[8].Events()
			require.Len(t, events, 3, "expected 2 events, one for the fetch and one two downstream GraphQL errors")
			require.Equal(t, "exception", events[0].Name)

			require.Equal(t, "Downstream error 1", events[1].Name)
			require.Equal(t, []attribute.KeyValue{
				otel.WgSubgraphErrorExtendedCode.String("UNAUTHORIZED"),
				otel.WgSubgraphErrorMessage.String("Unauthorized"),
			}, events[1].Attributes)

			require.Equal(t, "Downstream error 2", events[2].Name)
			require.Equal(t, []attribute.KeyValue{
				otel.WgSubgraphErrorExtendedCode.String("YOUR_ERROR_CODE"),
				otel.WgSubgraphErrorMessage.String("MyErrorMessage"),
			}, events[2].Attributes)

			// Validate if the root span has the correct status and error
			require.Equal(t, "query myQuery", sn[10].Name())
			require.Equal(t, trace.SpanKindServer, sn[10].SpanKind())
			require.Equal(t, codes.Error, sn[10].Status().Code)
			require.Contains(t, sn[10].Status().Description, `Failed to fetch from Subgraph 'products' at Path: 'employees'.`)
		})
	})

	t.Run("Operation parsing errors are tracked", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `invalid query`,
			})
			require.Equal(t, `{"errors":[{"message":"unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]","locations":[{"line":1,"column":1}]}]}`, res.Body)
			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 3, "expected 3 spans, got %d", len(sn))

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, codes.Error, sn[1].Status().Code)
			require.Contains(t, sn[1].Status().Description, "unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]")

			require.Lenf(t, sn[1].Attributes(), 8, "expected 8 attributes, got %d", len(sn[1].Attributes()))

			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[1].Attributes(), otel.WgRequestError.Bool(true))
			require.Contains(t, sn[1].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[1].Attributes(), otel.WgOperationProtocol.String("http"))

			events := sn[1].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL parsing failed")
			require.Equal(t, "exception", events[0].Name)

			require.Equal(t, "POST /graphql", sn[2].Name())
			require.Equal(t, trace.SpanKindServer, sn[2].SpanKind())
			require.Equal(t, codes.Error, sn[2].Status().Code)
			require.Contains(t, sn[2].Status().Description, "unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]")

			require.Lenf(t, sn[2].Attributes(), 23, "expected 23 attributes, got %d", len(sn[2].Attributes()))

			events = sn[2].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL request failed")
			require.Equal(t, "exception", events[0].Name)
		})
	})

	t.Run("Operation normalization errors are tracked", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query foo { employeesTypeNotExist { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Cannot query field \"employeesTypeNotExist\" on type \"Query\".","path":["query"]}]}`, res.Body)
			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 5, "expected 4 spans, got %d", len(sn))

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, codes.Unset, sn[1].Status().Code)
			require.Empty(t, sn[1].Status().Description)

			require.Empty(t, sn[1].Events())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, codes.Unset, sn[2].Status().Code)
			require.Empty(t, sn[2].Status().Description)

			require.Empty(t, sn[2].Events())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, codes.Error, sn[3].Status().Code)
			require.Equal(t, `Cannot query field "employeesTypeNotExist" on type "Query".`, sn[3].Status().Description)

			events := sn[3].Events()
			require.Len(t, events, 1, "expected 1 event because GraphQL validation failed")
			require.Equal(t, "exception", events[0].Name)

			require.Equal(t, "query foo", sn[4].Name())
			require.Equal(t, trace.SpanKindServer, sn[4].SpanKind())
			require.Equal(t, codes.Error, sn[4].Status().Code)
			require.Equal(t, `Cannot query field "employeesTypeNotExist" on type "Query".`, sn[4].Status().Description)

			events = sn[4].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL request failed")
			require.Equal(t, "exception", events[0].Name)
		})
	})

	t.Run("Datadog Propagation", func(t *testing.T) {
		t.Parallel()

		var (
			datadogTraceId = "9532127138774266268"
			testPropConfig = config.PropagationConfig{
				TraceContext: true,
				Datadog:      true,
			}
		)

		t.Run("Datadog headers are propagated if enabled", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: testPropConfig,
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, datadogTraceId, r.Header.Get("x-datadog-trace-id"))
								require.NotEqual(t, "", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "1", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01"}, // 01 = sampled
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})

		t.Run("Datadog headers correctly recognize sampling bit", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: testPropConfig,
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, datadogTraceId, r.Header.Get("x-datadog-trace-id"))
								require.NotEqual(t, "", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "0", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 01 = sampled
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})

		t.Run("Correctly pass along Datadog headers", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: testPropConfig,
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, datadogTraceId, r.Header.Get("x-datadog-trace-id"))
								require.NotEqual(t, "6023947403358210776", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "1", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"x-datadog-trace-id":          {datadogTraceId},
						"x-datadog-parent-id":         {"6023947403358210776"},
						"x-datadog-sampling-priority": {"1"},
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)

				sn := exporter.GetSpans().Snapshots()
				require.GreaterOrEqual(t, len(sn), 1)
				require.Equal(t, "00000000000000008448eb211c80319c", sn[0].SpanContext().TraceID().String())
			})
		})

		t.Run("Doesn't propagate headers in datadog format if datadog config is not set", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: config.PropagationConfig{Datadog: false},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, "", r.Header.Get("x-datadog-trace-id"))
								require.Equal(t, "", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 01 = sampled
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})
	})

	t.Run("Trace ID Response header", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		customTraceHeader := "trace-id"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			ResponseTraceHeader: config.ResponseTraceHeader{
				Enabled:    true,
				HeaderName: customTraceHeader,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Equal(t, sn[0].SpanContext().TraceID().String(), res.Response.Header.Get("trace-id"))
		})
	})

	t.Run("Trace ID Response header with default header name", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			ResponseTraceHeader: config.ResponseTraceHeader{
				Enabled:    true,
				HeaderName: "x-wg-trace-id",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Equal(t, sn[0].SpanContext().TraceID().String(), res.Response.Header.Get("x-wg-trace-id"))
		})
	})

	t.Run("Custom client name and client version headers", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		customClientHeaderName := "client-name"
		customClientHeaderVersion := "client-version"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			ClientHeader: config.ClientHeader{
				Name:    customClientHeaderName,
				Version: customClientHeaderVersion,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("client-name", "name")
			header.Add("client-version", "version")
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `query { employees { id } }`,
				Header: header,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()

			var clientName, clientVersion string
			for _, v := range sn[0].Attributes() {
				if v.Key == "wg.client.name" {
					clientName = v.Value.AsString()
				}
				if v.Key == "wg.client.version" {
					clientVersion = v.Value.AsString()
				}
			}
			require.Equal(t, "name", clientName)
			require.Equal(t, "version", clientVersion)
		})
	})

	t.Run("Excluded metrics and attributes should not be exported", func(t *testing.T) {
		t.Parallel()

		var (
			rmFull     metricdata.ResourceMetrics
			rmFiltered metricdata.ResourceMetrics
		)

		metricReaderFull := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReaderFull,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			err := metricReaderFull.Collect(context.Background(), &rmFull)
			require.NoError(t, err)

			scopeMetrics := *integration.GetMetricScopeByName(rmFull.ScopeMetrics, "cosmo.router")
			require.Len(t, rmFull.ScopeMetrics, defaultExposedScopedMetricsCount)
			require.Len(t, scopeMetrics.Metrics, defaultCosmoRouterMetricsCount)

			require.Equal(t, "router.http.requests", scopeMetrics.Metrics[0].Name)
			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[0], otel.WgClientName.String("unknown")))
			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[0], otel.WgOperationName.String("")))

			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[1], otel.WgClientName.String("unknown")))
			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[1], otel.WgOperationName.String("")))

			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[2], otel.WgClientName.String("unknown")))
			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[2], otel.WgOperationName.String("")))

			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[3], otel.WgClientName.String("unknown")))
			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[3], otel.WgOperationName.String("")))

			require.True(t, metricdatatest.AssertHasAttributes(t, scopeMetrics.Metrics[4], otel.WgClientName.String("unknown")))
		})

		metricReaderFiltered := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReaderFiltered,
			MetricOptions: testenv.MetricOptions{
				MetricExclusions: testenv.MetricExclusions{
					ExcludedOTLPMetrics: []*regexp.Regexp{
						regexp.MustCompile(`^router\.http\.requests$`),
					},
					ExcludedOTLPMetricLabels: []*regexp.Regexp{
						regexp.MustCompile(`^wg\.client\.name$`),
						regexp.MustCompile(`^wg\.operation.*`),
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			err := metricReaderFiltered.Collect(context.Background(), &rmFiltered)
			require.NoError(t, err)

			rmFilteredScopeMetrics := *integration.GetMetricScopeByName(rmFiltered.ScopeMetrics, "cosmo.router")

			rmFullScopeMetrics := *integration.GetMetricScopeByName(rmFull.ScopeMetrics, "cosmo.router")

			require.Len(t, rmFiltered.ScopeMetrics, defaultExposedScopedMetricsCount)
			require.Len(t, rmFilteredScopeMetrics.Metrics, 6)

			// Check if the excluded attributes are not present in the Resource
			// The first metric completely excluded, the second one should be the first in filtered
			require.NotEqual(t, rmFullScopeMetrics.Metrics[0].Name, rmFilteredScopeMetrics.Metrics[0].Name)
			require.Equal(t, rmFullScopeMetrics.Metrics[1].Name, rmFilteredScopeMetrics.Metrics[0].Name)

			// All other metrics should have fewer attributes in the filtered set compared to the full one

			rdFiltered, ok := rmFilteredScopeMetrics.Metrics[0].Data.(metricdata.Histogram[float64])
			require.True(t, ok)

			integration.AssertAttributeNotInSet(t, rdFiltered.DataPoints[0].Attributes, otel.WgClientName.String("unknown"))
			integration.AssertAttributeNotInSet(t, rdFiltered.DataPoints[1].Attributes, otel.WgClientName.String("unknown"))
			integration.AssertAttributeNotInSet(t, rdFiltered.DataPoints[0].Attributes, otel.WgOperationName.String(""))
			integration.AssertAttributeNotInSet(t, rdFiltered.DataPoints[1].Attributes, otel.WgOperationName.String(""))

			rclFiltered, ok := rmFilteredScopeMetrics.Metrics[1].Data.(metricdata.Sum[int64])
			require.True(t, ok)

			integration.AssertAttributeNotInSet(t, rclFiltered.DataPoints[0].Attributes, otel.WgClientName.String("unknown"))
			integration.AssertAttributeNotInSet(t, rclFiltered.DataPoints[1].Attributes, otel.WgClientName.String("unknown"))
			integration.AssertAttributeNotInSet(t, rclFiltered.DataPoints[0].Attributes, otel.WgOperationName.String(""))
			integration.AssertAttributeNotInSet(t, rclFiltered.DataPoints[1].Attributes, otel.WgOperationName.String(""))

			resClFiltered, ok := rmFilteredScopeMetrics.Metrics[2].Data.(metricdata.Sum[int64])
			require.True(t, ok)

			integration.AssertAttributeNotInSet(t, resClFiltered.DataPoints[0].Attributes, otel.WgClientName.String("unknown"))
			integration.AssertAttributeNotInSet(t, resClFiltered.DataPoints[1].Attributes, otel.WgClientName.String("unknown"))
			integration.AssertAttributeNotInSet(t, resClFiltered.DataPoints[0].Attributes, otel.WgOperationName.String(""))
			integration.AssertAttributeNotInSet(t, resClFiltered.DataPoints[1].Attributes, otel.WgOperationName.String(""))
		})
	})

	t.Run("Custom Metric Attributes", func(t *testing.T) {
		t.Parallel()

		t.Run("Custom attributes are added to all metrics / subgraph error", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: "from_header",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "x-custom-header",
						},
					},
					{
						Key: "sha256",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationSha256,
						},
					},
					{
						Key: "error_codes",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorCodes,
						},
					},
					{
						Key: "error_services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorServices,
						},
					},
					{
						Key: "services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationServices,
						},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Products: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusForbidden)
								_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","path": ["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path": ["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"custom-value"},
					},
					Query: `query myQuery { employees { id details { forename surname } notes } }`,
				})
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","path":["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path":["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

				/**
				* Traces
				 */

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

				// No additional attributes are added to the spans

				/**
				* Metrics
				 */
				rm := metricdata.ResourceMetrics{}
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
				require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount+1)

				httpRequestsMetric := metricdata.Metrics{
					Name:        "router.http.requests",
					Description: "Total number of requests",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 1,
							},
						},
					},
				}

				requestDurationMetric := metricdata.Metrics{
					Name:        "router.http.request.duration_milliseconds",
					Description: "Server latency in milliseconds",
					Unit:        "ms",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgRequestError.Bool(true),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Sum: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("error_services", []string{"products"}),
									attribute.String("from_header", "custom-value"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("services", []string{"employees", "products"}),
									otel.WgRequestError.Bool(true),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Sum: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Sum: 0,
							},
						},
					},
				}

				requestContentLengthMetric := metricdata.Metrics{
					Name:        "router.http.request.content_length",
					Description: "Total number of request bytes",
					Unit:        "bytes",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 494,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 81,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 66,
							},
						},
					},
				}

				responseContentLengthMetric := metricdata.Metrics{
					Name:        "router.http.response.content_length",
					Description: "Total number of response bytes",
					Unit:        "bytes",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 863,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 177,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1046,
							},
						},
					},
				}

				requestInFlightMetric := metricdata.Metrics{
					Name:        "router.http.requests.in_flight",
					Description: "Number of requests in flight",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationProtocol.String("http"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 0,
							},
						},
					},
				}

				operationPlanningTimeMetric := metricdata.Metrics{
					Name:        "router.graphql.operation.planning_time",
					Description: "Operation planning time in milliseconds",
					Unit:        "ms",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgEnginePlanCacheHit.Bool(false),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Sum: 0,
							},
						},
					},
				}

				failedRequestsMetric := metricdata.Metrics{
					Name:        "router.http.requests.error",
					Description: "Total number of failed requests",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1,
							},
						},
					},
				}

				routerInfoMetric := metricdata.Metrics{
					Name:        "router.info",
					Description: "Router configuration info.",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
							},
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgFeatureFlag.String("myff"),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
									otel.WgRouterVersion.String("dev"),
								),
							},
						},
					},
				}

				want := metricdata.ScopeMetrics{
					Scope: instrumentation.Scope{
						Name:      "cosmo.router",
						SchemaURL: "",
						Version:   "0.0.1",
					},
					Metrics: []metricdata.Metrics{
						httpRequestsMetric,
						requestDurationMetric,
						requestContentLengthMetric,
						responseContentLengthMetric,
						requestInFlightMetric,
						routerInfoMetric,
						operationPlanningTimeMetric,
						failedRequestsMetric,
					},
				}

				metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})
		})

		t.Run("should not remap high cardinality fields when using cloud exporter but include custom metric attributes", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key:       "my_operation_name", // must not be remapped
						ValueFrom: &config.CustomDynamicAttribute{ContextField: "operation_name"},
					},
					{
						Key:       "my_operation_hash", // must not be remapped
						ValueFrom: &config.CustomDynamicAttribute{ContextField: "operation_hash"},
					},
					{
						Key: "from_header",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "x-custom-header",
						},
					},
					{
						Key: "sha256",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationSha256,
						},
					},
					{
						Key: "error_codes",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorCodes,
						},
					},
					{
						Key: "error_services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorServices,
						},
					},
					{
						Key: "services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationServices,
						},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Products: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusForbidden)
								_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","path": ["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path": ["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"custom-value"},
					},
					Query: `query myQuery { employees { id details { forename surname } notes } }`,
				})
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","path":["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path":["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

				/**
				* Traces
				 */

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

				// No additional attributes are added to the spans

				/**
				* Metrics
				 */
				rm := metricdata.ResourceMetrics{}
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
				require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount+1)

				httpRequestsMetric := metricdata.Metrics{
					Name:        "router.http.requests",
					Description: "Total number of requests",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 1,
							},
						},
					},
				}

				requestDurationMetric := metricdata.Metrics{
					Name:        "router.http.request.duration_milliseconds",
					Description: "Server latency in milliseconds",
					Unit:        "ms",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgRequestError.Bool(true),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Sum: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("error_services", []string{"products"}),
									attribute.String("from_header", "custom-value"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("services", []string{"employees", "products"}),
									otel.WgRequestError.Bool(true),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Sum: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Sum: 0,
							},
						},
					},
				}

				requestContentLengthMetric := metricdata.Metrics{
					Name:        "router.http.request.content_length",
					Description: "Total number of request bytes",
					Unit:        "bytes",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 494,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 81,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 66,
							},
						},
					},
				}

				responseContentLengthMetric := metricdata.Metrics{
					Name:        "router.http.response.content_length",
					Description: "Total number of response bytes",
					Unit:        "bytes",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 863,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 177,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1046,
							},
						},
					},
				}

				requestInFlightMetric := metricdata.Metrics{
					Name:        "router.http.requests.in_flight",
					Description: "Number of requests in flight",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationProtocol.String("http"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 0,
							},
						},
					},
				}

				operationPlanningTimeMetric := metricdata.Metrics{
					Name:        "router.graphql.operation.planning_time",
					Description: "Operation planning time in milliseconds",
					Unit:        "ms",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgEnginePlanCacheHit.Bool(false),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Sum: 0,
							},
						},
					},
				}

				failedRequestsMetric := metricdata.Metrics{
					Name:        "router.http.requests.error",
					Description: "Total number of failed requests",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("13939103824696605913"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1,
							},
						},
					},
				}

				routerInfoMetric := metricdata.Metrics{
					Name:        "router.info",
					Description: "Router configuration info.",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
							},
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgFeatureFlag.String("myff"),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
									otel.WgRouterVersion.String("dev"),
								),
							},
						},
					},
				}

				want := metricdata.ScopeMetrics{
					Scope: instrumentation.Scope{
						Name:      "cosmo.router",
						SchemaURL: "",
						Version:   "0.0.1",
					},
					Metrics: []metricdata.Metrics{
						httpRequestsMetric,
						requestDurationMetric,
						requestContentLengthMetric,
						responseContentLengthMetric,
						requestInFlightMetric,
						routerInfoMetric,
						operationPlanningTimeMetric,
						failedRequestsMetric,
					},
				}

				metricdatatest.AssertEqual(t, want, scopeMetric, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})
		})

		t.Run("Should emit subgraph error metric when subgraph request failed / connection issue", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: "error_codes",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorCodes,
						},
					},
					{
						Key: "error_services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorServices,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Products: testenv.SubgraphConfig{
						CloseOnStart: true,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"custom-value"},
					},
					Query: `query myQuery { employees { id details { forename surname } notes } }`,
				})
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

				rm := metricdata.ResourceMetrics{}
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				found := false

				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
				for _, point := range scopeMetric.Metrics[1].Data.(metricdata.Sum[int64]).DataPoints {

					require.Equal(t, int64(1), point.Value)

					if point.Attributes.HasValue(otel.WgSubgraphName) && point.Attributes.HasValue(otel.WgSubgraphID) {
						found = true
						break
					}
				}

				require.True(t, found, "expected to find a datapoint with subgraph name and id in the metrics")
			})
		})

		t.Run("Tracing is not affected by custom metric attributes", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: "from_header",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "x-custom-header",
						},
					},
					{
						Key: "services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationServices,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"custom-value"},
					},
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

				/**
				* Spans
				 */

				// Pre-Handler Operation Read

				require.Equal(t, "HTTP - Read Body", sn[0].Name())
				require.Len(t, sn[0].Resource().Attributes(), 9)
				require.Len(t, sn[0].Attributes(), 7)

				require.Equal(t, "Operation - Parse", sn[1].Name())
				require.Len(t, sn[1].Resource().Attributes(), 9)
				require.Len(t, sn[1].Attributes(), 7)

				require.Equal(t, "Operation - Normalize", sn[2].Name())
				require.Len(t, sn[2].Resource().Attributes(), 9)
				require.Len(t, sn[2].Attributes(), 10)

				require.Equal(t, "Operation - Validate", sn[3].Name())
				require.Len(t, sn[3].Resource().Attributes(), 9)
				require.Len(t, sn[3].Attributes(), 11)

				require.Equal(t, "Operation - Plan", sn[4].Name())
				require.Len(t, sn[4].Resource().Attributes(), 9)
				require.Len(t, sn[4].Attributes(), 12)

				// Engine Transport
				require.Equal(t, "query unnamed", sn[5].Name())
				require.Len(t, sn[5].Resource().Attributes(), 9)
				require.Len(t, sn[5].Attributes(), 21)

				require.Equal(t, "Engine - Fetch", sn[6].Name())
				require.Len(t, sn[6].Resource().Attributes(), 9)
				require.Len(t, sn[6].Attributes(), 14)

				// GraphQL handler
				require.Equal(t, "Operation - Execute", sn[7].Name())
				require.Len(t, sn[7].Resource().Attributes(), 9)
				require.Len(t, sn[7].Attributes(), 11)

				// Root Server middleware
				require.Equal(t, "query unnamed", sn[8].Name())
				require.Len(t, sn[8].Resource().Attributes(), 9)
				require.Len(t, sn[8].Attributes(), 26)
			})
		})
	})

	t.Run("Complexity Cache Metrics", func(t *testing.T) {
		t.Parallel()
		t.Run("total fields caches success and failure runs", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityCalculationCache = &config.ComplexityCalculationCache{
						Enabled:   true,
						CacheSize: 1024,
					}
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						TotalFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   1,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				failedRes, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, failedRes.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The total number of fields 2 exceeds the limit allowed (1)"}]}`, failedRes.Body)

				testSpan := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryTotalFields.Int(2))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				failedRes2, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, failedRes2.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The total number of fields 2 exceeds the limit allowed (1)"}]}`, failedRes2.Body)

				testSpan2 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				assert.Contains(t, testSpan2.Attributes(), otel.WgQueryTotalFields.Int(2))
				assert.Contains(t, testSpan2.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
				assert.Equal(t, codes.Unset, testSpan2.Status().Code)
				assert.Equal(t, []sdktrace.Event(nil), testSpan2.Events())
				exporter.Reset()

				successRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes.Body)
				testSpan3 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryTotalFields.Int(1))
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				successRes2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes2.Body)
				testSpan4 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryTotalFields.Int(1))
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
			})
		})

		t.Run("root fields caches success and failure runs 1", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityCalculationCache = &config.ComplexityCalculationCache{
						Enabled:   true,
						CacheSize: 1024,
					}
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						RootFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				failedRes, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { initialPayload employee(id:1) { id } employees { id } }`,
				})
				require.Equal(t, 400, failedRes.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The number of root fields 3 exceeds the root field limit allowed (2)"}]}`, failedRes.Body)

				testSpan := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryRootFields.Int(3))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				failedRes2, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { initialPayload employee(id:1) { id } employees { id } }`,
				})
				require.Equal(t, 400, failedRes2.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The number of root fields 3 exceeds the root field limit allowed (2)"}]}`, failedRes2.Body)

				testSpan2 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryRootFields.Int(3))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
				exporter.Reset()

				successRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes.Body)
				testSpan3 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryRootFields.Int(1))
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				successRes2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes2.Body)
				testSpan4 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryRootFields.Int(1))
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
			})
		})

		t.Run("root fields caches success and failure runs 2", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityCalculationCache = &config.ComplexityCalculationCache{
						Enabled:   true,
						CacheSize: 1024,
					}
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						RootFieldAliases: &config.ComplexityLimit{
							Enabled: true,
							Limit:   1,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				failedRes, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { firstemployee: employee(id:1) { id } employee2: employee(id:2) { id } }`,
				})
				require.Equal(t, 400, failedRes.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The number of root field aliases 2 exceeds the root field aliases limit allowed (1)"}]}`, failedRes.Body)

				testSpan := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryRootFieldAliases.Int(2))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				failedRes2, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { firstemployee: employee(id:1) { id } employee2: employee(id:2) { id } }`,
				})
				require.Equal(t, 400, failedRes2.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The number of root field aliases 2 exceeds the root field aliases limit allowed (1)"}]}`, failedRes2.Body)

				testSpan2 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryRootFieldAliases.Int(2))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
				exporter.Reset()

				successRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes.Body)
				testSpan3 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryRootFieldAliases.Int(0))
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				successRes2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes2.Body)
				testSpan4 := integration.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryRootFieldAliases.Int(0))
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
			})
		})
	})

	t.Run("custom metric with expression", func(t *testing.T) {
		t.Parallel()

		const employeesQueryRequiringClaims = `{"query":"{ employees { id startDate } }"}`

		t.Run("existing JWT claim is added", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			authenticators, authServer := integration.ConfigureAuth(t)
			claimKey := "extraclaim"
			claimVal := "extravalue"
			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims.custom_value." + claimKey,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope": "read:employee read:private",
					"custom_value": map[string]string{
						claimKey: claimVal,
					},
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
				require.NoError(t, err)
				rm := metricdata.ResourceMetrics{}
				err = metricReader.Collect(context.Background(), &rm)
				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

				require.NoError(t, err)
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)
				require.IsType(t, metricdata.Sum[int64]{}, scopeMetric.Metrics[0].Data)
				data2 := scopeMetric.Metrics[0].Data.(metricdata.Sum[int64])
				atts := data2.DataPoints[0].Attributes
				val, ok := atts.Value(attribute.Key(claimKey))
				require.True(t, ok)
				require.Equal(t, claimVal, val.AsString())
			})
		})

		t.Run("JWT claim ignored if is string but expression is expecting a map", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			authenticators, authServer := integration.ConfigureAuth(t)
			claimKey := "extraclaim"
			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims.custom_value." + claimKey,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope":        "read:employee read:private",
					"custom_value": "asasas",
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
				require.NoError(t, err)
				rm := metricdata.ResourceMetrics{}
				err = metricReader.Collect(context.Background(), &rm)
				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

				require.NoError(t, err)
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)
				require.IsType(t, metricdata.Sum[int64]{}, scopeMetric.Metrics[0].Data)
				data2 := scopeMetric.Metrics[0].Data.(metricdata.Sum[int64])
				atts := data2.DataPoints[0].Attributes
				_, ok := atts.Value(attribute.Key(claimKey))
				require.False(t, ok)
			})
		})

		t.Run("not existing JWT claim is not added", func(t *testing.T) {
			t.Parallel()

			claimKey := "extraclaim"

			metricReader := metric.NewManualReader()
			authenticators, authServer := integration.ConfigureAuth(t)
			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims." + claimKey,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope": "read:employee read:private",
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
				require.NoError(t, err)
				rm := metricdata.ResourceMetrics{}
				err = metricReader.Collect(context.Background(), &rm)
				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

				require.NoError(t, err)
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)
				require.IsType(t, metricdata.Sum[int64]{}, scopeMetric.Metrics[0].Data)
				data2 := scopeMetric.Metrics[0].Data.(metricdata.Sum[int64])
				atts := data2.DataPoints[0].Attributes
				ok := atts.HasValue(attribute.Key(claimKey))
				require.False(t, ok)
			})
		})

		t.Run("invalid expression", func(t *testing.T) {
			t.Parallel()

			claimKey := "extraclaim"
			metricReader := metric.NewManualReader()
			err := testenv.RunWithError(t, &testenv.Config{
				MetricReader: metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "TEST request.auth.claims." + claimKey,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				assert.FailNow(t, "should not be called")
			})
			expectedErr := errors.New("failed to build base mux: custom attribute error, unable to compile 'extraclaim' with expression 'TEST request.auth.claims.extraclaim': line 1, column 5: unexpected token Identifier(\"request\")")
			assert.ErrorAs(t, err, &expectedErr)
		})
	})

	t.Run("custom trace metrics with expression", func(t *testing.T) {
		t.Parallel()

		const employeesQueryRequiringClaims = `{"query":"{ employees { id startDate } }"}`

		t.Run("existing JWT claim is added", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			authenticators, authServer := integration.ConfigureAuth(t)
			claimKeyWithAuth := "extraclaim"
			claimValWithAuth := "extravalue"
			headerKey := "X-Custom-Header"
			headerVal := "extravalue2"
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key: claimKeyWithAuth,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims.custom_value." + claimKeyWithAuth,
						},
					},
					{
						Key: headerKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.header.Get('" + headerKey + "')",
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope": "read:employee read:private",
					"custom_value": map[string]string{
						claimKeyWithAuth: claimValWithAuth,
					},
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
					headerKey:       []string{headerVal},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 10, "expected 10 spans, got %d", len(sn))
				for i := 0; i < len(sn); i++ {
					if slices.Contains([]string{"HTTP - Read Body", "Authenticate"}, sn[i].Name()) {
						assert.NotContains(t, sn[i].Attributes(), attribute.String(claimKeyWithAuth, claimValWithAuth))
					} else {
						assert.Contains(t, sn[i].Attributes(), attribute.String(claimKeyWithAuth, claimValWithAuth))
					}
				}
				for i := 0; i < len(sn); i++ {
					assert.Contains(t, sn[i].Attributes(), attribute.String(headerKey, headerVal))
				}

				rm := metricdata.ResourceMetrics{}
				err = metricReader.Collect(context.Background(), &rm)
				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

				require.NoError(t, err)
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)
				require.IsType(t, metricdata.Sum[int64]{}, scopeMetric.Metrics[0].Data)
				data2 := scopeMetric.Metrics[0].Data.(metricdata.Sum[int64])
				atts := data2.DataPoints[0].Attributes
				val, ok := atts.Value(attribute.Key(claimKeyWithAuth))
				require.True(t, ok)
				require.Equal(t, claimValWithAuth, val.AsString())
			})
		})

		t.Run("JWT claim ignored if is string but expression is expecting a map", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			authenticators, authServer := integration.ConfigureAuth(t)
			claimKey := "extraclaim"
			claimVal := "extravalue"
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims.custom_value." + claimKey,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope":        "read:employee read:private",
					"custom_value": "asasas",
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 10, "expected 10 spans, got %d", len(sn))
				for i := 0; i < len(sn); i++ {
					assert.NotContains(t, sn[i].Attributes(), attribute.String(claimKey, claimVal))
				}

				rm := metricdata.ResourceMetrics{}
				err = metricReader.Collect(context.Background(), &rm)
				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

				require.NoError(t, err)
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)
				require.IsType(t, metricdata.Sum[int64]{}, scopeMetric.Metrics[0].Data)
				data2 := scopeMetric.Metrics[0].Data.(metricdata.Sum[int64])
				atts := data2.DataPoints[0].Attributes
				_, ok := atts.Value(attribute.Key(claimKey))
				require.False(t, ok)
			})
		})

		t.Run("not existing JWT claim is not added", func(t *testing.T) {
			t.Parallel()

			claimKey := "extraclaim"
			claimVal := "extravalue"
			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			authenticators, authServer := integration.ConfigureAuth(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims." + claimKey,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope": "read:employee read:private",
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 10, "expected 10 spans, got %d", len(sn))
				for i := 0; i < len(sn); i++ {
					assert.NotContains(t, sn[i].Attributes(), attribute.String(claimKey, claimVal))
				}

				rm := metricdata.ResourceMetrics{}
				err = metricReader.Collect(context.Background(), &rm)
				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

				require.NoError(t, err)
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)
				require.IsType(t, metricdata.Sum[int64]{}, scopeMetric.Metrics[0].Data)
				data2 := scopeMetric.Metrics[0].Data.(metricdata.Sum[int64])
				atts := data2.DataPoints[0].Attributes
				ok := atts.HasValue(attribute.Key(claimKey))
				require.False(t, ok)
			})
		})

		t.Run("invalid expression", func(t *testing.T) {
			t.Parallel()

			claimKey := "extraclaim"
			metricReader := metric.NewManualReader()
			err := testenv.RunWithError(t, &testenv.Config{
				MetricReader: metricReader,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key: claimKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "TEST request.auth.claims." + claimKey,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				assert.FailNow(t, "should not be called")
			})
			expectedErr := errors.New("failed to build base mux: custom attribute error, unable to compile 'extraclaim' with expression 'TEST request.auth.claims.extraclaim': line 1, column 5: unexpected token Identifier(\"request\")")
			assert.ErrorAs(t, err, &expectedErr)
		})
	})

	t.Run("Should include cosmo router info metrics", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

			routerInfoMetric := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
						},
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgFeatureFlag.String("myff"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, routerInfoMetric, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})

	t.Run("verify trace attributes", func(t *testing.T) {
		t.Run("verify trace attribute key and default value are present", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			key := "custom"
			value := "value"

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				CustomTracingAttributes: []config.CustomAttribute{
					{
						Key:     key,
						Default: value,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"value_different"},
					},
					Query: `query { employees { id } }`,
				})

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 9)

				for _, snapshot := range sn {
					require.Contains(t, snapshot.Attributes(), attribute.String(key, value))
				}
			})
		})

		t.Run("verify trace attribute key and header value are present", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			key := "custom"
			value := "value_different"

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key:     key,
						Default: "value",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "x-custom-header",
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {value},
					},
					Query: `query { employees { id } }`,
				})

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 9)

				for _, snapshot := range sn {
					require.Contains(t, snapshot.Attributes(), attribute.String(key, value))
				}
			})
		})

		t.Run("verify custom tracing expressions without and with auth", func(t *testing.T) {
			t.Parallel()

			claimKeyWithAuth := "extraclaim"
			claimValWithAuth := "extravalue"
			headerKey := "X-Custom-Header"
			headerVal := "extravalue2"

			exporter := tracetest.NewInMemoryExporter(t)
			authenticators, authServer := integration.ConfigureAuth(t)

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				CustomTracingAttributes: []config.CustomAttribute{
					{
						Key: claimKeyWithAuth,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.auth.claims.custom_value." + claimKeyWithAuth,
						},
					},
					{
						Key: headerKey,
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.header.Get('" + headerKey + "')",
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Operations with a token should succeed
				token, err := authServer.Token(map[string]any{
					"scope": "read:employee read:private",
					"custom_value": map[string]string{
						claimKeyWithAuth: claimValWithAuth,
					},
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
					headerKey:       []string{headerVal},
				}
				_, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"{ employees { id startDate } }"}`))
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()

				var authenticateSpanDetected bool
				require.Len(t, sn, 10)

				for i := 0; i < len(sn); i++ {
					traceAttribute := attribute.String(claimKeyWithAuth, claimValWithAuth)
					attributes := sn[i].Attributes()

					if slices.Contains([]string{"HTTP - Read Body", "Authenticate"}, sn[i].Name()) {
						authenticateSpanDetected = true
						assert.NotContains(t, attributes, traceAttribute)
					} else {
						assert.Contains(t, attributes, traceAttribute)
					}

					assert.Contains(t, attributes, attribute.String(headerKey, headerVal))
				}

				require.True(t, authenticateSpanDetected)
			})
		})
	})

	t.Run("verify attribute expressions with subgraph in the expression", func(t *testing.T) {
		t.Run("verify subgraph expression should only be present for engine fetch", func(t *testing.T) {
			t.Parallel()

			t.Run("with tracing attributes", func(t *testing.T) {
				metricReader := metric.NewManualReader()
				exporter := tracetest.NewInMemoryExporter(t)

				key := "custom.subgraph"
				testenv.Run(t, &testenv.Config{
					TraceExporter: exporter,
					MetricReader:  metricReader,
					CustomTracingAttributes: []config.CustomAttribute{
						{
							Key: key,
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "subgraph.name",
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { employees { id } }`,
					})

					sn := exporter.GetSpans().Snapshots()
					require.Len(t, sn, 9)

					var engineSpanDetected bool

					for i := 0; i < len(sn); i++ {
						subgraphTraceAttribute := attribute.String("custom.subgraph", "employees")
						attributes := sn[i].Attributes()

						if slices.Contains([]string{"Engine - Fetch"}, sn[i].Name()) {
							engineSpanDetected = true
							assert.Contains(t, attributes, subgraphTraceAttribute)
						} else {
							assert.NotContains(t, attributes, subgraphTraceAttribute)
						}
					}

					require.True(t, engineSpanDetected)

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
					require.Greater(t, len(rm.ScopeMetrics), 0)
					require.Greater(t, len(scopeMetric.Metrics), 0)

					httpRequestsMetric := scopeMetric.Metrics[0]
					require.Equal(t, "router.http.requests", httpRequestsMetric.Name)
					require.IsType(t, metricdata.Sum[int64]{}, httpRequestsMetric.Data)

					data2 := httpRequestsMetric.Data.(metricdata.Sum[int64])
					attrs := data2.DataPoints[0].Attributes
					_, ok := attrs.Value(attribute.Key(key))
					require.False(t, ok)
				})
			})

			t.Run("with telemetry attributes", func(t *testing.T) {
				exporter := tracetest.NewInMemoryExporter(t)
				metricReader := metric.NewManualReader()

				key := "custom.subgraph"
				expectedValue := "employees"

				testenv.Run(t, &testenv.Config{
					TraceExporter: exporter,
					MetricReader:  metricReader,
					CustomTelemetryAttributes: []config.CustomAttribute{
						{
							Key: key,
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "subgraph.name",
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { employees { id } }`,
					})

					sn := exporter.GetSpans().Snapshots()
					require.Len(t, sn, 9)

					var engineSpanDetected bool

					subgraphTraceAttribute := attribute.String(key, expectedValue)
					for i := 0; i < len(sn); i++ {
						attributes := sn[i].Attributes()

						if slices.Contains([]string{"Engine - Fetch"}, sn[i].Name()) {
							engineSpanDetected = true
							assert.Contains(t, attributes, subgraphTraceAttribute)
						} else {
							assert.NotContains(t, attributes, subgraphTraceAttribute)
						}
					}

					require.True(t, engineSpanDetected)

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
					require.Greater(t, len(rm.ScopeMetrics), 0)
					require.Greater(t, len(scopeMetric.Metrics), 0)

					httpRequestsMetric := scopeMetric.Metrics[0]
					require.Equal(t, "router.http.requests", httpRequestsMetric.Name)
					require.IsType(t, metricdata.Sum[int64]{}, httpRequestsMetric.Data)

					atts := httpRequestsMetric.Data.(metricdata.Sum[int64]).DataPoints[0].Attributes
					val, ok := atts.Value(attribute.Key(key))
					require.True(t, ok)
					require.Equal(t, expectedValue, val.AsString())

					subgraphNonMetric := scopeMetric.Metrics[5]
					require.Equal(t, "router.graphql.operation.planning_time", subgraphNonMetric.Name)
					require.IsType(t, metricdata.Histogram[float64]{}, subgraphNonMetric.Data)
					atts = subgraphNonMetric.Data.(metricdata.Histogram[float64]).DataPoints[0].Attributes
					_, ok = atts.Value(attribute.Key(key))
					require.False(t, ok)
				})
			})

			t.Run("with metric attributes", func(t *testing.T) {
				exporter := tracetest.NewInMemoryExporter(t)
				metricReader := metric.NewManualReader()

				key := "custom.subgraph"
				expectedValue := "employees"

				testenv.Run(t, &testenv.Config{
					TraceExporter: exporter,
					MetricReader:  metricReader,
					CustomMetricAttributes: []config.CustomAttribute{
						{
							Key: key,
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "subgraph.name",
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { employees { id } }`,
					})

					sn := exporter.GetSpans().Snapshots()
					require.Len(t, sn, 9)

					subgraphTraceAttribute := attribute.String(key, expectedValue)
					for i := 0; i < len(sn); i++ {
						attributes := sn[i].Attributes()
						assert.NotContains(t, attributes, subgraphTraceAttribute)
					}

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
					require.Greater(t, len(rm.ScopeMetrics), 0)
					require.Greater(t, len(scopeMetric.Metrics), 0)

					httpRequestsMetric := scopeMetric.Metrics[0]
					require.Equal(t, "router.http.requests", httpRequestsMetric.Name)
					require.IsType(t, metricdata.Sum[int64]{}, httpRequestsMetric.Data)

					data2 := httpRequestsMetric.Data.(metricdata.Sum[int64])
					atts := data2.DataPoints[0].Attributes
					val, ok := atts.Value(attribute.Key(key))
					require.True(t, ok)
					require.Equal(t, expectedValue, val.AsString())

					subgraphNonMetric := scopeMetric.Metrics[5]
					require.Equal(t, "router.graphql.operation.planning_time", subgraphNonMetric.Name)
					require.IsType(t, metricdata.Histogram[float64]{}, subgraphNonMetric.Data)
					atts = subgraphNonMetric.Data.(metricdata.Histogram[float64]).DataPoints[0].Attributes
					_, ok = atts.Value(attribute.Key(key))
					require.False(t, ok)
				})
			})
		})

		t.Run("verify trace attributes are processed", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key: "custom.subgraph",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "string(subgraph.request.clientTrace.connAcquireDuration.Seconds())",
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 9)

				var attributeDetected bool

				for i := 0; i < len(sn); i++ {
					attributes := sn[i].Attributes()

					if slices.Contains([]string{"Engine - Fetch"}, sn[i].Name()) {
						for _, attribute := range attributes {
							if attribute.Key == "custom.subgraph" {
								attributeDetected = true
								valueString := attribute.Value.AsString()
								floatValue, err := strconv.ParseFloat(valueString, 64)
								require.NoError(t, err)
								require.Greater(t, floatValue, 0.0)
							}
						}
					}
				}

				require.True(t, attributeDetected)

				rm := metricdata.ResourceMetrics{}
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
				require.Greater(t, len(rm.ScopeMetrics), 0)
				require.Greater(t, len(scopeMetric.Metrics), 0)

				httpRequestsMetric := scopeMetric.Metrics[0]
				require.Equal(t, "router.http.requests", httpRequestsMetric.Name)
				require.IsType(t, metricdata.Sum[int64]{}, httpRequestsMetric.Data)

				atts := httpRequestsMetric.Data.(metricdata.Sum[int64]).DataPoints[0].Attributes
				val, ok := atts.Value("custom.subgraph")
				require.True(t, ok)
				floatValue, err := strconv.ParseFloat(val.AsString(), 64)
				require.NoError(t, err)
				require.Greater(t, floatValue, 0.0)

				subgraphNonMetric := scopeMetric.Metrics[5]
				require.Equal(t, "router.graphql.operation.planning_time", subgraphNonMetric.Name)
				require.IsType(t, metricdata.Histogram[float64]{}, subgraphNonMetric.Data)
				atts = subgraphNonMetric.Data.(metricdata.Histogram[float64]).DataPoints[0].Attributes
				_, ok = atts.Value("custom.subgraph")
				require.False(t, ok)
			})
		})

		t.Run("verify subgraph fetch duration value is attached for multiple subgraph calls", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomTelemetryAttributes: []config.CustomAttribute{
					{
						Key: "fetch_duration.subgraph",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "string(subgraph.request.clientTrace.fetchDuration.Seconds())",
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id isAvailable } }`,
				})

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 11)

				var attributesDetected int

				for i := 0; i < len(sn); i++ {
					attributes := sn[i].Attributes()

					if slices.Contains([]string{"Engine - Fetch"}, sn[i].Name()) {
						for _, attributeEntry := range attributes {
							if attributeEntry.Key == "fetch_duration.subgraph" {
								attributesDetected++
								valueString := attributeEntry.Value.AsString()
								floatValue, err := strconv.ParseFloat(valueString, 64)
								require.NoError(t, err)
								require.Greater(t, floatValue, 0.0)
							}
						}
					} else {
						for _, attributeEntry := range attributes {
							if attributeEntry.Key == "fetch_duration.subgraph" {
								require.Fail(t, "fetch_duration.subgraph should not be present on non engine fetch spans")
							}
						}
					}
				}

				require.Equal(t, 2, attributesDetected)
			})
		})
	})

}

func TestExcludeAttributesWithCustomExporter(t *testing.T) {
	const (
		UseCloudExporter                           = "use_cloud_exporter"
		UseCustomExporterOnly                      = "use_custom_exporter_only"
		UseCustomExporterWithRouterConfigAttribute = "use_custom_exporter_with_router_config_attribute"
	)

	t.Run("Verify metrics when there is a router config version metric attribute", func(t *testing.T) {
		useCloudExporterTypeStatuses := []string{
			UseCloudExporter,
			UseCustomExporterOnly,
			UseCustomExporterWithRouterConfigAttribute,
		}

		for _, usingCustomExporter := range useCloudExporterTypeStatuses {
			t.Run(fmt.Sprintf("regular metrics without a feature flag for %s", usingCustomExporter), func(t *testing.T) {
				metricReader := metric.NewManualReader()
				exporter := tracetest.NewInMemoryExporter(t)

				cfg := &testenv.Config{
					TraceExporter:                exporter,
					MetricReader:                 metricReader,
					DisableSimulateCloudExporter: usingCustomExporter != UseCloudExporter,
				}

				if usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
					cfg.CustomMetricAttributes = []config.CustomAttribute{
						{
							Key: "wg.router.config.version",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: "router_config_version",
							},
						},
					}
				}
				testenv.Run(t, cfg,
					func(t *testing.T, xEnv *testenv.Environment) {
						xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
							Query: `query { employees { id } }`,
						})

						rm := metricdata.ResourceMetrics{}
						err := metricReader.Collect(context.Background(), &rm)
						require.NoError(t, err)

						firstDataPoint := []attribute.KeyValue{
							semconv.HTTPStatusCode(200),
							otel.WgClientName.String("unknown"),
							otel.WgClientVersion.String("missing"),
							otel.WgFederatedGraphID.String("graph"),
							otel.WgOperationProtocol.String("http"),
							otel.WgOperationType.String("query"),
							otel.WgRouterClusterName.String(""),
							otel.WgRouterVersion.String("dev"),
							otel.WgSubgraphID.String("0"),
							otel.WgSubgraphName.String("employees"),
						}

						secondDataPoint := []attribute.KeyValue{
							semconv.HTTPStatusCode(200),
							otel.WgClientName.String("unknown"),
							otel.WgClientVersion.String("missing"),
							otel.WgFederatedGraphID.String("graph"),
							otel.WgOperationProtocol.String("http"),
							otel.WgOperationType.String("query"),
							otel.WgRouterClusterName.String(""),
							otel.WgRouterVersion.String("dev"),
						}

						if usingCustomExporter == UseCloudExporter || usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
							routerConfigVersion := otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain())
							firstDataPoint = append(firstDataPoint, routerConfigVersion)
							secondDataPoint = append(secondDataPoint, routerConfigVersion)
						}

						if usingCustomExporter == UseCloudExporter {
							operationHash := otel.WgOperationHash.String("1163600561566987607")
							operationName := otel.WgOperationName.String("")
							firstDataPoint = append(firstDataPoint, operationHash, operationName)
							secondDataPoint = append(secondDataPoint, operationHash, operationName)
						}

						httpRequestsMetric := metricdata.Metrics{
							Name:        "router.http.requests",
							Description: "Total number of requests",
							Unit:        "",
							Data: metricdata.Sum[int64]{
								Temporality: metricdata.CumulativeTemporality,
								IsMonotonic: true,
								DataPoints: []metricdata.DataPoint[int64]{
									{Attributes: attribute.NewSet(firstDataPoint...)},
									{Attributes: attribute.NewSet(secondDataPoint...)},
								},
							},
						}

						scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
						require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)
						require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

						metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
					})
			})

			t.Run(fmt.Sprintf("regular metrics with a feature flag for %s", usingCustomExporter), func(t *testing.T) {
				metricReader := metric.NewManualReader()
				exporter := tracetest.NewInMemoryExporter(t)

				cfg := &testenv.Config{
					TraceExporter:                exporter,
					MetricReader:                 metricReader,
					DisableSimulateCloudExporter: usingCustomExporter != UseCloudExporter,
				}

				if usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
					cfg.CustomMetricAttributes = []config.CustomAttribute{
						{
							Key: "wg.router.config.version",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: "router_config_version",
							},
						},
					}
				}

				testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { employees { id } }`,
						Header: map[string][]string{
							"X-Feature-Flag": {"myff"},
						},
					})

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					firstDataPoint := []attribute.KeyValue{
						semconv.HTTPStatusCode(200),
						otel.WgClientName.String("unknown"),
						otel.WgClientVersion.String("missing"),
						otel.WgFederatedGraphID.String("graph"),
						otel.WgOperationProtocol.String("http"),
						otel.WgOperationType.String("query"),
						otel.WgRouterClusterName.String(""),
						otel.WgRouterVersion.String("dev"),
						otel.WgSubgraphID.String("0"),
						otel.WgSubgraphName.String("employees"),
						otel.WgFeatureFlag.String("myff"),
					}

					secondDataPoint := []attribute.KeyValue{
						semconv.HTTPStatusCode(200),
						otel.WgClientName.String("unknown"),
						otel.WgClientVersion.String("missing"),
						otel.WgFederatedGraphID.String("graph"),
						otel.WgOperationProtocol.String("http"),
						otel.WgOperationType.String("query"),
						otel.WgRouterClusterName.String(""),
						otel.WgRouterVersion.String("dev"),
						otel.WgFeatureFlag.String("myff"),
					}

					if usingCustomExporter == UseCloudExporter || usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
						routerConfigVersion := otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF())
						firstDataPoint = append(firstDataPoint, routerConfigVersion)
						secondDataPoint = append(secondDataPoint, routerConfigVersion)
					}

					if usingCustomExporter == UseCloudExporter {
						operationHash := otel.WgOperationHash.String("1163600561566987607")
						operationName := otel.WgOperationName.String("")
						firstDataPoint = append(firstDataPoint, operationHash, operationName)
						secondDataPoint = append(secondDataPoint, operationHash, operationName)
					}

					httpRequestsMetric := metricdata.Metrics{
						Name:        "router.http.requests",
						Description: "Total number of requests",
						Unit:        "",
						Data: metricdata.Sum[int64]{
							Temporality: metricdata.CumulativeTemporality,
							IsMonotonic: true,
							DataPoints: []metricdata.DataPoint[int64]{
								{
									Attributes: attribute.NewSet(firstDataPoint...),
								},
								{
									Attributes: attribute.NewSet(secondDataPoint...),
								},
							},
						},
					}

					require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount)

					scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
					require.Len(t, scopeMetric.Metrics, defaultCosmoRouterMetricsCount)

					metricdatatest.AssertEqual(t, httpRequestsMetric, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
				})
			})

			t.Run(fmt.Sprintf("runtime metrics for %s", usingCustomExporter), func(t *testing.T) {
				metricReader := metric.NewManualReader()
				exporter := tracetest.NewInMemoryExporter(t)

				cfg := &testenv.Config{
					TraceExporter: exporter,
					MetricReader:  metricReader,
					MetricOptions: testenv.MetricOptions{
						EnableRuntimeMetrics: true,
					},
					DisableSimulateCloudExporter: usingCustomExporter != UseCloudExporter,
				}

				if usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
					cfg.CustomMetricAttributes = []config.CustomAttribute{
						{
							Key: "wg.router.config.version",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: "router_config_version",
							},
						},
					}
				}

				testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { employees { id } }`,
					})

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

					runtimeScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.runtime")
					require.NotNil(t, runtimeScope)
					require.Len(t, runtimeScope.Metrics, 15)

					metricRuntimeUptime := integration.GetMetricByName(runtimeScope, "process.uptime")
					require.NotNil(t, metricRuntimeUptime)
					metricRuntimeUptimeDataType := metricRuntimeUptime.Data.(metricdata.Gauge[int64])
					require.Len(t, metricRuntimeUptimeDataType.DataPoints, 1)

					dataPoint := []attribute.KeyValue{
						otel.WgRouterClusterName.String(""),
						otel.WgFederatedGraphID.String("graph"),
						otel.WgRouterVersion.String("dev"),
					}

					if usingCustomExporter == UseCloudExporter || usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
						routerConfigVersion := otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain())
						dataPoint = append(dataPoint, routerConfigVersion)
					}

					runtimeUptimeMetric := metricdata.Metrics{
						Name:        "process.uptime",
						Description: "Seconds since application was initialized",
						Unit:        "s",
						Data: metricdata.Gauge[int64]{
							DataPoints: []metricdata.DataPoint[int64]{
								{
									Attributes: attribute.NewSet(dataPoint...),
								},
							},
						},
					}

					metricdatatest.AssertEqual(t, runtimeUptimeMetric, *metricRuntimeUptime, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
				})
			})

			t.Run(fmt.Sprintf("engine statistic metrics for %s", usingCustomExporter), func(t *testing.T) {
				metricReader := metric.NewManualReader()

				cfg := &testenv.Config{
					MetricReader: metricReader,
					MetricOptions: testenv.MetricOptions{
						OTLPEngineStatsOptions: testenv.EngineStatOptions{
							EnableSubscription: true,
						},
					},
					DisableSimulateCloudExporter: usingCustomExporter != UseCloudExporter,
				}

				if usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
					cfg.CustomMetricAttributes = []config.CustomAttribute{
						{
							Key: "wg.router.config.version",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: "router_config_version",
							},
						},
					}
				}

				testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
					conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
					err := conn.WriteJSON(&testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
					})

					require.NoError(t, err)

					xEnv.WaitForSubscriptionCount(1, time.Second*5)

					rm := metricdata.ResourceMetrics{}
					err = metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					baseAttributes := []attribute.KeyValue{
						otel.WgRouterClusterName.String(""),
						otel.WgFederatedGraphID.String("graph"),
						otel.WgRouterVersion.String("dev"),
					}

					if usingCustomExporter == UseCloudExporter || usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
						routerConfigVersion := otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain())
						baseAttributes = append(baseAttributes, routerConfigVersion)
					}

					engineScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.engine")
					connectionMetrics := metricdata.Metrics{
						Name:        "router.engine.connections",
						Description: "Number of connections in the engine. Contains both websocket and http connections",

						Data: metricdata.Sum[int64]{
							Temporality: metricdata.CumulativeTemporality,
							IsMonotonic: false,
							DataPoints: []metricdata.DataPoint[int64]{
								{
									Attributes: attribute.NewSet(baseAttributes...),
									Value:      1,
								},
							},
						},
					}

					metricdatatest.AssertEqual(t, connectionMetrics, *integration.GetMetricByName(engineScope, "router.engine.connections"), metricdatatest.IgnoreTimestamp())
				})
			})

			t.Run(fmt.Sprintf("cache metrics for %s", usingCustomExporter), func(t *testing.T) {
				t.Parallel()
				metricReader := metric.NewManualReader()

				cfg := &testenv.Config{
					MetricReader: metricReader,
					MetricOptions: testenv.MetricOptions{
						EnableOTLPRouterCache: true,
					},
					DisableSimulateCloudExporter: usingCustomExporter != UseCloudExporter,
				}

				if usingCustomExporter == UseCustomExporterWithRouterConfigAttribute {
					cfg.CustomMetricAttributes = []config.CustomAttribute{
						{
							Key: "wg.router.config.version",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: "router_config_version",
							},
						},
					}
				}

				testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { employees { id } }`,
						Header: map[string][]string{
							"X-Feature-Flag": {"myff"},
						},
					})

					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query myQuery { employees { id } }`,
					})

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)

					require.NoError(t, err)
					require.Len(t, rm.ScopeMetrics, defaultExposedScopedMetricsCount+1)

					cacheScope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.cache")
					require.NotNil(t, cacheScope)
					require.Len(t, cacheScope.Metrics, 4)

					extraCapacity := 0
					if usingCustomExporter != UseCustomExporterOnly {
						extraCapacity++
					}

					mainAttributes := make([]attribute.KeyValue, 0, 3+extraCapacity)
					mainAttributes = append(mainAttributes,
						otel.WgRouterClusterName.String(""),
						otel.WgFederatedGraphID.String("graph"),
						otel.WgRouterVersion.String("dev"))
					if usingCustomExporter != UseCustomExporterOnly {
						mainAttributes = append(mainAttributes, otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
					}

					featureFlagAttributes := make([]attribute.KeyValue, 0, 4+extraCapacity)
					featureFlagAttributes = append(featureFlagAttributes,
						otel.WgRouterClusterName.String(""),
						otel.WgFederatedGraphID.String("graph"),
						otel.WgRouterVersion.String("dev"),
						otel.WgFeatureFlag.String("myff"))
					if usingCustomExporter != UseCustomExporterOnly {
						featureFlagAttributes = append(featureFlagAttributes, otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
					}

					requestStatsMetrics := metricdata.Metrics{
						Name:        "router.graphql.cache.requests.stats",
						Description: "Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio",
						Data: metricdata.Sum[int64]{
							Temporality: metricdata.CumulativeTemporality,
							IsMonotonic: true,
							DataPoints: []metricdata.DataPoint[int64]{
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "plan"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(mainAttributes,
										attribute.String("cache_type", "plan"),
										attribute.String("type", "misses"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "query_normalization"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "query_normalization"),
										attribute.String("type", "misses"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "persisted_query_normalization"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "persisted_query_normalization"),
										attribute.String("type", "misses"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "validation"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										mainAttributes,
										attribute.String("cache_type", "validation"),
										attribute.String("type", "misses"),
									)...),
								},
								// Feature flag cache stats
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "plan"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "plan"),
										attribute.String("type", "misses"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "query_normalization"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "query_normalization"),
										attribute.String("type", "misses"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "persisted_query_normalization"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "persisted_query_normalization"),
										attribute.String("type", "misses"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "validation"),
										attribute.String("type", "hits"),
									)...),
								},
								{
									Attributes: attribute.NewSet(append(
										featureFlagAttributes,
										attribute.String("cache_type", "validation"),
										attribute.String("type", "misses"),
									)...),
								},
							},
						},
					}

					metrics := *integration.GetMetricByName(cacheScope, "router.graphql.cache.requests.stats")
					metricdatatest.AssertEqual(t, requestStatsMetrics, metrics, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
				})
			})
		}

	})
}
