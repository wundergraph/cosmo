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

func TestOTLEventMetrics(t *testing.T) {
	t.Run("kafka", func(t *testing.T) {
		t.Run("publish", func(t *testing.T) {
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPEventMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.EnsureTopicExists(t, xEnv, "employeeUpdated")
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})

				rm := metricdata.ResourceMetrics{}
				require.NoError(t, metricReader.Collect(context.Background(), &rm))

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
				require.NotNil(t, scope)
				metric := integration.GetMetricByName(scope, "router.events.publish.messages")
				require.NotNil(t, metric)

				sum, ok := metric.Data.(metricdata.Sum[int64])
				require.True(t, ok)

				dataPoint := sum.DataPoints[0]
				attrs := dataPoint.Attributes

				eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
				require.Equal(t, "my-kafka", eventProviderId.AsString())

				eventProviderType, _ := attrs.Value(otelattrs.WgEventProviderType)
				require.Equal(t, "kafka", eventProviderType.AsString())

				kafkaTopic, _ := attrs.Value(otelattrs.WgKafkaTopic)
				require.True(t, strings.HasSuffix(kafkaTopic.AsString(), "employeeUpdated"))

				require.Equal(t, int64(2), dataPoint.Value)
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			metricReader := metric.NewManualReader()
			topic := "employeeUpdated"

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPEventMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.EnsureTopicExists(t, xEnv, topic)

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

				events.ProduceKafkaMessage(t, xEnv, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
					require.NotNil(t, scope)
					metric := integration.GetMetricByName(scope, "router.events.messages.received")
					require.NotNil(t, metric)

					sum, ok := metric.Data.(metricdata.Sum[int64])
					require.True(t, ok)

					dataPoint := sum.DataPoints[0]
					attrs := dataPoint.Attributes

					eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
					require.Equal(t, "my-kafka", eventProviderId.AsString())

					eventProviderType, _ := attrs.Value(otelattrs.WgEventProviderType)
					require.Equal(t, "kafka", eventProviderType.AsString())

					kafkaTopic, _ := attrs.Value(otelattrs.WgKafkaTopic)
					require.True(t, strings.HasSuffix(kafkaTopic.AsString(), "employeeUpdated"))

					require.Equal(t, int64(1), dataPoint.Value)
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, clientRunCh, func(t *testing.T, err error) { require.NoError(t, err) })
			})
		})
	})

	t.Run("nats", func(t *testing.T) {
		t.Run("publish", func(t *testing.T) {
			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPEventMetrics: true,
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

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
				require.NotNil(t, scope)
				metric := integration.GetMetricByName(scope, "router.events.publish.messages")
				require.NotNil(t, metric)

				sum, ok := metric.Data.(metricdata.Sum[int64])
				require.True(t, ok)

				dataPoint := sum.DataPoints[0]
				attrs := dataPoint.Attributes

				eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
				require.Equal(t, "my-nats", eventProviderId.AsString())

				eventProviderType, _ := attrs.Value(otelattrs.WgEventProviderType)
				require.Equal(t, "nats", eventProviderType.AsString())

				natsSubject, _ := attrs.Value(otelattrs.WgNatsSubject)
				require.True(t, strings.HasSuffix(natsSubject.AsString(), "employeeUpdatedMyNats.12"))

				require.Equal(t, int64(2), dataPoint.Value)
			})
		})

		t.Run("request", func(t *testing.T) {
			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPEventMetrics: true,
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

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
				require.NotNil(t, scope)
				metric := integration.GetMetricByName(scope, "router.nats.request")
				require.NotNil(t, metric)

				sum, ok := metric.Data.(metricdata.Sum[int64])
				require.True(t, ok)

				dataPoint := sum.DataPoints[0]
				attrs := dataPoint.Attributes

				eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
				require.Equal(t, "my-nats", eventProviderId.AsString())

				natsSubject, _ := attrs.Value(otelattrs.WgNatsSubject)
				require.True(t, strings.HasSuffix(natsSubject.AsString(), "getEmployeeMyNats.12"))

				require.Equal(t, int64(1), dataPoint.Value)
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			metricReader := metric.NewManualReader()
			testenv.Run(t, &testenv.Config{
				MetricReader:                       metricReader,
				RouterConfigJSONTemplate:           testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:                         true,
				ModifyEngineExecutionConfiguration: func(ec *config.EngineExecutionConfiguration) { ec.WebSocketClientReadTimeout = time.Second },
				MetricOptions:                      testenv.MetricOptions{EnableOTLPEventMetrics: true},
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
				resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
				})
				require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, resOne.Body)

				// Trigger the second subscription via NATS
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
					require.NotNil(t, scope)
					metric := integration.GetMetricByName(scope, "router.events.messages.received")
					require.NotNil(t, metric)

					sum, ok := metric.Data.(metricdata.Sum[int64])
					require.True(t, ok)

					dataPoint := sum.DataPoints[0]
					attrs := dataPoint.Attributes

					eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
					require.Equal(t, "default", eventProviderId.AsString())

					eventProviderType, _ := attrs.Value(otelattrs.WgEventProviderType)
					require.Equal(t, "nats", eventProviderType.AsString())

					natsSubject, _ := attrs.Value(otelattrs.WgNatsSubject)
					require.True(t, strings.HasSuffix(natsSubject.AsString(), "employeeUpdated.3"))

					require.Equal(t, int64(2), dataPoint.Value)
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
		t.Run("publish", func(t *testing.T) {
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				MetricOptions: testenv.MetricOptions{
					EnableOTLPEventMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r1"}) { success } }`})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r2"}) { success } }`})

				rm := metricdata.ResourceMetrics{}
				require.NoError(t, metricReader.Collect(context.Background(), &rm))

				scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
				require.NotNil(t, scope)
				metric := integration.GetMetricByName(scope, "router.events.publish.messages")
				require.NotNil(t, metric)

				sum, ok := metric.Data.(metricdata.Sum[int64])
				require.True(t, ok)

				dataPoint := sum.DataPoints[0]
				attrs := dataPoint.Attributes

				eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
				require.Equal(t, "my-redis", eventProviderId.AsString())

				eventProviderType, _ := attrs.Value(otelattrs.WgEventProviderType)
				require.Equal(t, "redis", eventProviderType.AsString())

				redisChannel, _ := attrs.Value(otelattrs.WgRedisChannel)
				require.True(t, strings.HasSuffix(redisChannel.AsString(), "employeeUpdatedMyRedis"))

				require.Equal(t, int64(2), dataPoint.Value)
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				MetricOptions:            testenv.MetricOptions{EnableOTLPEventMetrics: true},
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

					scope := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.event")
					require.NotNil(t, scope)
					metric := integration.GetMetricByName(scope, "router.events.messages.received")
					require.NotNil(t, metric)

					sum, ok := metric.Data.(metricdata.Sum[int64])
					require.True(t, ok)

					dataPoint := sum.DataPoints[0]
					attrs := dataPoint.Attributes

					eventProviderId, _ := attrs.Value(otelattrs.WgEventProviderID)
					require.Equal(t, "my-redis", eventProviderId.AsString())

					eventProviderType, _ := attrs.Value(otelattrs.WgEventProviderType)
					require.Equal(t, "redis", eventProviderType.AsString())

					redisChannel, _ := attrs.Value(otelattrs.WgRedisChannel)
					require.True(t, strings.HasSuffix(redisChannel.AsString(), "employeeUpdatedMyRedis"))

					require.Equal(t, int64(1), dataPoint.Value)
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, runCh, func(t *testing.T, err error) { require.NoError(t, err) })
			})
		})
	})
}
