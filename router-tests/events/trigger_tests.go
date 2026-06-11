package events

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// TestEDFSTriggerDeduplication verifies trigger ID generation for Cosmo Streams subscriptions.
// It tests that the trigger hash is based on the NATS subject and provider ID, not on
// the resolver input — meaning subscriptions to the same subject share one trigger
// even when they select different fields, have different headers or arguments.
func TestEDFSTriggerDeduplication(t *testing.T) {
	t.Parallel()

	// Two subscriptions with the same employeeID but different selected fields should share
	// a single NATS trigger because both resolve to the same subject ("employeeUpdated.3").
	t.Run("same subject different selected fields shares one trigger", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var done sync.WaitGroup
			done.Add(2)

			go func() {
				xEnv.WaitForSubscriptionCount(2, time.Second*10)
				// Both subscriptions target the same NATS subject ("employeeUpdated.3") and
				// provider ID, so they must resolve to the same trigger ID — wait for exactly
				// one trigger to be initialized before asserting.
				xEnv.WaitForTriggerCount(1, time.Second*10)
				xEnv.RequireTriggerCount(1)
				xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename":"Employee"}`), 2, time.Second*10)
			}()

			// Subscription 1: selects only id.
			go func() {
				defer done.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id } }"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				require.Equal(t, "1", msg.ID)

				err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				require.NoError(t, err)

				var complete testenv.WebSocketMessage
				err = conn.SetReadDeadline(time.Now().Add(time.Second))
				require.NoError(t, err)
				err = testenv.WSReadJSON(t, conn, &complete)
				require.NoError(t, err)
				require.Equal(t, "complete", complete.Type)
				require.Equal(t, "1", complete.ID)
			}()

			// Subscription 2: selects id and details — a different query shape over the same subject.
			go func() {
				defer done.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				require.Equal(t, "1", msg.ID)

				err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				require.NoError(t, err)

				var complete testenv.WebSocketMessage
				err = conn.SetReadDeadline(time.Now().Add(time.Second))
				require.NoError(t, err)
				err = testenv.WSReadJSON(t, conn, &complete)
				require.NoError(t, err)
				require.Equal(t, "complete", complete.Type)
				require.Equal(t, "1", complete.ID)
			}()

			done.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})

	// Two subscriptions with different employeeIDs resolve to different NATS subjects and
	// must therefore receive independent triggers.
	t.Run("different subjects use separate triggers", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var done sync.WaitGroup
			done.Add(2)

			go func() {
				xEnv.WaitForSubscriptionCount(2, time.Second*10)
				xEnv.WaitForTriggerCount(2, time.Second*10)
				xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename":"Employee"}`), 1, time.Second*10)
				xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.4"), []byte(`{"id":4,"__typename":"Employee"}`), 1, time.Second*10)
			}()

			// Subscription 1: employeeID 3 → subject "employeeUpdated.3"
			go func() {
				defer done.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id } }"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				require.Equal(t, "1", msg.ID)

				err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				require.NoError(t, err)

				var complete testenv.WebSocketMessage
				err = conn.SetReadDeadline(time.Now().Add(time.Second))
				require.NoError(t, err)
				err = testenv.WSReadJSON(t, conn, &complete)
				require.NoError(t, err)
				require.Equal(t, "complete", complete.Type)
				require.Equal(t, "1", complete.ID)
			}()

			// Subscription 2: employeeID 4 → subject "employeeUpdated.4"
			go func() {
				defer done.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 4) { id } }"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				require.Equal(t, "1", msg.ID)

				err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				require.NoError(t, err)

				var complete testenv.WebSocketMessage
				err = conn.SetReadDeadline(time.Now().Add(time.Second))
				require.NoError(t, err)
				err = testenv.WSReadJSON(t, conn, &complete)
				require.NoError(t, err)
				require.Equal(t, "complete", complete.Type)
				require.Equal(t, "1", complete.ID)
			}()

			done.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
}
