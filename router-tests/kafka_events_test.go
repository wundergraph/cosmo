package integration_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/kafka"
	"github.com/tidwall/gjson"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestLocalKafka(t *testing.T) {
	t.Skip("skip only for local testing")

	t.Run("subscribe async", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// ensureTopicExists(t, xEnv, "employeeUpdated", "employeeUpdatedTwo")
			produceKafkaMessage(t, xEnv, "employeeUpdatedTwo", `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`)
		})
	})
}

func TestKafkaEvents(t *testing.T) {
	// All tests are running in sequence because they are using the same kafka topic

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	var (
		kafkaContainer *kafka.KafkaContainer
		err            error
	)

	ctx := context.Background()
	require.Eventually(t, func() bool {
		// when using Docker Desktop on Mac, it's possible that it takes 2 attempts to get the network port of the container
		// I've debugged this extensively and the issue is not with the testcontainers-go library, but with the Docker Desktop
		// Error message: container logs (port not found)
		// This is an internal issue coming from the Docker pkg
		// It seems like Docker Desktop on Mac is not always capable of providing a port mapping
		// The solution is to retry the container creation until we get the network port
		// Please don't try to improve this code as this workaround allows running the tests without any issues
		kafkaContainer, err = kafka.RunContainer(ctx,
			testcontainers.WithImage("confluentinc/confluent-local:7.6.1"),
			testcontainers.WithWaitStrategyAndDeadline(time.Second*30, wait.ForListeningPort("9093/tcp")),
		)
		return err == nil && kafkaContainer != nil
	}, time.Second*30, time.Second)

	require.NoError(t, kafkaContainer.Start(ctx))

	seeds, err := kafkaContainer.Brokers(ctx)
	require.NoError(t, err)

	t.Cleanup(func() {
		require.NoError(t, kafkaContainer.Terminate(ctx))
	})

	t.Run("subscribe async", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(1)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
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
				wg.Wait()
				_ = client.Close()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(1, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("message and resolve errors should not abort the subscription", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(4)

			count := 0

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()

				if count == 0 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Internal server error", gqlErr[0].Message)
				} else if count == 1 || count == 3 {
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if count == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdatedMyKafka.id'.", gqlErr[0].Message)
				}

				count++

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], ``) // Empty message
			xEnv.WaitForMessagesSent(1, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			xEnv.WaitForMessagesSent(2, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			xEnv.WaitForMessagesSent(3, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			xEnv.WaitForMessagesSent(4, time.Second*10)

			wg.Wait()

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("every subscriber gets the message", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			wg := &sync.WaitGroup{}
			wg.Add(2)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
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

			xEnv.WaitForSubscriptionCount(2, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(2, time.Second*10)

			wg.Wait()

			_ = client.Close()

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe to multiple topics through a single directive", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(4)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()

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
				defer wg.Done()

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

			xEnv.WaitForSubscriptionCount(2, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
			produceKafkaMessage(t, xEnv, topics[1], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`)

			wg.Wait()

			require.NoError(t, client.Close())

			xEnv.WaitForMessagesSent(4, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe async epoll/kqueue disabled", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableWebSocketEpollKqueue = false
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 100
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

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(1)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
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
				wg.Wait()
				_ = client.Close()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(1, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("multipart", func(t *testing.T) {
		assertLineEquals := func(reader *bufio.Reader, expected string) {
			line, _, err := reader.ReadLine()
			require.NoError(t, err)
			require.Equal(t, expected, string(line))
		}

		assertMultipartPrefix := func(reader *bufio.Reader) {
			assertLineEquals(reader, "--graphql")
			assertLineEquals(reader, "Content-Type: application/json")
			assertLineEquals(reader, "")
		}

		heartbeatInterval := 7 * time.Second

		t.Run("subscribe sync", func(t *testing.T) {
			topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

			testenv.Run(t, &testenv.Config{
				KafkaSeeds: seeds,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				ensureTopicExists(t, xEnv, topics...)

				subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

				wg := &sync.WaitGroup{}
				wg.Add(1)

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

					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"employeeUpdatedMyKafka\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
					wg.Done()
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*5)

				produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				time.Sleep(heartbeatInterval)
				produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

				wg.Wait()

				xEnv.WaitForSubscriptionCount(0, time.Second*10)
				xEnv.WaitForConnectionCount(0, time.Second*10)
			})
		})

		t.Run("subscribe sync with block", func(t *testing.T) {
			t.Parallel()

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			testenv.Run(t, &testenv.Config{
				KafkaSeeds: seeds,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = true
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

				assertMultipartPrefix(reader)
				assertLineEquals(reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")

				xEnv.WaitForSubscriptionCount(0, time.Second*10)
				xEnv.WaitForConnectionCount(0, time.Second*10)
			})
		})
	})

	t.Run("subscribe sync sse legacy method works", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			ensureTopicExists(t, xEnv, topics...)

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayload))
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

				wg.Done()

			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			wg.Wait()

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe sync sse", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			ensureTopicExists(t, xEnv, topics...)

			subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
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

				wg.Done()

			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			produceKafkaMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			wg.Wait()

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe sync sse with block", func(t *testing.T) {
		t.Parallel()

		subscribePayload := []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}"}`)

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockSubscriptions = true
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

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe async with filter", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				defer wg.Done()

				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(7), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Suvij", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Surya", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(4), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Björn", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Schwenzer", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(3), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Stefan", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Avram", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyKafka.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafka.Details.Surname)

			}()

			// Events 1, 3, 4, 7, and 11 should be included
			for i := 12; i > 0; i-- {
				// Ensure the Kafka consumer can keep up with the provider
				time.Sleep(time.Millisecond * 100)

				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
			}

			wg.Wait()
		})
	})

	t.Run("subscribe async with filter and multiple list field arguments", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				defer wg.Done()

				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(2), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "Dustin", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Deus", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(12), payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.ID)
				require.Equal(t, "David", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Forename)
				require.Equal(t, "Stutt", payload.Data.FilteredEmployeeUpdatedMyKafkaWithListFieldArguments.Details.Surname)
			}()

			// Events 1, 2, 11, and 12 should be included
			for i := 1; i < 13; i++ {
				// Ensure the Kafka consumer can keep up with the provider
				time.Sleep(time.Millisecond * 100)

				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
			}

			wg.Wait()
		})
	})

	t.Run("subscribe async with filter and nested list argument", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				defer wg.Done()

				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(2), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "Dustin", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Deus", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(12), payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.ID)
				require.Equal(t, "David", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Forename)
				require.Equal(t, "Stutt", payload.Data.FilteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument.Details.Surname)
			}()

			// Events 1, 2, 11, and 12 should be included
			for i := 1; i < 13; i++ {
				// Ensure the Kafka consumer can keep up with the provider
				time.Sleep(time.Millisecond * 100)

				produceKafkaMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
			}

			wg.Wait()
		})
	})

	t.Run("subscribe async with filter non-matching filter and nested list argument", func(t *testing.T) {

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			KafkaSeeds: seeds,
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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				defer wg.Done()

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

			wg.Wait()
		})
	})
}

func ensureTopicExists(t *testing.T, xEnv *testenv.Environment, topics ...string) {
	// Delete topic for idempotency

	deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, topics...)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = xEnv.KafkaAdminClient.CreateTopics(ctx, 1, 1, nil, topics...)
	require.NoError(t, err)
}

func produceKafkaMessage(t *testing.T, xEnv *testenv.Environment, topicName string, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)

	var pErr error

	xEnv.KafkaClient.Produce(ctx, &kgo.Record{
		Topic: topicName,
		Value: []byte(message),
	}, func(record *kgo.Record, err error) {
		defer wg.Done()
		if err != nil {
			pErr = err
		}
	})

	wg.Wait()

	require.NoError(t, pErr)
}
