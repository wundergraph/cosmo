package events_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/core"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
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
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			go func() {
				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, KafkaWaitTimeout, time.Millisecond*100)
				_ = client.Close()
			}()

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(1, KafkaWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				oldCount := counter.Load()
				counter.Add(1)

				if oldCount == 0 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Invalid message received", gqlErr[0].Message)
				} else if oldCount == 1 || oldCount == 3 {
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if oldCount == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.", gqlErr[0].Message)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], ``) // Empty message
			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, KafkaWaitTimeout, time.Millisecond*100)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, KafkaWaitTimeout, time.Millisecond*100)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			require.Eventually(t, func() bool {
				return counter.Load() == 3
			}, KafkaWaitTimeout, time.Millisecond*100)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, KafkaWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(2, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(2, KafkaWaitTimeout)

			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, KafkaWaitTimeout, time.Millisecond*100)

			_ = client.Close()

			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)

				require.NoError(t, errValue)

				employeeID := gjson.GetBytes(dataValue, "employeeUpdatedMyKafka.id").Int()

				if employeeID == 1 {
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if employeeID == 2 {
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(dataValue))
				} else {
					t.Errorf("unexpected employeeID %d", employeeID)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)

				require.NoError(t, errValue)

				employeeID := gjson.GetBytes(dataValue, "employeeUpdatedMyKafka.id").Int()

				if employeeID == 1 {
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if employeeID == 2 {
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(dataValue))
				} else {
					t.Errorf("unexpected employeeID %d", employeeID)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(2, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
			produceKafkaMessage(t, xEnv, topics[1], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, KafkaWaitTimeout, time.Millisecond*100, "expected 4 events, got %d", counter.Load())

			require.NoError(t, client.Close())

			xEnv.WaitForMessagesSent(4, KafkaWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			go func() {
				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, KafkaWaitTimeout, time.Millisecond*100)
				_ = client.Close()
			}()

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(1, KafkaWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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

				var started atomic.Bool
				var consumed atomic.Uint32
				var produced atomic.Uint32

				go func() {
					client := http.Client{
						Timeout: time.Second * 100,
					}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, gErr := client.Do(req)
					require.NoError(t, gErr)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()
					reader := bufio.NewReader(resp.Body)
					started.Store(true)

					assert.Eventually(t, func() bool {
						return produced.Load() == 1
					}, KafkaWaitTimeout, time.Millisecond*100)
					assertKafkaMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
					consumed.Add(1)

					assert.Eventually(t, func() bool {
						return produced.Load() == 2
					}, KafkaWaitTimeout, time.Millisecond*100)
					assertKafkaMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
					consumed.Add(1)
				}()

				xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

				assert.Eventually(t, started.Load, KafkaWaitTimeout, time.Millisecond*100)
				produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				produced.Add(1)

				assert.Eventually(t, func() bool {
					return consumed.Load() == 1
				}, KafkaWaitTimeout, time.Millisecond*100)
				produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				produced.Add(1)

				// Wait for the client to finish
				require.Eventually(t, func() bool { return consumed.Load() == 2 }, KafkaWaitTimeout*2, time.Millisecond*100)

				xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
				xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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

			var counter atomic.Uint32

			go func() {
				defer counter.Add(1)

				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
				require.NoError(t, gErr)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				eventNext, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, KafkaWaitTimeout, time.Millisecond*100)

			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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

			var counter atomic.Uint32

			go func() {
				defer counter.Add(1)

				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
				require.NoError(t, gErr)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				eventNext, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, KafkaWaitTimeout, time.Millisecond*100)

			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
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
						ID      float64 `graphql:"id"`
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

			var produced atomic.Uint32
			var consumed atomic.Uint32

			go func() {
				require.Eventually(t, func() bool {
					return produced.Load() == 1
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 2
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(2), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "Dustin", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Deus", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)
				consumed.Add(9) // should arrive to 10

				require.Eventually(t, func() bool {
					return produced.Load() == 11
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 12
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(12), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "David", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Stutt", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)
				consumed.Add(1)
			}()

			// Events 1, 2, 11, and 12 should be included
			for i := uint32(1); i < 13; i++ {
				require.Eventually(t, func() bool {
					return consumed.Load() >= i-1
				}, KafkaWaitTimeout, time.Millisecond*100)
				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				produced.Add(1)
			}

			require.Eventually(t, func() bool {
				return consumed.Load() == 12 && produced.Load() == 12
			}, KafkaWaitTimeout, time.Millisecond*100)
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
						ID      float64 `graphql:"id"`
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

			var produced atomic.Uint32
			var consumed atomic.Uint32

			go func() {
				require.Eventually(t, func() bool {
					return produced.Load() == 1
				}, 10*time.Second, 100*time.Millisecond)
				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 2
				}, 10*time.Second, 100*time.Millisecond)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(2), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "Dustin", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Deus", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
				consumed.Add(9) // should arrive to 10

				require.Eventually(t, func() bool {
					return produced.Load() == 11
				}, 10*time.Second, 100*time.Millisecond)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 12
				}, 10*time.Second, 100*time.Millisecond)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(12), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "David", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Stutt", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
				consumed.Add(1)
			}()

			// Events 1, 2, 11, and 12 should be included
			for i := uint32(1); i < 13; i++ {
				require.Eventually(t, func() bool {
					return consumed.Load() >= i-1
				}, KafkaWaitTimeout, time.Millisecond*100)
				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				produced.Add(1)
			}

			require.Eventually(t, func() bool {
				return consumed.Load() == 12 && produced.Load() == 12
			}, time.Second*20, time.Millisecond*100)
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
						ID      float64 `graphql:"id"`
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

			var counter atomic.Uint32

			go func() {
				defer counter.Add(1)

				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(12), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "David", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Stutt", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
			}()

			// The message should be ignored because "1" does not equal 1
			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":1}`)

			// Ensure the Kafka consumer can keep up with the provider
			time.Sleep(time.Millisecond * 100)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":12}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, KafkaWaitTimeout, time.Millisecond*100)
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
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				oldCount := counter.Load()
				counter.Add(1)

				if oldCount == 0 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Invalid message received", gqlErr[0].Message)
				} else if oldCount == 1 || oldCount == 3 {
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if oldCount == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.", gqlErr[0].Message)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			produceKafkaMessage(t, xEnv, topics[0], `{asas`) // Invalid message
			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, KafkaWaitTimeout, time.Millisecond*100)
			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":1}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, KafkaWaitTimeout, time.Millisecond*100)
			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			require.Eventually(t, func() bool {
				return counter.Load() == 3
			}, KafkaWaitTimeout, time.Millisecond*100)
			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, KafkaWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, KafkaWaitTimeout)
			xEnv.WaitForConnectionCount(0, KafkaWaitTimeout)
		})
	})
}

