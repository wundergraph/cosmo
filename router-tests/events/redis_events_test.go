package events_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/core"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const RedisWaitTimeout = time.Second * 30

func assertRedisLineEquals(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	line, _, err := reader.ReadLine()
	require.NoError(t, err)
	assert.Equal(t, expected, string(line))
}

func assertRedisMultipartPrefix(t *testing.T, reader *bufio.Reader) {
	t.Helper()
	assertRedisLineEquals(t, reader, "")
	assertRedisLineEquals(t, reader, "--graphql")
	assertRedisLineEquals(t, reader, "Content-Type: application/json")
	assertRedisLineEquals(t, reader, "")
}

func assertRedisMultipartValueEventually(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	assert.Eventually(t, func() bool {
		assertRedisMultipartPrefix(t, reader)
		line, _, err := reader.ReadLine()
		assert.NoError(t, err)
		if string(line) == "{}" {
			return false
		}
		assert.Equal(t, expected, string(line))
		return true
	}, RedisWaitTimeout, time.Millisecond*100)
}

type subscriptionArgs struct {
	dataValue []byte
	errValue  error
}

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

			subscriptionArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			runCh := make(chan error)
			go func() {
				// start subscription
				runCh <- client.Run()
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce a message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// process the message
			select {
			case subscriptionArgs := <-subscriptionArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// close the client
			client.Close()

			// check that the client is closed correctly
			select {
			case err := <-runCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client to close")
			}
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

			subscriptionArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			runCh := make(chan error)
			go func() {
				runCh <- client.Run()
			}()

			// Wait for the subscription to be started before producing a message
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce an empty message
			produceRedisMessage(t, xEnv, topics[0], ``)
			// process the message
			select {
			case subscriptionArgs := <-subscriptionArgsCh:
				var gqlErr graphql.Errors
				require.ErrorAs(t, subscriptionArgs.errValue, &gqlErr)
				require.Equal(t, "Invalid message received", gqlErr[0].Message)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`) // Correct message
			select {
			case subscriptionArgs := <-subscriptionArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// Missing entity = Resolver error
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`)
			select {
			case subscriptionArgs := <-subscriptionArgsCh:
				var gqlErr graphql.Errors
				require.ErrorAs(t, subscriptionArgs.errValue, &gqlErr)
				require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdates.id'.", gqlErr[0].Message)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// Correct message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
			select {
			case subscriptionArgs := <-subscriptionArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// close the client
			require.NoError(t, client.Close())

			// check that the client is closed correctly
			select {
			case err := <-runCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client to close")
			}
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

			subscriptionOneArgsCh := make(chan subscriptionArgs)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoArgsCh := make(chan subscriptionArgs)
			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionTwoArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			runCh := make(chan error)
			go func() {
				runCh <- client.Run()
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(2, RedisWaitTimeout)

			// produce a message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// read the message from the first subscription
			select {
			case subscriptionArgs := <-subscriptionOneArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// read the message from the second subscription
			select {
			case subscriptionArgs := <-subscriptionTwoArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for second message error")
			}

			// close the client
			require.NoError(t, client.Close())

			// check that the client is closed correctly
			select {
			case err := <-runCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client to close")
			}
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

			subscriptionOneArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoArgsCh := make(chan subscriptionArgs)
			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionTwoArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			runCh := make(chan error)
			go func() {
				runCh <- client.Run()
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(2, RedisWaitTimeout)

			// produce a message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// read the message from the first subscription
			select {
			case subscriptionArgs := <-subscriptionOneArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// read the message from the second subscription
			select {
			case subscriptionArgs := <-subscriptionTwoArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for second message error")
			}

			// produce a message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 2,"update":{"name":"foo"}}`)

			// read the message from the first subscription
			select {
			case subscriptionArgs := <-subscriptionOneArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// read the message from the second subscription
			select {
			case subscriptionArgs := <-subscriptionTwoArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for second message error")
			}

			// close the client
			require.NoError(t, client.Close())

			// check that the client is closed correctly
			select {
			case err := <-runCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client to close")
			}
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

			subscriptionOneArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			runCh := make(chan error)
			go func() {
				runCh <- client.Run()
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce a message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// read the message from the subscription
			select {
			case subscriptionArgs := <-subscriptionOneArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for first message error")
			}

			// close the client
			require.NoError(t, client.Close())

			// check that the client is closed correctly
			select {
			case err := <-runCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client to close")
			}
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

				// start the subscription
				client := http.Client{
					Timeout: time.Second * 100,
				}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				// Wait for the subscription to be started
				xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

				// produce a message
				produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				// read the message from the subscription
				assertRedisMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")

				// produce a message
				produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
				// read the message from the subscription
				assertRedisMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}}")
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

				assertRedisMultipartValueEventually(t, reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")
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

			client := http.Client{
				Timeout: time.Second * 10,
			}
			req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, gErr)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			// start the subscription
			clientRetCh := make(chan struct {
				resp *http.Response
				err  error
			})
			go func() {
				resp, err := client.Do(req)
				clientRetCh <- struct {
					resp *http.Response
					err  error
				}{resp, err}
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce a message so that the subscription is triggered
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// get the client response
			var clientRet struct {
				resp *http.Response
				err  error
			}
			select {
			case clientRet = <-clientRetCh:
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}
			defer func() {
				if clientRet.resp != nil {
					clientRet.resp.Body.Close()
				}
			}()
			require.NoError(t, clientRet.err)
			require.Equal(t, http.StatusOK, clientRet.resp.StatusCode)

			// read the message from the subscription
			reader := bufio.NewReader(clientRet.resp.Body)
			eventNext, _, gErr := reader.ReadLine()
			require.NoError(t, gErr)
			require.Equal(t, "event: next", string(eventNext))
			data, _, gErr := reader.ReadLine()
			require.NoError(t, gErr)
			require.Equal(t, "data: {\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
			line, _, gErr := reader.ReadLine()
			require.NoError(t, gErr)
			require.Empty(t, string(line))
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
			client := http.Client{
				Timeout: time.Second * 10,
			}
			req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, gErr)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			clientRetCh := make(chan struct {
				resp *http.Response
				err  error
			})

			// start the subscription
			go func() {
				resp, err := client.Do(req)
				clientRetCh <- struct {
					resp *http.Response
					err  error
				}{resp, err}
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce a message so that the subscription is triggered
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// get the client response
			var clientRet struct {
				resp *http.Response
				err  error
			}
			select {
			case clientRet = <-clientRetCh:
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}
			defer func() {
				if clientRet.resp != nil {
					clientRet.resp.Body.Close()
				}
			}()
			require.NoError(t, clientRet.err)
			require.Equal(t, http.StatusOK, clientRet.resp.StatusCode)

			// read the message from the subscription
			reader := bufio.NewReader(clientRet.resp.Body)
			eventNext, _, gErr := reader.ReadLine()
			require.NoError(t, gErr)
			require.Equal(t, "event: next", string(eventNext))
			data, _, gErr := reader.ReadLine()
			require.NoError(t, gErr)
			require.Equal(t, "data: {\"data\":{\"employeeUpdates\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
			line, _, gErr := reader.ReadLine()
			require.NoError(t, gErr)
			require.Empty(t, string(line))
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

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			type subscriptionPayload struct {
				Data struct {
					FilteredEmployeeUpdatedMyRedis struct {
						ID      int `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"filteredEmployeeUpdatedMyRedis(ids: [1, 3, 4, 7, 11])"`
				} `json:"data"`
			}

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { filteredEmployeeUpdatedMyRedis(ids: [1, 3, 4, 7, 11]) { id details { forename, surname } } }"}`),
			})
			require.NoError(t, err)

			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			const MsgCount = 12

			employeesCheck := map[int]struct {
				Forename string
				Surname  string
			}{
				1:  {"Jens", "Neuse"},
				3:  {"Stefan", "Avram"},
				4:  {"Björn", "Schwenzer"},
				7:  {"Suvij", "Surya"},
				11: {"Alexandra", "Neuse"},
			}

			// Events 1, 3, 4, 7, and 11 should be included
			for i := MsgCount; i > 0; i-- {
				produceRedisMessage(t, xEnv, topics[0], fmt.Sprintf(`{"__typename":"Employee","id":%d}`, i))

				if i == 11 || i == 7 || i == 4 || i == 3 || i == 1 {
					gErr := conn.ReadJSON(&msg)
					require.NoError(t, gErr)
					require.Equal(t, "1", msg.ID)
					require.Equal(t, "next", msg.Type)
					gErr = json.Unmarshal(msg.Payload, &payload)
					require.NoError(t, gErr)
					require.Equal(t, int(i), payload.Data.FilteredEmployeeUpdatedMyRedis.ID)
					require.Equal(t, employeesCheck[i].Forename, payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Forename)
					require.Equal(t, employeesCheck[i].Surname, payload.Data.FilteredEmployeeUpdatedMyRedis.Details.Surname)
				}
			}
		})
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
					ID      int `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionOneArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			// start the subscription
			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce an invalid message
			produceRedisMessage(t, xEnv, topics[0], `{asas`)
			// get the client response
			select {
			case args := <-subscriptionOneArgsCh:
				var gqlErr graphql.Errors
				require.ErrorAs(t, args.errValue, &gqlErr)
				require.Equal(t, "Invalid message received", gqlErr[0].Message)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}

			// produce a correct message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id":1}`)
			// get the client response
			select {
			case args := <-subscriptionOneArgsCh:
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}

			// produce a message with a missing entity
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","update":{"name":"foo"}}`)
			// get the client response
			select {
			case args := <-subscriptionOneArgsCh:
				var gqlErr graphql.Errors
				require.ErrorAs(t, args.errValue, &gqlErr)
				require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdates.id'.", gqlErr[0].Message)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}

			// produce a correct message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)
			// get the client response
			select {
			case args := <-subscriptionOneArgsCh:
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}

			require.NoError(t, client.Close())

			select {
			case err := <-clientRunCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}
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
			// start reading the messages from the channel
			msgCh, err := readRedisMessages(t, xEnv, channels[0])
			require.NoError(t, err)

			// send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyRedis":{"success":true}}}`, resOne.Body)

			// read the message
			select {
			case m := <-msgCh:
				require.JSONEq(t, `{"id":3,"update":{"name":"name test"}}`, m.Payload)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}
		})
	})
}

func TestRedisClusterEvents(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		topics := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedisCluster:       true,
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

			// create the subscription
			subscriptionOneArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			// start the client with the subscription
			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			// Wait for the subscription to be started
			xEnv.WaitForSubscriptionCount(1, RedisWaitTimeout)

			// produce a message
			produceRedisMessage(t, xEnv, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// read the message
			select {
			case args := <-subscriptionOneArgsCh:
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}

			// close the client
			require.NoError(t, client.Close())

			// wait for the client to be closed
			select {
			case err := <-clientRunCh:
				require.NoError(t, err)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}
		})
	})

	t.Run("mutate", func(t *testing.T) {
		t.Parallel()

		channels := []string{"employeeUpdatedMyRedis"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedisCluster:       true,
			NoRetryClient:            true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// start reading the messages from the channel
			msgCh, err := readRedisMessages(t, xEnv, channels[0])
			require.NoError(t, err)

			// send a mutation to produce a message
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyRedis":{"success":true}}}`, resOne.Body)

			// read the message
			select {
			case m := <-msgCh:
				require.JSONEq(t, `{"id":3,"update":{"name":"name test"}}`, m.Payload)
			case <-time.After(RedisWaitTimeout):
				t.Fatal("timeout waiting for client response")
			}
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
	var redisConn redis.UniversalClient
	if !xEnv.RedisWithClusterMode {
		redisConn = redis.NewClient(&redis.Options{
			Addr: parsedURL.Host,
		})
	} else {
		redisConn = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs: []string{parsedURL.Host},
		})
	}

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
	var redisConn redis.UniversalClient
	if !xEnv.RedisWithClusterMode {
		redisConn = redis.NewClient(&redis.Options{
			Addr: parsedURL.Host,
		})
	} else {
		redisConn = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs: []string{parsedURL.Host},
		})
	}
	sub := redisConn.Subscribe(ctx, xEnv.GetPubSubName(channelName))
	t.Cleanup(func() {
		sub.Close()
		redisConn.Close()
	})

	return sub.Channel(), nil
}
