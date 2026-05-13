package events_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

type kafkaSubscriptionArgs struct {
	dataValue []byte
	errValue  error
}

func overrideKafkaTopicsForField(t *testing.T, routerConfig *nodev1.RouterConfig, fieldName string, currentTopics []string, topics ...string) {
	t.Helper()

	require.NotNil(t, routerConfig)
	require.NotNil(t, routerConfig.EngineConfig)

	for _, dataSourceConfig := range routerConfig.EngineConfig.GetDatasourceConfigurations() {
		customEvents := dataSourceConfig.GetCustomEvents()
		if customEvents == nil {
			continue
		}
		for _, kafkaEvent := range customEvents.GetKafka() {
			engineEventConfiguration := kafkaEvent.GetEngineEventConfiguration()
			if engineEventConfiguration == nil || engineEventConfiguration.GetFieldName() != fieldName {
				continue
			}

			require.NotEmpty(t, currentTopics)
			require.Len(t, kafkaEvent.Topics, len(currentTopics))
			for i := range currentTopics {
				require.True(t, strings.HasSuffix(kafkaEvent.Topics[i], currentTopics[i]))
			}

			prefix := strings.TrimSuffix(kafkaEvent.Topics[0], currentTopics[0])
			prefixedTopics := make([]string, 0, len(topics))
			for _, topic := range topics {
				prefixedTopics = append(prefixedTopics, prefix+topic)
			}
			kafkaEvent.Topics = prefixedTopics
			return
		}
	}

	t.Fatalf("unable to find kafka custom event for field %q", fieldName)
}

