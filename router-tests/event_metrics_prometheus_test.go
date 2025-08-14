package integration

import (
	"bufio"
	"bytes"
	"encoding/json"
	"go.uber.org/zap"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/nats-io/nats.go"
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
)

type natsSubscriptionArgs struct {
	dataValue []byte
	errValue  error
}

func TestEventMetrics(t *testing.T) {
	t.Run("kafka", func(t *testing.T) {
		t.Run("publish", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()

			testenv.Run(t, &testenv.Config{
				TraceExporter:            exporter,
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions:            testenv.MetricOptions{EnablePrometheusEventMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.EnsureTopicExists(t, xEnv, "employeeUpdated")
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})
				require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})
				require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, res.Body)
				mf, err := promRegistry.Gather()
				require.NoError(t, err)
				family := findMetricFamilyByName(mf, "router_kafka_publish_messages_total")
				require.NotNil(t, family)
				metrics := family.GetMetric()
				require.Len(t, metrics, 1)
				eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
				topic := findMetricLabelByName(metrics, "wg_kafka_topic")
				require.Equal(t, "my-kafka", eventProvider.GetValue())
				require.True(t, strings.HasSuffix(topic.GetValue(), "employeeUpdated"))
				require.Equal(t, float64(2), metrics[0].Counter.GetValue())
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			topic := "employeeUpdated"

			testenv.Run(t, &testenv.Config{
				TraceExporter:            exporter,
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions:            testenv.MetricOptions{EnablePrometheusEventMetrics: true},
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
				subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- kafkaSubscriptionArgs{dataValue: dataValue, errValue: errValue}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)
				clientRunCh := make(chan error)
				go func() { clientRunCh <- client.Run() }()
				xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)
				events.ProduceKafkaMessage(t, xEnv, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
					mf, err := promRegistry.Gather()
					require.NoError(t, err)
					family := findMetricFamilyByName(mf, "router_kafka_messages_received_total")
					require.NotNil(t, family)
					metrics := family.GetMetric()
					require.Len(t, metrics, 1)
					eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
					topic := findMetricLabelByName(metrics, "wg_kafka_topic")
					require.Equal(t, "my-kafka", eventProvider.GetValue())
					require.True(t, strings.HasSuffix(topic.GetValue(), "employeeUpdated"))
					require.Equal(t, float64(1), metrics[0].Counter.GetValue())
				})
				// Close the client to allow Run() to exit
				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) { require.NoError(t, err) }, "unable to close client before timeout")
			})
		})
	})

	t.Run("nats", func(t *testing.T) {
		t.Run("publish", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{
				TraceExporter:            exporter,
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions:            testenv.MetricOptions{EnablePrometheusEventMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
				updateEmployeeMyNats(id: 12, update: $update) {success}
			}`, Variables: json.RawMessage(`{"update":{"name":"n1"}}`)})
				require.Equal(t, `{"data":{"updateEmployeeMyNats":{"success":true}}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
				updateEmployeeMyNats(id: 12, update: $update) {success}
			}`, Variables: json.RawMessage(`{"update":{"name":"n2"}}`)})
				require.Equal(t, `{"data":{"updateEmployeeMyNats":{"success":true}}}`, res.Body)
				mf, err := promRegistry.Gather()
				require.NoError(t, err)
				family := findMetricFamilyByName(mf, "router_nats_publish_messages_total")
				require.NotNil(t, family)
				metrics := family.GetMetric()
				require.NotEmpty(t, metrics)
				eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
				subject := findMetricLabelByName(metrics, "wg_nats_subject")
				require.Equal(t, "my-nats", eventProvider.GetValue())
				require.True(t, strings.HasSuffix(subject.GetValue(), "employeeUpdatedMyNats.12"))
				require.Equal(t, float64(2), metrics[0].Counter.GetValue())
			})
		})

		t.Run("request", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{
				TraceExporter:            exporter,
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions:            testenv.MetricOptions{EnablePrometheusEventMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				sub, err := xEnv.NatsConnectionMyNats.Subscribe(xEnv.GetPubSubName("getEmployeeMyNats.12"), func(msg *nats.Msg) { _ = msg.Respond([]byte(`{"id": 12, "__typename": "Employee"}`)) })
				require.NoError(t, err)
				require.NoError(t, xEnv.NatsConnectionMyNats.Flush())
				t.Cleanup(func() { _ = sub.Unsubscribe() })
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employeeFromEventMyNats(employeeID: 12) { id details { forename } }}`})
				require.JSONEq(t, `{"data":{"employeeFromEventMyNats": {"id": 12, "details": {"forename": "David"}}}}`, res.Body)
				mf, err := promRegistry.Gather()
				require.NoError(t, err)
				family := findMetricFamilyByName(mf, "router_nats_request_total")
				require.NotNil(t, family)
				metrics := family.GetMetric()
				require.NotEmpty(t, metrics)
				eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
				subject := findMetricLabelByName(metrics, "wg_nats_subject")
				require.Equal(t, "my-nats", eventProvider.GetValue())
				require.True(t, strings.HasSuffix(subject.GetValue(), "getEmployeeMyNats.12"))
				require.Equal(t, float64(1), metrics[0].Counter.GetValue())
			})
		})

		t.Run("nats subscribe", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{
				TraceExporter:                      exporter,
				MetricReader:                       metricReader,
				PrometheusRegistry:                 promRegistry,
				RouterConfigJSONTemplate:           testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:                         true,
				ModifyEngineExecutionConfiguration: func(ec *config.EngineExecutionConfiguration) { ec.WebSocketClientReadTimeout = time.Second },
				MetricOptions:                      testenv.MetricOptions{EnablePrometheusEventMetrics: true},
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

				surl := xEnv.GraphQLWebSocketSubscriptionURL()
				client := graphql.NewSubscriptionClient(surl)

				subscriptionArgsCh := make(chan natsSubscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- natsSubscriptionArgs{
						dataValue: dataValue,
						errValue:  errValue,
					}
					return nil
				})
				require.NoError(t, err)
				require.NotEqual(t, "", subscriptionOneID)

				clientRunErrCh := make(chan error)
				go func() {
					clientErr := client.Run()
					clientRunErrCh <- clientErr
				}()

				xEnv.WaitForSubscriptionCount(1, events.NatsWaitTimeout)

				// Send a mutation to trigger the first subscription
				resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
				})
				require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, resOne.Body)

				testenv.AwaitChannelWithT(t, events.NatsWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
				})

				// Trigger the first subscription via NATS
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				testenv.AwaitChannelWithT(t, events.NatsWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, events.NatsWaitTimeout, clientRunErrCh, func(t *testing.T, err error) {
					require.NoError(t, err)
				}, "unable to close client before timeout")

				xEnv.WaitForSubscriptionCount(0, events.NatsWaitTimeout)
				xEnv.WaitForConnectionCount(0, events.NatsWaitTimeout)

				natsLogs := xEnv.Observer().FilterMessageSnippet("Nats").All()
				require.Len(t, natsLogs, 2)
				providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "my-nats")).All()
				require.Len(t, providerIDFields, 3)
				//
				//payload := []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id } }"}`)
				//client := http.Client{}
				//req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(payload))
				//resp, gErr := client.Do(req)
				//require.NoError(t, gErr)
				//require.Equal(t, http.StatusOK, resp.StatusCode)
				//defer resp.Body.Close()
				//reader := bufio.NewReader(resp.Body)
				//xEnv.WaitForSubscriptionCount(1, 30*time.Second)
				//require.NoError(t, xEnv.NatsConnectionMyNats.Publish(xEnv.GetPubSubName("employeeUpdatedMyNats.12"), []byte(`{"id":12,"__typename":"Employee"}`)))
				//require.NoError(t, xEnv.NatsConnectionMyNats.Flush())
				//_, _, _ = reader.ReadLine()
				//_, _, _ = reader.ReadLine()
				//_, _, _ = reader.ReadLine()
				//_, _, _ = reader.ReadLine()
				//_, _, _ = reader.ReadLine()

			})
		})
	})

	t.Run("redis", func(t *testing.T) {
		t.Run("publish", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()

			testenv.Run(t, &testenv.Config{TraceExporter: exporter, MetricReader: metricReader, PrometheusRegistry: promRegistry, RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate, EnableRedis: true, MetricOptions: testenv.MetricOptions{EnablePrometheusEventMetrics: true}}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r1"}) { success } }`})
				require.JSONEq(t, `{"data":{"updateEmployeeMyRedis":{"success":true}}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r2"}) { success } }`})
				require.JSONEq(t, `{"data":{"updateEmployeeMyRedis":{"success":true}}}`, res.Body)
				mf, err := promRegistry.Gather()
				require.NoError(t, err)
				family := findMetricFamilyByName(mf, "router_redis_publish_messages_total")
				require.NotNil(t, family)
				metrics := family.GetMetric()
				require.NotEmpty(t, metrics)
				eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
				channel := findMetricLabelByName(metrics, "wg_redis_channel")
				require.Equal(t, "my-redis", eventProvider.GetValue())
				require.True(t, strings.HasSuffix(channel.GetValue(), "employeeUpdatedMyRedis"))
				require.Equal(t, float64(2), metrics[0].Counter.GetValue())
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{TraceExporter: exporter, MetricReader: metricReader, PrometheusRegistry: promRegistry, RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate, EnableRedis: true, MetricOptions: testenv.MetricOptions{EnablePrometheusEventMetrics: true}}, func(t *testing.T, xEnv *testenv.Environment) {
				payload := []byte(`{"query":"subscription { employeeUpdatedMyRedis(id: 1) { id } }"}`)
				client := http.Client{}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(payload))
				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)
				xEnv.WaitForSubscriptionCount(1, 30*time.Second)
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 1, update: {name: "rr"}) { success } }`})
				require.JSONEq(t, `{"data":{"updateEmployeeMyRedis":{"success":true}}}`, res.Body)
				_, _, _ = reader.ReadLine()
				_, _, _ = reader.ReadLine()
				_, _, _ = reader.ReadLine()
				_, _, _ = reader.ReadLine()
				_, _, _ = reader.ReadLine()
				// Poll for metric family to appear
				var family *io_prometheus_client.MetricFamily
				deadline := time.Now().Add(5 * time.Second)
				for time.Now().Before(deadline) {
					mf, err := promRegistry.Gather()
					require.NoError(t, err)
					family = findMetricFamilyByName(mf, "router_redis_messages_received_total")
					if family != nil && len(family.GetMetric()) > 0 {
						break
					}
					time.Sleep(100 * time.Millisecond)
				}
				require.NotNil(t, family)
				metrics := family.GetMetric()
				require.NotEmpty(t, metrics)
				eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
				channel := findMetricLabelByName(metrics, "wg_redis_channel")
				require.Equal(t, "my-redis", eventProvider.GetValue())
				require.True(t, strings.HasSuffix(channel.GetValue(), "employeeUpdatedMyRedis"))
				require.Equal(t, float64(1), metrics[0].Counter.GetValue())
			})
		})
	})
}

// helpers reused from kafka test

type kafkaSubscriptionArgs struct {
	dataValue []byte
	errValue  error
}

const KafkaWaitTimeout = time.Second * 30