func TestFlakyKafkaEvents(t *testing.T) {
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
						ID      float64 `graphql:"id"`
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

			var produced atomic.Uint32
			var consumed atomic.Uint32
			const MsgCount = uint32(12)

			go func() {
				consumed.Add(1) // the first message is ignored

				require.Eventually(t, func() bool {
					return produced.Load() == MsgCount-11
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)
				consumed.Add(4) // should arrive to 5th message, with id 7

				require.Eventually(t, func() bool {
					return produced.Load() == MsgCount-7
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(7), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Suvij", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Surya", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)
				consumed.Add(3) // should arrive to 8th message, with id 4

				require.Eventually(t, func() bool {
					return produced.Load() == MsgCount-4
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(4), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Björn", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Schwenzer", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == MsgCount-3
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(3), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Stefan", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Avram", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)
				consumed.Add(2) // should arrive to 10th message, with id 2

				require.Eventually(t, func() bool {
					return produced.Load() == MsgCount-1
				}, KafkaWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)
				consumed.Add(1)
			}()

			// Events 1, 3, 4, 7, and 11 should be included
			for i := MsgCount; i > 0; i-- {
				require.Eventually(t, func() bool {
					return consumed.Load() >= MsgCount-i
				}, KafkaWaitTimeout, time.Millisecond*100)
				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
				produced.Add(1)
			}

			require.Eventually(t, func() bool {
				return consumed.Load() == MsgCount && produced.Load() == MsgCount
			}, KafkaWaitTimeout, time.Millisecond*100)
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

	var done atomic.Bool

	var pErr error

	xEnv.KafkaClient.Produce(ctx, &kgo.Record{
		Topic: xEnv.GetPubSubName(topicName),
		Value: []byte(message),
	}, func(record *kgo.Record, err error) {
		defer done.Store(true)
		if err != nil {
			pErr = err
		}
	})

	require.Eventually(t, func() bool {
		return done.Load()
	}, KafkaWaitTimeout, time.Millisecond*100)

	require.NoError(t, pErr)

	fErr := xEnv.KafkaClient.Flush(ctx)
	require.NoError(t, fErr)
}
