package integration_test

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/nats-io/nats.go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/atomic"
)

func TestEvents(t *testing.T) {
	t.Parallel()

	server, port := setupListeningServer(t)

	nc, err := nats.Connect(os.Getenv("NATS_URL"))
	require.NoError(t, err)
	t.Cleanup(nc.Close)

	t.Run("subscribe", func(t *testing.T) {
		t.Parallel()

		var subscription struct {
			employeeUpdated struct {
				ID      float64 `graphql:"id"`
				Details struct {
					Forename string `graphql:"forename"`
					Surname  string `graphql:"surname"`
				} `graphql:"details"`
			} `graphql:"employeeUpdated(employeeID: 3)"`
		}
		subscriptionURL := fmt.Sprintf("ws://localhost:%d/graphql", port)

		client := graphql.NewSubscriptionClient(subscriptionURL)
		t.Cleanup(func() {
			err := client.Close()
			assert.NoError(t, err)
		})
		var triggers atomic.Int64
		subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
			require.NoError(t, errValue)
			assert.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
			triggers.Inc()
			return nil
		})
		require.NoError(t, err)
		require.NotEqual(t, "", subscriptionID)

		go func() {
			err := client.Run()
			assert.NoError(t, err)
		}()

		// wait a bit for the connection to nats to be set up
		time.Sleep(1 * time.Second)

		// Send a mutation to trigger the subscription
		result := sendData(server, "/graphql", []byte(`{"query":"mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }")}`))
		assert.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, result.Body.String())

		// Trigger the subscription via NATS
		err = nc.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
		require.NoError(t, err)

		time.Sleep(1 * time.Second)

		assert.Equal(t, int64(2), triggers.Load())

		client.Close()
	})

	t.Run("publish", func(t *testing.T) {
		t.Parallel()

		sub, err := nc.SubscribeSync("updateEmployee.3")
		t.Cleanup(func() {
			err := sub.Unsubscribe()
			assert.NoError(t, err)
		})
		require.NoError(t, err)

		// Send a mutation to trigger a publication to the NATS subject
		result := sendData(server, "/graphql", []byte(`{"query":"mutation { updateEmployee(id: 3, update: { name: \"John\", email: \"john@example.com\" }) { success }}"}`))
		assert.JSONEq(t, `{"data":{"updateEmployee": {"success": true}}}`, result.Body.String())

		msg, err := sub.NextMsg(1 * time.Second)
		require.NoError(t, err)
		assert.JSONEq(t, `{"id":3, "update": {"name": "John", "email": "john@example.com"}}`, string(msg.Data))
	})

	t.Run("request", func(t *testing.T) {
		t.Parallel()

		sub, err := nc.Subscribe("getEmployee.3", func(msg *nats.Msg) {
			err := msg.Respond([]byte(`{"id": 3, "__typename": "Employee"}`))
			require.NoError(t, err)
		})
		require.NoError(t, err)
		t.Cleanup(func() {
			err := sub.Unsubscribe()
			assert.NoError(t, err)
		})

		// Send a query to receive the response from the NATS message
		result := sendData(server, "/graphql", []byte(`{"query":"query { employeeFromEvent(id: 3) { id details { forename } }}"}`))
		assert.JSONEq(t, `{"data":{"employeeFromEvent": {"id": 3, "details": {"forename": "Stefan"}}}}`, result.Body.String())
	})
}
