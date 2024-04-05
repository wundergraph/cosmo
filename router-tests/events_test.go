package integration_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestEventsNew(t *testing.T) {
	t.Parallel()

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(2)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				defer wg.Done()
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			go func() {
				err = client.Run()
				require.NoError(t, err)
			}()

			go func() {
				wg.Wait()
				err = client.Unsubscribe(subscriptionOneID)
				require.NoError(t, err)
				err = client.Close()
				require.NoError(t, err)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, resOne.Body)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe async epoll/kqueue disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableWebSocketEpollKqueue = false
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 100
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscription struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(2)

			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				defer wg.Done()
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)

			go func() {
				err := client.Run()
				require.NoError(t, err)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Wait longer than the read timeout to ensure that read timeouts are handled correctly
			time.Sleep(time.Millisecond * 200)

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()

			err = client.Unsubscribe(subscriptionID)
			require.NoError(t, err)

			err = client.Close()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			//xEnv.WaitForConnectionCount(0, time.Second*10) flaky
		})
	})

	t.Run("subscribe sync sse", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayload))
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
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				eventNext, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				wg.Done()

			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()
		})
	})

	t.Run("subscribe sync sse with block", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockSubscriptions = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePayloadOne := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)
			subscribePayloadTwo := []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id details { forename surname } }}"}`)

			client := http.Client{
				Timeout: time.Second * 10,
			}
			reqOne, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayloadOne))
			require.NoError(t, err)

			reqOne.Header.Set("Content-Type", "application/json")
			reqOne.Header.Set("Accept", "text/event-stream")
			reqOne.Header.Set("Connection", "keep-alive")
			reqOne.Header.Set("Cache-Control", "no-cache")

			respOne, err := client.Do(reqOne)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, respOne.StatusCode)
			defer respOne.Body.Close()
			readerOne := bufio.NewReader(respOne.Body)

			eventNextOne, _, err := readerOne.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "event: next", string(eventNextOne))
			dataOne, _, err := readerOne.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}],\"data\":null}", string(dataOne))

			reqTwo, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayloadTwo))
			require.NoError(t, err)

			reqTwo.Header.Set("Content-Type", "application/json")
			reqTwo.Header.Set("Accept", "text/event-stream")
			reqTwo.Header.Set("Connection", "keep-alive")
			reqTwo.Header.Set("Cache-Control", "no-cache")

			respTwo, err := client.Do(reqTwo)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, respTwo.StatusCode)
			defer respTwo.Body.Close()
			readerTwo := bufio.NewReader(respTwo.Body)

			eventNextTwo, _, err := readerTwo.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "event: next", string(eventNextTwo))
			dataTwo, _, err := readerTwo.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}],\"data\":null}", string(dataTwo))
		})
	})

	t.Run("subscribe sync sse client close", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSubscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(firstSubscribePayload))
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
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				wg.Done()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("request", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSub, err := xEnv.NatsConnectionDefault.Subscribe("getEmployee.3", func(msg *nats.Msg) {
				err := msg.Respond([]byte(`{"id": 3, "__typename": "Employee"}`))
				require.NoError(t, err)
			})
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			secondSub, err := xEnv.NatsConnectionMyNats.Subscribe("getEmployeeMyNats.12", func(msg *nats.Msg) {
				err = msg.Respond([]byte(`{"id": 12, "__typename": "Employee"}`))
				require.NoError(t, err)
			})
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionMyNats.Flush())

			t.Cleanup(func() {
				err = firstSub.Unsubscribe()
				require.NoError(t, err)
				err = secondSub.Unsubscribe()
				require.NoError(t, err)
			})

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employeeFromEvent(id: 3) { id details { forename } }}`,
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"employeeFromEvent": {"id": 3, "details": {"forename": "Stefan"}}}}`, resOne.Body)

			resTwo := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employeeFromEventMyNats(employeeID: 12) { id details { forename } }}`,
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"employeeFromEventMyNats": {"id": 12, "details": {"forename": "David"}}}}`, resTwo.Body)
		})
	})

	t.Run("publish", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			firstSub, err := xEnv.NatsConnectionDefault.SubscribeSync("updateEmployee.3")
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			secondSub, err := xEnv.NatsConnectionMyNats.SubscribeSync("updateEmployeeMyNats.12")
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionMyNats.Flush())

			t.Cleanup(func() {
				err = firstSub.Unsubscribe()
				require.NoError(t, err)
				err = secondSub.Unsubscribe()
				require.NoError(t, err)
			})

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation UpdateEmployee($update: UpdateEmployeeInput!) {
							updateEmployee(id: 3, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"updateEmployee": {"success": true}}}`, resOne.Body)

			msgOne, err := firstSub.NextMsg(5 * time.Second)
			require.NoError(t, err)
			require.Equal(t, "updateEmployee.3", msgOne.Subject)
			require.Equal(t, `{"id":3,"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`, string(msgOne.Data))

			resTwo := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation updateEmployeeMyNats($update: UpdateEmployeeInput!) {
							updateEmployeeMyNats(employeeID: 12, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"David Stutt","email":"stutt@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"updateEmployeeMyNats": {"success": true}}}`, resTwo.Body)

			msgTwo, err := secondSub.NextMsg(5 * time.Second)
			require.NoError(t, err)
			require.Equal(t, "updateEmployeeMyNats.12", msgTwo.Subject)
			require.Equal(t, `{"employeeID":12,"update":{"name":"David Stutt","email":"stutt@wundergraph.com"}}`, string(msgTwo.Data))
		})
	})

	t.Run("subscribing to a non-existent stream returns an error", func(t *testing.T) {
		// This test cannot be run in parallel because another test's jetstream might not have fully closed yet
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedStream struct {
					ID float64 `graphql:"id"`
				} `graphql:"employeeUpdatedStream(id: 12)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			go func() {
				err := client.Run()
				require.NoError(t, err)
			}()

			wg := &sync.WaitGroup{}
			wg.Add(1)

			_, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				require.Contains(t, errValue.Error(), `EDFS NATS error: failed to create or update consumer "consumerName": nats: API error: code=404 err_code=10059 description=stream not found`)
				wg.Done()
				return nil
			})
			require.NoError(t, err)

			wg.Wait()
		})
	})

	t.Run("subscribe to multiple subjects", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			type subscriptionPayload struct {
				Data struct {
					EmployeeUpdatedMyNats struct {
						ID float64 `graphql:"id"`
					} `graphql:"employeeUpdatedMyNats(id: 12)"`
				} `json:"data"`
			}

			// conn.Close() is called in  a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id }}"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, time.Second*20)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionMyNats.Publish("employeeUpdatedMyNats.12", []byte(`{"id":13,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionMyNats.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(1, time.Second*5)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(13), payload.Data.EmployeeUpdatedMyNats.ID)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionMyNats.Publish("employeeUpdatedMyNatsTwo.12", []byte(`{"id":99,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionMyNats.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*5)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(99), payload.Data.EmployeeUpdatedMyNats.ID)
		})
	})

	t.Run("subscribe with stream and consumer", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			type subscriptionPayload struct {
				Data struct {
					EmployeeUpdatedStream struct {
						ID float64 `graphql:"id"`
					} `graphql:"employeeUpdatedStream(id: 12)"`
				} `json:"data"`
			}

			js, err := jetstream.New(xEnv.NatsConnectionDefault)
			require.NoError(t, err)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			_, err = js.CreateStream(ctx, jetstream.StreamConfig{
				Name:     "streamName",
				Subjects: []string{"employeeUpdated.>"},
			})
			require.NoError(t, err)
			t.Cleanup(func() {
				_ = js.DeleteStream(context.Background(), "streamName")
			})

			// conn.Close() is called in  a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedStream(id: 12) { id }}"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.12", []byte(`{"id":13,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(1, time.Second*10)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(13), payload.Data.EmployeeUpdatedStream.ID)

			// Stop the subscription
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "complete",
			})
			require.NoError(t, err)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)

			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "1", complete.ID)
			require.Equal(t, "complete", complete.Type)

			// Publish the second event while the subscription is unsubscribed
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.12", []byte(`{"id":14,"__typename":"Employee"}`))
			require.NoError(t, err)

			// Publish the third event while the subscription is unsubscribed
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.12", []byte(`{"id":15,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedStream(id: 12) { id }}"}`),
			})
			require.NoError(t, err)
			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(14), payload.Data.EmployeeUpdatedStream.ID)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(15), payload.Data.EmployeeUpdatedStream.ID)
		})
	})
}
