package integration_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"github.com/wundergraph/cosmo/router/config"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestEventsNew(t *testing.T) {

	t.Run("subscribe async", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

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

			go func() {
				wg.Wait()
				err = client.Unsubscribe(subscriptionID)
				require.NoError(t, err)
				err := client.Close()
				require.NoError(t, err)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err = xEnv.NC.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NC.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe async epoll/kqueue disabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableWebSocketEpollKqueue = false
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

			// Trigger the subscription via NATS
			err = xEnv.NC.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NC.Flush()
			require.NoError(t, err)

			wg.Wait()

			err = client.Unsubscribe(subscriptionID)
			require.NoError(t, err)

			err = client.Close()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe sync sse", func(t *testing.T) {

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

				line, err := reader.ReadString('\n')
				require.NoError(t, err)
				_, err = reader.ReadString('\n')
				require.NoError(t, err)
				require.Equal(t, "data: ", line[:6])
				require.JSONEq(t, `{"data":{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}}`, line[6:])

				line, err = reader.ReadString('\n')
				require.NoError(t, err)
				_, err = reader.ReadString('\n')
				require.NoError(t, err)
				require.Equal(t, "data: ", line[:6])
				require.JSONEq(t, `{"data":{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}}`, line[6:])

				wg.Done()

			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NC.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NC.Flush()
			require.NoError(t, err)

			wg.Wait()
		})
	})

	t.Run("subscribe sync sse client close", func(t *testing.T) {
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

				line, err := reader.ReadString('\n')
				require.NoError(t, err)
				// sse -> line starts with 'data: '
				require.Equal(t, "data: ", line[:6])
				require.JSONEq(t, `{"data":{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}}`, line[6:])

				wg.Done()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NC.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NC.Flush()
			require.NoError(t, err)

			wg.Wait()

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("request", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			sub, err := xEnv.NC.Subscribe("getEmployee.3", func(msg *nats.Msg) {
				err := msg.Respond([]byte(`{"id": 3, "__typename": "Employee"}`))
				require.NoError(t, err)
			})
			require.NoError(t, err)

			t.Cleanup(func() {
				err := sub.Unsubscribe()
				require.NoError(t, err)
			})

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employeeFromEvent(id: 3) { id details { forename } }}`,
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"employeeFromEvent": {"id": 3, "details": {"forename": "Stefan"}}}}`, res.Body)

		})
	})

	t.Run("publish", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			done := make(chan struct{})

			sub, err := xEnv.NC.Subscribe("updateEmployee.>", func(msg *nats.Msg) {
				require.Equal(t, "updateEmployee.3", msg.Subject)
				require.Equal(t, `{"id":3,"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`, string(msg.Data))
				close(done)
			})
			require.NoError(t, err)

			t.Cleanup(func() {
				err := sub.Unsubscribe()
				require.NoError(t, err)
			})

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation UpdateEmployee ($update: UpdateEmployeeInput!) {
							updateEmployee(id: 3, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"updateEmployee": {"success": true}}}`, res.Body)

			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("timeout waiting for NATS message")
			}
		})
	})
}