func TestKafkaEvents(t *testing.T) {
	t.Parallel()
	// All tests are running in sequence because they are using the same kafka topic

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			// Wait for the subscription to be registered and a trigger to be created in the engine.
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Publish with retry: the first message may be lost because the Kafka consumer
			// group hasn't finished rebalancing yet. KafkaPublishUntilReceived retries
			// until the engine's MessagesSent counter increments.
			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("subscribe async with topic template override", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated.2", "employeeUpdatedTwo.2"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				overrideKafkaTopicsForField(t, routerConfig, "employeeUpdatedMyKafka",
					[]string{"employeeUpdated", "employeeUpdatedTwo"},
					"employeeUpdated.{{ args.employeeID }}",
					"employeeUpdatedTwo.{{ args.employeeID }}",
				)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 2)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[1], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("message and resolve errors should not abort the subscription", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm up: confirm consumer has partition assignment with a valid message
			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], ``) // Empty message
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Invalid message received")
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.")
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("subscribe to multiple topics through a single directive", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionOneArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionTwoArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			xEnv.KafkaPublishUntilReceived(topics[1], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`, 2, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("multipart", func(t *testing.T) {
		t.Parallel()

		subscriptionHeartbeatInterval := time.Second * 5

		t.Run("subscribe sync", func(t *testing.T) {
			t.Parallel()

			topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				RouterOptions: []core.Option{
					core.WithSubscriptionHeartbeatInterval(subscriptionHeartbeatInterval),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

				subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

				client := http.Client{
					Timeout: time.Second * 100,
				}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")

				events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
			})
		})

		t.Run("Should block subscribe sync operation", func(t *testing.T) {
			t.Parallel()

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				client := http.Client{
					Timeout: time.Second * 100,
				}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)

				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				assertMultipartValueEventually(t, reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")

				xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
				xEnv.WaitForConnectionCount(0, EventWaitTimeout)
			})
		})
	})

	t.Run("subscribe sync sse legacy method works", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			client := http.Client{
				Timeout: time.Second * 30,
			}
			req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, gErr)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			responseCh := make(chan struct {
				response *http.Response
				err      error
			})

			go func() {
				resp, gErr := client.Do(req)
				responseCh <- struct {
					response *http.Response
					err      error
				}{
					response: resp,
					err:      gErr,
				}
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, responseCh, func(t *testing.T, response struct {
				response *http.Response
				err      error
			},
			) {
				require.NoError(t, response.err)
				require.Equal(t, http.StatusOK, response.response.StatusCode)
				reader := bufio.NewReader(response.response.Body)
				defer response.response.Body.Close()
				eventNext := testenv.ReadSSEField(t, reader)
				require.Equal(t, "event: next", eventNext)
				data := testenv.ReadSSEField(t, reader)
				require.Equal(t, "data: {\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", data)
			})
		})
	})

	t.Run("subscribe sync sse", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			client := http.Client{
				Timeout: time.Second * 30,
			}
			req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, gErr)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			responseCh := make(chan struct {
				response *http.Response
				err      error
			})

			go func() {
				resp, gErr := client.Do(req)
				responseCh <- struct {
					response *http.Response
					err      error
				}{
					response: resp,
					err:      gErr,
				}
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, responseCh, func(t *testing.T, resp struct {
				response *http.Response
				err      error
			},
			) {
				require.NoError(t, resp.err)
				require.Equal(t, http.StatusOK, resp.response.StatusCode)
				defer resp.response.Body.Close()
				reader := bufio.NewReader(resp.response.Body)

				eventNext := testenv.ReadSSEField(t, reader)
				require.Equal(t, "event: next", eventNext)
				data := testenv.ReadSSEField(t, reader)
				require.Equal(t, "data: {\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", data)
			})
		})
	})

	t.Run("should block subscribe sync sse operation", func(t *testing.T) {
		t.Parallel()

		subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			client := http.Client{
				Timeout: time.Second * 30,
			}
			req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, err)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			resp, err := client.Do(req)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, resp.StatusCode)

			defer resp.Body.Close()
			reader := bufio.NewReader(resp.Body)

			eventNext := testenv.ReadSSELine(t, reader)
			require.Equal(t, "event: next", eventNext)
			data := testenv.ReadSSELine(t, reader)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", data)

			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
			xEnv.WaitForConnectionCount(0, EventWaitTimeout)
		})
	})

	t.Run("subscribe async with filter and multiple list field arguments", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			type subscriptionPayload struct {
				Data struct {
					FilteredEmployeeUpdatedMyKafkaWithListFieldArguments struct {
						ID      int `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"filteredEmployeeUpdatedMyKafkaWithListFieldArguments(firstIds: [1, 12], secondIds: [2, 11]))"`
				} `json:"data"`
			}

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { filteredEmployeeUpdatedMyKafkaWithListFieldArguments(firstIds: [1, 12], secondIds: [2, 11]) { id details { forename, surname } } }"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			testData := map[uint32]struct {
				ID       int
				Forename string
				Surname  string
			}{
				1:  {1, "Jens", "Neuse"},
				2:  {2, "Dustin", "Deus"},
				11: {11, "Alexandra", "Neuse"},
				12: {12, "David", "Stutt"},
			}

			// Events 1, 2, 11, and 12 should be included
			expectedMessages := uint64(0)
			for i := uint32(1); i < 13; i++ {
				if i == 1 {
					xEnv.KafkaPublishUntilReceived(topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i), 1, EventWaitTimeout)
				} else {
					events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				}
				if i == 1 || i == 2 || i == 11 || i == 12 {
					expectedMessages++
					xEnv.WaitForMessagesSent(expectedMessages, EventWaitTimeout)
					conn.SetReadDeadline(time.Now().Add(5 * time.Second))
					gErr := conn.ReadJSON(&msg)
					require.NoError(t, gErr)
					require.Equal(t, "1", msg.ID)
					require.Equal(t, "next", msg.Type)
					gErr = json.Unmarshal(msg.Payload, &payload)
					require.NoError(t, gErr)
					require.Equal(t, testData[i].ID, payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
					require.Equal(t, testData[i].Forename, payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
					require.Equal(t, testData[i].Surname, payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)
				}
			}
		})
	})

	t.Run("subscribe async with filter and nested list argument", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			type subscriptionPayload struct {
				Data struct {
					FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument struct {
						ID      int `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"filteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument(input: { ids: [1, 2, 11, 12] }))"`
				} `json:"data"`
			}

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { filteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument(input: { ids: [1, 2, 11, 12] }) { id details { forename, surname } } }"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			testData := map[uint32]struct {
				ID       int
				Forename string
				Surname  string
			}{
				1:  {1, "Jens", "Neuse"},
				2:  {2, "Dustin", "Deus"},
				11: {11, "Alexandra", "Neuse"},
				12: {12, "David", "Stutt"},
			}

			// Events 1, 2, 11, and 12 should be included
			expectedMessages := uint64(0)
			for i := uint32(1); i < 13; i++ {
				if i == 1 {
					xEnv.KafkaPublishUntilReceived(topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i), 1, EventWaitTimeout)
				} else {
					events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				}
				if i == 1 || i == 2 || i == 11 || i == 12 {
					expectedMessages++
					xEnv.WaitForMessagesSent(expectedMessages, EventWaitTimeout)
					conn.SetReadDeadline(time.Now().Add(5 * time.Second))
					gErr := conn.ReadJSON(&msg)
					require.NoError(t, gErr)
					require.Equal(t, "1", msg.ID)
					require.Equal(t, "next", msg.Type)
					gErr = json.Unmarshal(msg.Payload, &payload)
					require.NoError(t, gErr)
					require.Equal(t, testData[i].ID, payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
					require.Equal(t, testData[i].Forename, payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
					require.Equal(t, testData[i].Surname, payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
				}
			}
		})
	})

	t.Run("subscribe async with filter non-matching filter and nested list argument", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			type subscriptionPayload struct {
				Data struct {
					FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument struct {
						ID      int `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"filteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument(input: { ids: [12] }))"`
				} `json:"data"`
			}

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { filteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument(input: { ids: [12] }) { id details { forename, surname } } }"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// The message should be ignored because "1" does not equal 1
			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","id":1}`)

			// This message should be delivered because it matches the filter
			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id":12}`, 1, EventWaitTimeout)
			conn.SetReadDeadline(time.Now().Add(EventWaitTimeout))
			readErr := conn.ReadJSON(&msg)
			require.NoError(t, readErr)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			unmarshalErr := json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, unmarshalErr)
			require.Equal(t, int(12), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
			require.Equal(t, "David", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
			require.Equal(t, "Stutt", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
		})
	})

	t.Run("message with invalid JSON should give a specific error", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionOneArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm up: confirm consumer has partition assignment with a valid message
			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id":1}`, 1, EventWaitTimeout)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{asas`) // Invalid message
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Invalid message received")
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","id":1}`) // Correct message
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.")
			})

			events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("mutate", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, resOne.Body)

			records, err := events.ReadKafkaMessages(xEnv, EventWaitTimeout, topics[0], 1)
			require.NoError(t, err)
			require.Equal(t, 1, len(records))
			require.Equal(t, `{"employeeID":3,"update":{"name":"name test"}}`, string(records[0].Value))
		})
	})

	t.Run("mutate with topic template override", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated.3"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				overrideKafkaTopicsForField(t, routerConfig, "updateEmployeeMyKafka", []string{"employeeUpdated"}, "employeeUpdated.{{ args.employeeID }}")
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, resOne.Body)

			records, err := events.ReadKafkaMessages(xEnv, EventWaitTimeout, topics[0], 1)
			require.NoError(t, err)
			require.Len(t, records, 1)
			require.Equal(t, `{"employeeID":3,"update":{"name":"name test"}}`, string(records[0].Value))
		})
	})

	t.Run("mutate returns correct typename", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { __typename success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"__typename":"edfs__PublishResult","success":true}}}`, resOne.Body)
		})
	})

	t.Run("kafka startup and shutdown with wrong broker should not stop router from starting indefinitely", func(t *testing.T) {
		t.Parallel()

		listener := testenv.NewWaitingListener(t, time.Second*10)
		listener.Start()
		defer listener.Close()

		// kafka client is lazy and will not connect to the broker until the first message is produced
		// so the router will start even if the kafka connection fails
		errRouter := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			ModifyEventsConfiguration: func(config *config.EventsConfiguration) {
				for i := range config.Providers.Kafka {
					config.Providers.Kafka[i].Brokers = []string{"localhost:" + strconv.Itoa(listener.Port())}
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Log("should be called")
		})

		assert.NoError(t, errRouter)
	})

	t.Run("subscribe async with filter", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			type subscriptionPayload struct {
				Data struct {
					FilteredEmployeeUpdatedMyKafka struct {
						ID      int `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"filteredEmployeeUpdatedMyKafka(employeeID: 1)"`
				} `json:"data"`
			}

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { filteredEmployeeUpdatedMyKafka(employeeID: 1) { id details { forename, surname } } }"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			const MsgCount = uint32(12)

			testData := map[int]struct {
				ID       int
				Forename string
				Surname  string
			}{
				1:  {1, "Jens", "Neuse"},
				3:  {3, "Stefan", "Avram"},
				4:  {4, "Björn", "Schwenzer"},
				7:  {7, "Suvij", "Surya"},
				11: {11, "Alexandra", "Neuse"},
			}

			// Events 1, 3, 4, 7, and 11 should be included
			for i := int(MsgCount); i > 0; i-- {
				if i == 11 {
					xEnv.KafkaPublishUntilReceived(topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i), 1, EventWaitTimeout)
				} else {
					events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				}
				if i == 1 || i == 3 || i == 4 || i == 7 || i == 11 {
					conn.SetReadDeadline(time.Now().Add(EventWaitTimeout))
					jsonErr := conn.ReadJSON(&msg)
					require.NoError(t, jsonErr)
					require.Equal(t, "1", msg.ID)
					require.Equal(t, "next", msg.Type)
					unmarshalErr := json.Unmarshal(msg.Payload, &payload)
					require.NoError(t, unmarshalErr)
					require.Equal(t, testData[i].ID, payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
					require.Equal(t, testData[i].Forename, payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
					require.Equal(t, testData[i].Surname, payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)
				}
			}
		})
	})

	t.Run("every subscriber gets the message", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionOneArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionTwoArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("subscribe async netPoll disabled", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableNetPoll = false
				engineExecutionConfiguration.WebSocketServerReadTimeout = time.Millisecond * 100
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionOneArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})
}
