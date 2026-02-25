package telemetry

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	otelattrs "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

type subscriptionArgs struct {
	dataValue []byte
	errValue  error
}

const WaitTimeout = time.Second * 30

func TestFlakyEventMetrics(t *testing.T) {
	t.Parallel()

	t.Run("kafka", func(t *testing.T) {
		t.Parallel()

		t.Run("publish", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.KafkaEnsureTopicExists(t, xEnv, time.Second, "employeeUpdated")
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})

				rm := metricdata.ResourceMetrics{}
				require.NoError(t, metricReader.Collect(context.Background(), &rm))

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
				require.NotNil(t, scope)
				metricEntry := integration.GetMetricByName(scope, "router.streams.sent.messages")
				require.NotNil(t, metricEntry)

				sum, _ := metricEntry.Data.(metricdata.Sum[int64])
				require.Len(t, sum.DataPoints, 1)

				attrs := sum.DataPoints[0].Attributes

				operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
				require.Equal(t, "produce", operation.AsString())

				system, _ := attrs.Value(otelattrs.WgProviderType)
				require.Equal(t, "kafka", system.AsString())

				destination, _ := attrs.Value(otelattrs.WgDestinationName)
				require.True(t, strings.HasSuffix(destination.AsString(), "employeeUpdated"))

				provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
				require.True(t, hasProvider)
				require.Equal(t, "my-kafka", provider.AsString())

				_, hasErr := attrs.Value(otelattrs.WgErrorType)
				require.False(t, hasErr)

				require.Equal(t, int64(2), sum.DataPoints[0].Value)
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			topic := "employeeUpdated"

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.KafkaEnsureTopicExists(t, xEnv, time.Second, topic)

				var subscriptionOne struct {
					employeeUpdatedMyKafka struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
				}

				client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())
				subscriptionArgsCh := make(chan subscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- subscriptionArgs{dataValue: dataValue, errValue: errValue}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)
				clientRunCh := make(chan error)
				go func() { clientRunCh <- client.Run() }()
				xEnv.WaitForSubscriptionCount(1, WaitTimeout)

				events.ProduceKafkaMessage(t, xEnv, time.Second, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
					require.NotNil(t, scope)
					metricEntry := integration.GetMetricByName(scope, "router.streams.received.messages")
					require.NotNil(t, metricEntry)

					sum, _ := metricEntry.Data.(metricdata.Sum[int64])

					require.Len(t, sum.DataPoints, 1)
					attrs := sum.DataPoints[0].Attributes

					operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
					require.Equal(t, "receive", operation.AsString())

					system, _ := attrs.Value(otelattrs.WgProviderType)
					require.Equal(t, "kafka", system.AsString())

					destination, _ := attrs.Value(otelattrs.WgDestinationName)
					require.True(t, strings.HasSuffix(destination.AsString(), "employeeUpdated"))

					provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
					require.True(t, hasProvider)
					require.Equal(t, "my-kafka", provider.AsString())

					_, hasErr := attrs.Value(otelattrs.WgErrorType)
					require.False(t, hasErr)

					require.Equal(t, int64(1), sum.DataPoints[0].Value)
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, clientRunCh, func(t *testing.T, err error) { require.NoError(t, err) })
			})
		})
	})

	t.Run("nats", func(t *testing.T) {
		t.Parallel()

		t.Run("publish", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
					updateEmployeeMyNats(id: 12, update: $update) {success}
				}`, Variables: json.RawMessage(`{"update":{"name":"n1"}}`)})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
					updateEmployeeMyNats(id: 12, update: $update) {success}
				}`, Variables: json.RawMessage(`{"update":{"name":"n2"}}`)})

				rm := metricdata.ResourceMetrics{}
				require.NoError(t, metricReader.Collect(context.Background(), &rm))

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
				require.NotNil(t, scope)
				metricEntry := integration.GetMetricByName(scope, "router.streams.sent.messages")
				require.NotNil(t, metricEntry)

				sum, _ := metricEntry.Data.(metricdata.Sum[int64])
				require.Len(t, sum.DataPoints, 1)
				attrs := sum.DataPoints[0].Attributes

				operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
				require.Equal(t, "publish", operation.AsString())

				system, _ := attrs.Value(otelattrs.WgProviderType)
				require.Equal(t, "nats", system.AsString())

				destination, _ := attrs.Value(otelattrs.WgDestinationName)
				require.True(t, strings.HasSuffix(destination.AsString(), "employeeUpdatedMyNats.12"))

				provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
				require.True(t, hasProvider)
				require.Equal(t, "my-nats", provider.AsString())

				_, hasErr := attrs.Value(otelattrs.WgErrorType)
				require.False(t, hasErr)

				require.Equal(t, int64(2), sum.DataPoints[0].Value)
			})
		})

		t.Run("request", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				sub, err := xEnv.NatsConnectionMyNats.Subscribe(xEnv.GetPubSubName("getEmployeeMyNats.12"), func(msg *nats.Msg) { _ = msg.Respond([]byte(`{"id": 12, "__typename": "Employee"}`)) })
				require.NoError(t, err)
				require.NoError(t, xEnv.NatsConnectionMyNats.Flush())
				t.Cleanup(func() { _ = sub.Unsubscribe() })

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employeeFromEventMyNats(employeeID: 12) { id details { forename } }}`})
				require.JSONEq(t, `{"data":{"employeeFromEventMyNats": {"id": 12, "details": {"forename": "David"}}}}`, res.Body)

				rm := metricdata.ResourceMetrics{}
				require.NoError(t, metricReader.Collect(context.Background(), &rm))

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
				require.NotNil(t, scope)
				metricEntry := integration.GetMetricByName(scope, "router.streams.sent.messages")
				require.NotNil(t, metricEntry)

				sum, _ := metricEntry.Data.(metricdata.Sum[int64])
				require.Len(t, sum.DataPoints, 1)
				attrs := sum.DataPoints[0].Attributes

				operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
				require.Equal(t, "request", operation.AsString())

				system, _ := attrs.Value(otelattrs.WgProviderType)
				require.Equal(t, "nats", system.AsString())

				destination, _ := attrs.Value(otelattrs.WgDestinationName)
				require.True(t, strings.HasSuffix(destination.AsString(), "getEmployeeMyNats.12"))

				provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
				require.True(t, hasProvider)
				require.Equal(t, "my-nats", provider.AsString())

				_, hasErr := attrs.Value(otelattrs.WgErrorType)
				require.False(t, hasErr)

				require.Equal(t, int64(1), sum.DataPoints[0].Value)
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				MetricReader:                       metricReader,
				RouterConfigJSONTemplate:           testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:                         true,
				ModifyEngineExecutionConfiguration: func(ec *config.EngineExecutionConfiguration) { ec.WebSocketServerReadTimeout = time.Second },
				MetricOptions:                      testenv.MetricOptions{EnableOTLPStreamMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				var subscriptionOne struct {
					employeeUpdated struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdated(employeeID: 3)"`
				}

				client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

				subscriptionArgsCh := make(chan subscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- subscriptionArgs{
						dataValue: dataValue,
						errValue:  errValue,
					}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				clientRunErrCh := make(chan error)
				go func() {
					clientRunErrCh <- client.Run()
				}()

				xEnv.WaitForSubscriptionCount(1, WaitTimeout)

				// Send a mutation to trigger the first subscription
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename":"Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
					require.NotNil(t, scope)
					metricEntry := integration.GetMetricByName(scope, "router.streams.received.messages")
					require.NotNil(t, metricEntry)

					sum, _ := metricEntry.Data.(metricdata.Sum[int64])

					require.Len(t, sum.DataPoints, 1)
					attrs := sum.DataPoints[0].Attributes

					operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
					require.Equal(t, "receive", operation.AsString())

					system, _ := attrs.Value(otelattrs.WgProviderType)
					require.Equal(t, "nats", system.AsString())

					destination, _ := attrs.Value(otelattrs.WgDestinationName)
					require.True(t, strings.HasSuffix(destination.AsString(), "employeeUpdated.3"))

					provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
					require.True(t, hasProvider)
					require.Equal(t, "default", provider.AsString())

					_, hasErr := attrs.Value(otelattrs.WgErrorType)
					require.False(t, hasErr)

					require.Equal(t, int64(1), sum.DataPoints[0].Value)
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, clientRunErrCh, func(t *testing.T, err error) {
					require.NoError(t, err)
				}, "unable to close client before timeout")

				xEnv.WaitForSubscriptionCount(0, WaitTimeout)
				xEnv.WaitForConnectionCount(0, WaitTimeout)
			})
		})
	})

	t.Run("redis", func(t *testing.T) {
		t.Parallel()

		t.Run("publish", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r1"}) { success } }`})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r2"}) { success } }`})

				rm := metricdata.ResourceMetrics{}
				require.NoError(t, metricReader.Collect(context.Background(), &rm))

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
				require.NotNil(t, scope)
				metricEntry := integration.GetMetricByName(scope, "router.streams.sent.messages")
				require.NotNil(t, metricEntry)

				sum, _ := metricEntry.Data.(metricdata.Sum[int64])

				require.Len(t, sum.DataPoints, 1)
				attrs := sum.DataPoints[0].Attributes

				operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
				require.Equal(t, "publish", operation.AsString())

				system, _ := attrs.Value(otelattrs.WgProviderType)
				require.Equal(t, "redis", system.AsString())

				destination, _ := attrs.Value(otelattrs.WgDestinationName)
				require.True(t, strings.HasSuffix(destination.AsString(), "employeeUpdatedMyRedis"))

				provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
				require.True(t, hasProvider)
				require.Equal(t, "my-redis", provider.AsString())

				_, hasErr := attrs.Value(otelattrs.WgErrorType)
				require.False(t, hasErr)

				require.Equal(t, int64(2), sum.DataPoints[0].Value)
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				MetricOptions:            testenv.MetricOptions{EnableOTLPStreamMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				topic := "employeeUpdatedMyRedis"

				var subscriptionOne struct {
					employeeUpdates struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdates"`
				}

				client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

				subscriptionArgsCh := make(chan subscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- subscriptionArgs{dataValue, errValue}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				runCh := make(chan error)
				go func() { runCh <- client.Run() }()

				xEnv.WaitForSubscriptionCount(1, WaitTimeout)
				events.ProduceRedisMessage(t, xEnv, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.streams")
					require.NotNil(t, scope)
					metricEntry := integration.GetMetricByName(scope, "router.streams.received.messages")
					require.NotNil(t, metricEntry)

					sum, _ := metricEntry.Data.(metricdata.Sum[int64])

					require.Len(t, sum.DataPoints, 1)
					attrs := sum.DataPoints[0].Attributes

					operation, _ := attrs.Value(otelattrs.WgStreamOperationName)
					require.Equal(t, "receive", operation.AsString())

					system, _ := attrs.Value(otelattrs.WgProviderType)
					require.Equal(t, "redis", system.AsString())

					destination, _ := attrs.Value(otelattrs.WgDestinationName)
					require.True(t, strings.HasSuffix(destination.AsString(), "employeeUpdatedMyRedis"))

					provider, hasProvider := attrs.Value(otelattrs.WgProviderId)
					require.True(t, hasProvider)
					require.Equal(t, "my-redis", provider.AsString())

					_, hasErr := attrs.Value(otelattrs.WgErrorType)
					require.False(t, hasErr)

					require.Equal(t, int64(1), sum.DataPoints[0].Value)
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, runCh, func(t *testing.T, err error) { require.NoError(t, err) })
			})
		})
	})
}
