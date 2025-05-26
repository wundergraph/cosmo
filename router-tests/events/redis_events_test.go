package events_test

import (
	"bufio"
	"bytes"
	"context"
	"net/http"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/core"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const RedisWaitTimeout = time.Second * 30

func TestRedisEvents(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
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
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
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
				}, RedisWaitTimeout, time.Millisecond*100)
				_ = client.Close()
			}()

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(1, RedisWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("message and resolve errors should not abort the subscription", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
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
					require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if oldCount == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdates.id'.", gqlErr[0].Message)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], ``) // Empty message
			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, RedisWaitTimeout, time.Millisecond*100)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, RedisWaitTimeout, time.Millisecond*100)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			require.Eventually(t, func() bool {
				return counter.Load() == 3
			}, RedisWaitTimeout, time.Millisecond*100)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, RedisWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("every subscriber gets the message", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(2, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(2, RedisWaitTimeout)

			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, RedisWaitTimeout, time.Millisecond*100)

			_ = client.Close()

			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("subscribe to multiple topics through a single directive", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
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

				employeeID := gjson.GetBytes(dataValue, "employeeUpdates.id").Int()

				if employeeID == 1 {
					require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if employeeID == 2 {
					require.JSONEq(t, `{"employeeUpdates":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(dataValue))
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

				employeeID := gjson.GetBytes(dataValue, "employeeUpdates.id").Int()

				if employeeID == 1 {
					require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if employeeID == 2 {
					require.JSONEq(t, `{"employeeUpdates":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(dataValue))
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

			xEnv.WaitForSubscriptionCount(2, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, RedisWaitTimeout, time.Millisecond*100, "expected 4 events, got %d", counter.Load())

			require.NoError(t, client.Close())

			xEnv.WaitForMessagesSent(4, RedisWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("subscribe async netPoll disabled", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableNetPoll = false
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 100
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
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
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
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
				}, RedisWaitTimeout, time.Millisecond*100)
				_ = client.Close()
			}()

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			xEnv.WaitForMessagesSent(1, RedisWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("multipart", func(t *testing.T) {
		t.Parallel()

		multipartHeartbeatInterval := time.Second * 5

		t.Run("subscribe sync", func(t *testing.T) {
			t.Parallel()

			topics := []string{"employeeUpdatedMyRedis"}

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				RouterOptions: []core.Option{
					core.WithMultipartHeartbeatInterval(multipartHeartbeatInterval),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdates { id details { forename surname } }}"}`)

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
					}, RedisWaitTimeout, time.Millisecond*100)
					assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
					consumed.Add(1)

					assert.Eventually(t, func() bool {
						return produced.Load() == 2
					}, RedisWaitTimeout, time.Millisecond*100)
					assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
					consumed.Add(1)
				}()

				xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

				assert.Eventually(t, started.Load, RedisWaitTimeout, time.Millisecond*100)
				produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				produced.Add(1)

				assert.Eventually(t, func() bool {
					return consumed.Load() == 1
				}, RedisWaitTimeout, time.Millisecond*100)
				produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				produced.Add(1)

				// Wait for the client to finish
				require.Eventually(t, func() bool { return consumed.Load() == 2 }, RedisWaitTimeout*2, time.Millisecond*100)

				xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
				xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
			})
		})

		t.Run("Should block subscribe sync operation", func(t *testing.T) {
			t.Parallel()

			subscribePayload := []byte(`{"query":"subscription { employeeUpdates { id details { forename surname } }}"}`)

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
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

				xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
				xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
			})
		})
	})

	t.Run("subscribe sync sse legacy method works", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdates { id details { forename surname } }}"}`)

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
				require.Equal(t, "data: {\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, RedisWaitTimeout, time.Millisecond*100)

			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("subscribe sync sse", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdates { id details { forename surname } }}"}`)

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
				require.Equal(t, "data: {\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, RedisWaitTimeout, time.Millisecond*100)

			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("should block subscribe sync sse operation", func(t *testing.T) {
		t.Parallel()

		subscribePayload := []byte(`{"query":"subscription { employeeUpdates { id details { forename surname } }}"}`)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
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

			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("subscribe async with filter", func(t *testing.T) {
		t.Parallel()

		// topics := []string{"employeeUpdatedMyRedis"}

		// testenv.Run(t, &testenv.Config{
		// 	RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
		// 	EnableRedis:              true,
		// }, func(t *testing.T, xEnv *testenv.Environment) {

		// 	type subscriptionPayload struct {
		// 		Data struct {
		// 			FilteredEmployeeUpdatedMyRedis struct {
		// 				ID      float64 `graphql:"id"`
		// 				Details struct {
		// 					Forename string `graphql:"forename"`
		// 					Surname  string `graphql:"surname"`
		// 				} `graphql:"details"`
		// 			} `graphql:"filteredEmployeeUpdatedMyRedis(employeeID: 1)"`
		// 		} `json:"data"`
		// 	}

		// 	// conn.Close() is called in a cleanup defined in the function
		// 	conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
		// 	err := conn.WriteJSON(&testenv.WebSocketMessage{
		// 		ID:      "1",
		// 		Type:    "subscribe",
		// 		Payload: []byte(`{"query":"subscription { filteredEmployeeUpdatedMyRedis(employeeID: 1) { id details { forename, surname } } }"}`),
		// 	})

		// 	require.NoError(t, err)
		// 	var msg testenv.WebSocketMessage
		// 	var payload subscriptionPayload

		// 	xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

		// 	var produced atomic.Uint32
		// 	var consumed atomic.Uint32
		// 	const MsgCount = uint32(12)

		// 	go func() {
		// 		consumed.Add(1) // the first message is ignored

		// 		require.Eventually(t, func() bool {
		// 			return produced.Load() == MsgCount-11
		// 		}, RedisWaitTimeout, time.Millisecond*100)
		// 		gErr := conn.ReadJSON(&msg)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, "1", msg.ID)
		// 		require.Equal(t, "next", msg.Type)
		// 		gErr = json.Unmarshal(msg.Payload, &payload)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdatedMyRedis.ID)
		// 		require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Forename)
		// 		require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Surname)
		// 		consumed.Add(4) // should arrive to 5th message, with id 7

		// 		require.Eventually(t, func() bool {
		// 			return produced.Load() == MsgCount-7
		// 		}, RedisWaitTimeout, time.Millisecond*100)
		// 		gErr = conn.ReadJSON(&msg)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, "1", msg.ID)
		// 		require.Equal(t, "next", msg.Type)
		// 		gErr = json.Unmarshal(msg.Payload, &payload)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, float64(7), payload.Data.FilteredEmployeeUpdatedMyRedis.ID)
		// 		require.Equal(t, "Suvij", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Forename)
		// 		require.Equal(t, "Surya", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Surname)
		// 		consumed.Add(3) // should arrive to 8th message, with id 4

		// 		require.Eventually(t, func() bool {
		// 			return produced.Load() == MsgCount-4
		// 		}, RedisWaitTimeout, time.Millisecond*100)
		// 		gErr = conn.ReadJSON(&msg)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, "1", msg.ID)
		// 		require.Equal(t, "next", msg.Type)
		// 		gErr = json.Unmarshal(msg.Payload, &payload)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, float64(4), payload.Data.FilteredEmployeeUpdatedMyRedis.ID)
		// 		require.Equal(t, "Björn", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Forename)
		// 		require.Equal(t, "Schwenzer", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Surname)
		// 		consumed.Add(1)

		// 		require.Eventually(t, func() bool {
		// 			return produced.Load() == MsgCount-3
		// 		}, RedisWaitTimeout, time.Millisecond*100)
		// 		gErr = conn.ReadJSON(&msg)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, "1", msg.ID)
		// 		require.Equal(t, "next", msg.Type)
		// 		gErr = json.Unmarshal(msg.Payload, &payload)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, float64(3), payload.Data.FilteredEmployeeUpdatedMyRedis.ID)
		// 		require.Equal(t, "Stefan", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Forename)
		// 		require.Equal(t, "Avram", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Surname)
		// 		consumed.Add(2) // should arrive to 10th message, with id 2

		// 		require.Eventually(t, func() bool {
		// 			return produced.Load() == MsgCount-1
		// 		}, RedisWaitTimeout, time.Millisecond*100)
		// 		gErr = conn.ReadJSON(&msg)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, "1", msg.ID)
		// 		require.Equal(t, "next", msg.Type)
		// 		gErr = json.Unmarshal(msg.Payload, &payload)
		// 		require.NoError(t, gErr)
		// 		require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdatedMyRedis.ID)
		// 		require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Forename)
		// 		require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Surname)
		// 		consumed.Add(1)
		// 	}()

		// 	// Events 1, 3, 4, 7, and 11 should be included
		// 	for i := MsgCount; i > 0; i-- {
		// 		require.Eventually(t, func() bool {
		// 			return consumed.Load() >= MsgCount-i
		// 		}, RedisWaitTimeout, time.Millisecond*100)
		// 		produceRedisMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))
		// 		produced.Add(1)
		// 	}

		// 	require.Eventually(t, func() bool {
		// 		return consumed.Load() == MsgCount && produced.Load() == MsgCount
		// 	}, RedisWaitTimeout, time.Millisecond*100)
		// })
	})

	t.Run("message with invalid JSON should give a specific error", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
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
					require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				} else if oldCount == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdates.id'.", gqlErr[0].Message)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			produceRedisMessage(t, xEnv, topics[0], `{asas`) // Invalid message
			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, RedisWaitTimeout, time.Millisecond*100)
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":1}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, RedisWaitTimeout, time.Millisecond*100)
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`) // Missing entity = Resolver error
			require.Eventually(t, func() bool {
				return counter.Load() == 3
			}, RedisWaitTimeout, time.Millisecond*100)
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, RedisWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, RedisWaitTimeout)
			xEnv.WaitForConnectionCount(0, RedisWaitTimeout)
		})
	})

	t.Run("mutate", func(t *testing.T) {
		t.Parallel()

		channels := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			NoRetryClient:            true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var msgCh <-chan *redis.Message
			var started atomic.Bool
			go func() {
				var err error
				msgCh, err = readRedisMessages(t, xEnv, channels[0])
				started.Store(true)
				require.NoError(t, err)
			}()
			require.Eventually(t, started.Load, RedisWaitTimeout, time.Millisecond*100)
			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyRedis":{"success":true}}}`, resOne.Body)
			m := <-msgCh
			require.Equal(t, `{"id":3,"update":{"name":"name test"}}`, m.Payload)
		})
	})
}

func produceRedisMessage(t *testing.T, xEnv *testenv.Environment, topicName string, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	parsedURL, err := url.Parse(xEnv.RedisHosts[0])
	if err != nil {
		t.Fatalf("Failed to parse Redis URL: %v", err)
	}
	redisConn := redis.NewClient(&redis.Options{
		Addr: parsedURL.Host,
	})
	intCmd := redisConn.Publish(ctx, xEnv.GetPubSubName(topicName), message)
	require.NoError(t, intCmd.Err())
}

func readRedisMessages(t *testing.T, xEnv *testenv.Environment, channelName string) (<-chan *redis.Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	parsedURL, err := url.Parse(xEnv.RedisHosts[0])
	if err != nil {
		return nil, err
	}
	redisConn := redis.NewClient(&redis.Options{
		Addr: parsedURL.Host,
	})
	sub := redisConn.Subscribe(ctx, xEnv.GetPubSubName(channelName))
	t.Cleanup(func() {
		sub.Close()
		redisConn.Close()
	})

	return sub.Channel(), nil
}
