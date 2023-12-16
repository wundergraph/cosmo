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
	nc, err := nats.Connect(os.Getenv("NATS_URL"))
	require.NoError(t, err)
	defer nc.Close()

	err = nc.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
	require.NoError(t, err)

	time.Sleep(1 * time.Second)

	assert.Equal(t, int64(2), triggers.Load())

	client.Close()

}
