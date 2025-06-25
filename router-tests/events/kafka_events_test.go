package events_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/core"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const KafkaWaitTimeout = time.Second * 30

func assertKafkaLineEquals(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	line, _, err := reader.ReadLine()
	assert.NoError(t, err)
	assert.Equal(t, expected, string(line))
}

func assertKafkaMultipartPrefix(t *testing.T, reader *bufio.Reader) {
	t.Helper()
	assertKafkaLineEquals(t, reader, "")
	assertKafkaLineEquals(t, reader, "--graphql")
	assertKafkaLineEquals(t, reader, "Content-Type: application/json")
	assertKafkaLineEquals(t, reader, "")
}

func assertKafkaMultipartValueEventually(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	assert.Eventually(t, func() bool {
		assertKafkaMultipartPrefix(t, reader)
		line, _, err := reader.ReadLine()
		assert.NoError(t, err)
		if string(line) == "{}" {
			return false
		}
		assert.Equal(t, expected, string(line))
		return true
	}, KafkaWaitTimeout, time.Millisecond*100)
}

type kafkaSubscriptionArgs struct {
	dataValue []byte
	errValue  error
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], ``) // Empty message
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Invalid message received")
			})

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.")
			})

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

		})
	})

	t.Run("every subscriber gets the message", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(2, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(2, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			produceKafkaMessage(t, xEnv, topics[1], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
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
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 100
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("multipart", func(t *testing.T) {
		t.Parallel()

		multipartHeartbeatInterval := time.Second * 5

		t.Run("subscribe sync", func(t *testing.T) {
			t.Parallel()

			topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				RouterOptions: []core.Option{
					core.WithMultipartHeartbeatInterval(multipartHeartbeatInterval),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				ensureTopicExists(t, xEnv, topics...)

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

				xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

				produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				assertKafkaMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")

				produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				assertKafkaMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
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

				assertKafkaMultipartValueEventually(t, reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")

				xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
				xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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
			ensureTopicExists(t, xEnv, topics...)

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			client := http.Client{
				Timeout: time.Second * 10,
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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, responseCh, func(t *testing.T, response struct {
				response *http.Response
				err      error
			}) {
				require.NoError(t, response.err)
				require.Equal(t, http.StatusOK, response.response.StatusCode)
				reader := bufio.NewReader(response.response.Body)
				defer response.response.Body.Close()
				eventNext, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
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
			ensureTopicExists(t, xEnv, topics...)

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			client := http.Client{
				Timeout: time.Second * 10,
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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, responseCh, func(t *testing.T, resp struct {
				response *http.Response
				err      error
			}) {
				require.NoError(t, resp.err)
				require.Equal(t, http.StatusOK, resp.response.StatusCode)
				defer resp.response.Body.Close()
				reader := bufio.NewReader(resp.response.Body)

				eventNext, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
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
				Timeout: time.Second * 10,
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

			eventNext, _, err := reader.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "event: next", string(eventNext))
			data, _, err := reader.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", string(data))

			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
		})
	})

	t.Run("subscribe async with filter and multiple list field arguments", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

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
			for i := uint32(1); i < 13; i++ {
				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				if i == 1 || i == 2 || i == 11 || i == 12 {
					conn.SetReadDeadline(time.Now().Add(KafkaWaitTimeout))
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

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
			for i := uint32(1); i < 13; i++ {
				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				if i == 1 || i == 2 || i == 11 || i == 12 {
					conn.SetReadDeadline(time.Now().Add(KafkaWaitTimeout))
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			// The message should be ignored because "1" does not equal 1
			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":1}`)

			// This message should be delivered because it matches the filter
			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":12}`)
			conn.SetReadDeadline(time.Now().Add(KafkaWaitTimeout))
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{asas`) // Invalid message
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Invalid message received")
			})

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":1}`) // Correct message
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.")
			})

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
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
			ensureTopicExists(t, xEnv, topics...)

			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, resOne.Body)

			records, err := readKafkaMessages(xEnv, topics[0], 1)
			require.NoError(t, err)
			require.Equal(t, 1, len(records))
			require.Equal(t, `{"employeeID":3,"update":{"name":"name test"}}`, string(records[0].Value))
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
			ensureTopicExists(t, xEnv, topics...)

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

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
				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				if i == 1 || i == 3 || i == 4 || i == 7 || i == 11 {
					conn.SetReadDeadline(time.Now().Add(KafkaWaitTimeout))
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
}

func ensureTopicExists(t *testing.T, xEnv *testenv.Environment, topics ...string) {
	// Delete topic for idempotency
	deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	prefixedTopics := make([]string, len(topics))
	for _, topic := range topics {
		prefixedTopics = append(prefixedTopics, xEnv.GetPubSubName(topic))
	}

	_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, prefixedTopics...)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = xEnv.KafkaAdminClient.CreateTopics(ctx, 1, 1, nil, prefixedTopics...)
	require.NoError(t, err)
}

func produceKafkaMessage(t *testing.T, xEnv *testenv.Environment, topicName string, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pErrCh := make(chan error)

	xEnv.KafkaClient.Produce(ctx, &kgo.Record{
		Topic: xEnv.GetPubSubName(topicName),
		Value: []byte(message),
	}, func(record *kgo.Record, err error) {
		pErrCh <- err
	})

	testenv.AwaitChannelWithT(t, KafkaWaitTimeout, pErrCh, func(t *testing.T, pErr error) {
		require.NoError(t, pErr)
	})

	fErr := xEnv.KafkaClient.Flush(ctx)
	require.NoError(t, fErr)
}

func readKafkaMessages(xEnv *testenv.Environment, topicName string, msgs int) ([]*kgo.Record, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := kgo.NewClient(
		kgo.SeedBrokers(xEnv.GetKafkaSeeds()...),
		kgo.ConsumeTopics(xEnv.GetPubSubName(topicName)),
	)
	if err != nil {
		return nil, err
	}

	fetchs := client.PollRecords(ctx, msgs)

	return fetchs.Records(), nil
}
