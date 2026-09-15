package events_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// kafkaCursorPayload is the shape of a websocket "next" message payload when
// the client opted in to cursor-resume delivery via
// extensions.delivery-guarantee = "cursor".
type kafkaCursorPayload struct {
	Data       json.RawMessage `json:"data"`
	Extensions struct {
		Cursor string `json:"cursor"`
	} `json:"extensions"`
}

// kafkaCursorPartitionOffset mirrors the unexported partitionOffset type in
// router/pkg/pubsub/kafka/cursor.go.
type kafkaCursorPartitionOffset struct {
	Offset int64 `json:"offset"`
	Epoch  int32 `json:"epoch"`
}

// decodeKafkaCursor decodes a base64url(json) cursor and asserts it matches
// the given provider and carries exactly one topic/partition position.
func decodeKafkaCursor(t *testing.T, cursor string) (datasource.Cursor, kafkaCursorPartitionOffset) {
	t.Helper()

	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	require.NoError(t, err)

	var c datasource.Cursor
	require.NoError(t, json.Unmarshal(raw, &c))

	var position map[string]map[string]kafkaCursorPartitionOffset
	require.NoError(t, json.Unmarshal(c.Position, &position))
	require.Len(t, position, 1, "expected exactly one topic in the cursor position")

	var partitionOffset kafkaCursorPartitionOffset
	for _, partitions := range position {
		require.Len(t, partitions, 1, "expected exactly one partition in the cursor position")
		for _, po := range partitions {
			partitionOffset = po
		}
	}

	return c, partitionOffset
}

// subscribeWithCursorGuarantee opens a graphql-transport-ws connection and
// sends a subscribe message for the given query, opting in to cursor-resume
// delivery via extensions.delivery-guarantee = "cursor".
func subscribeWithCursorGuarantee(t *testing.T, xEnv *testenv.Environment) *websocket.Conn {
	t.Helper()

	conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

	payload, err := json.Marshal(map[string]any{
		"query":      "subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename } } }",
		"extensions": map[string]any{"delivery-guarantee": "cursor"},
	})
	require.NoError(t, err)

	err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
		ID:      "1",
		Type:    "subscribe",
		Payload: payload,
	})
	require.NoError(t, err)

	return conn
}

// publishDefaultEmployeeEvent publishes a single default Kafka event to the
// "employeeUpdated" topic used by the cursor tests.
func publishDefaultEmployeeEvent(xEnv *testenv.Environment, employeeID int) {
	xEnv.KafkaPublishUntilReceived("employeeUpdated",
		fmt.Sprintf(`{"__typename":"Employee","id": %d,"update":{"name":"foo"}}`, employeeID),
		1, EventWaitTimeout)
}

// readNextCursorPayload reads one "next" websocket message for the given
// subscription id and decodes its payload, asserting it carries a cursor.
func readNextCursorPayload(t *testing.T, conn *websocket.Conn, subscriptionID string) kafkaCursorPayload {
	t.Helper()

	var msg testenv.WebSocketMessage
	err := testenv.WSReadJSON(t, conn, &msg)
	require.NoError(t, err)
	require.Equal(t, "next", msg.Type)
	require.Equal(t, subscriptionID, msg.ID)

	var payload kafkaCursorPayload
	require.NoError(t, json.Unmarshal(msg.Payload, &payload))
	require.NotEmpty(t, payload.Extensions.Cursor)

	return payload
}

// subscribeWithCursorResume opens a graphql-transport-ws connection and sends
// a subscribe message for the given query, opting in to cursor-resume
// delivery and presenting the given cursor to resume from.
func subscribeWithCursorResume(t *testing.T, xEnv *testenv.Environment, resumeCursor string) *websocket.Conn {
	t.Helper()

	conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

	payload, err := json.Marshal(map[string]any{
		"query": "subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename } } }",
		"extensions": map[string]any{
			"delivery-guarantee": "cursor",
			"cursor":             resumeCursor,
		},
	})
	require.NoError(t, err)

	err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
		ID:      "1",
		Type:    "subscribe",
		Payload: payload,
	})
	require.NoError(t, err)

	return conn
}

// subscribeWithoutCursorGuarantee opens a graphql-transport-ws connection and
// sends a subscribe message for the given query without opting in to
// cursor-resume delivery.
func subscribeWithoutCursorGuarantee(t *testing.T, xEnv *testenv.Environment) *websocket.Conn {
	t.Helper()

	conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

	payload, err := json.Marshal(map[string]any{
		"query": "subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename } } }",
	})
	require.NoError(t, err)

	err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
		ID:      "1",
		Type:    "subscribe",
		Payload: payload,
	})
	require.NoError(t, err)

	return conn
}

// readNextPayloadWithoutCursor reads one "next" websocket message for the
// given subscription id and asserts it does not carry a cursor.
func readNextPayloadWithoutCursor(t *testing.T, conn *websocket.Conn, subscriptionID string) kafkaCursorPayload {
	t.Helper()

	var msg testenv.WebSocketMessage
	err := testenv.WSReadJSON(t, conn, &msg)
	require.NoError(t, err)
	require.Equal(t, "next", msg.Type)
	require.Equal(t, subscriptionID, msg.ID)

	var payload kafkaCursorPayload
	require.NoError(t, json.Unmarshal(msg.Payload, &payload))
	require.Empty(t, payload.Extensions.Cursor)

	return payload
}

// publishEmployeeEventWithoutSubscriber produces a single default Kafka
// employee event directly, without waiting for a subscriber to receive it.
// Use this when no subscription is active at publish time, e.g. while a
// client is disconnected between publishes.
func publishEmployeeEventWithoutSubscriber(t *testing.T, xEnv *testenv.Environment, employeeID int) {
	t.Helper()

	errCh := make(chan error, 1)
	xEnv.KafkaClient.Produce(xEnv.Context, &kgo.Record{
		Topic: xEnv.GetPubSubName("employeeUpdated"),
		Value: fmt.Appendf(nil, `{"__typename":"Employee","id": %d,"update":{"name":"foo"}}`, employeeID),
	}, func(_ *kgo.Record, err error) {
		errCh <- err
	})
	require.NoError(t, <-errCh)
}

// requireStableMessagesSent asserts that the engine's total messages-sent
// counter stays at expectedTotal for the given window, i.e. no subscriber
// received any further message during that time. This is checked via the
// engine statistics rather than by reading from a websocket connection,
// since a manual read-with-deadline on a connection that is expected to
// receive nothing can desynchronize the frame reader and break later reads
// on that same connection (see router-tests/CLAUDE.md).
func requireStableMessagesSent(t *testing.T, xEnv *testenv.Environment, expectedTotal uint64, window time.Duration) {
	t.Helper()

	sr, ok := xEnv.Router.EngineStats.(*testenv.SyncReporter)
	require.True(t, ok, "EngineStats is not a *testenv.SyncReporter; test environment misconfigured")

	require.Equal(t, expectedTotal, sr.GetReport().MessagesSent)
	require.Never(t, func() bool {
		return sr.GetReport().MessagesSent != expectedTotal
	}, window, 50*time.Millisecond)
}

// completeSubscription sends a "complete" message for the given subscription id.
func completeSubscription(t *testing.T, conn *websocket.Conn, id string) {
	t.Helper()

	err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
		ID:   id,
		Type: "complete",
	})
	require.NoError(t, err)
}

func TestKafkaCursor(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("ws subscription with delivery-guarantee cursor receives a cursor on every event", func(t *testing.T) {
		// subscribe one client to the router with cursor negotiation,
		// receive two messages containing a cursor,
		// verify that messages have a cursor in the GraphQL response extensions
		// and that their content is correct.
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			conn := subscribeWithCursorGuarantee(t, xEnv)
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			publishDefaultEmployeeEvent(xEnv, 1)

			firstReceivedEvent := readNextCursorPayload(t, conn, "1")
			firstCursor, firstOffset := decodeKafkaCursor(t, firstReceivedEvent.Extensions.Cursor)
			require.Equal(t, datasource.ProviderTypeKafka, firstCursor.ProviderType)
			require.Equal(t, "my-kafka", firstCursor.ProviderID)

			publishDefaultEmployeeEvent(xEnv, 1)

			secondReceivedEvent := readNextCursorPayload(t, conn, "1")
			require.NotEqual(t, firstReceivedEvent.Extensions.Cursor, secondReceivedEvent.Extensions.Cursor)
			secondCursor, secondOffset := decodeKafkaCursor(t, secondReceivedEvent.Extensions.Cursor)
			require.Equal(t, datasource.ProviderTypeKafka, secondCursor.ProviderType)
			require.Equal(t, "my-kafka", secondCursor.ProviderID)

			// Both messages were produced to the same topic/partition, so the second
			// cursor must record the very next offset with the same leader epoch.
			require.Equal(t, firstOffset.Epoch, secondOffset.Epoch)
			require.Equal(t, firstOffset.Offset+1, secondOffset.Offset)

			completeSubscription(t, conn, "1")
		})
	})

	t.Run("ws subscription can reconnect with a cursor and receive messages that arrived while disconnected", func(t *testing.T) {
		// subscribe one client to the router with cursor negotiation,
		// receive one message and remember its cursor,
		// disconnect the client,
		// publish three more messages while nobody is subscribed,
		// reconnect a new client presenting the remembered cursor,
		// verify all three pending messages are delivered.
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			conn := subscribeWithCursorGuarantee(t, xEnv)
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			publishDefaultEmployeeEvent(xEnv, 1)

			firstReceivedEvent := readNextCursorPayload(t, conn, "1")
			resumeCursor := firstReceivedEvent.Extensions.Cursor

			completeSubscription(t, conn, "1")
			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

			for range 3 {
				publishEmployeeEventWithoutSubscriber(t, xEnv, 1)
			}

			reconnected := subscribeWithCursorResume(t, xEnv, resumeCursor)
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			var previousOffset int64 = -1
			for range 3 {
				event := readNextCursorPayload(t, reconnected, "1")
				_, offset := decodeKafkaCursor(t, event.Extensions.Cursor)
				if previousOffset >= 0 {
					require.Equal(t, previousOffset+1, offset.Offset)
				}
				previousOffset = offset.Offset
			}

			completeSubscription(t, reconnected, "1")
		})
	})

	t.Run("ws subscriptions with cursor support are independent across clients", func(t *testing.T) {
		// subscribe two clients to the router with cursor negotiation,
		// verify both receive a cursor for the same message,
		// disconnect client 2 and remember its cursor,
		// publish three more messages while only client 1 is subscribed,
		// verify client 1 receives all three,
		// reconnect client 2 with its remembered cursor and verify it resumes
		// correctly, receiving exactly the three missed messages,
		// verify client 1 did not receive any of the resumed messages,
		// then publish one more message and verify both clients receive it.
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			client1 := subscribeWithCursorGuarantee(t, xEnv)
			client2 := subscribeWithCursorGuarantee(t, xEnv)
			xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			publishDefaultEmployeeEvent(xEnv, 1)

			client1Event := readNextCursorPayload(t, client1, "1")
			client2Event := readNextCursorPayload(t, client2, "1")

			client2ResumeCursor := client2Event.Extensions.Cursor
			_, client2ResumeOffset := decodeKafkaCursor(t, client2ResumeCursor)

			completeSubscription(t, client2, "1")
			require.NoError(t, client2.Close())
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

			for range 3 {
				publishDefaultEmployeeEvent(xEnv, 1)
			}

			_, client1PreviousOffset := decodeKafkaCursor(t, client1Event.Extensions.Cursor)
			for range 3 {
				event := readNextCursorPayload(t, client1, "1")
				_, offset := decodeKafkaCursor(t, event.Extensions.Cursor)
				require.Equal(t, client1PreviousOffset.Offset+1, offset.Offset)
				client1PreviousOffset = offset
			}

			reconnectedClient2 := subscribeWithCursorResume(t, xEnv, client2ResumeCursor)
			xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)
			xEnv.WaitForTriggerCount(2, EventWaitTimeout)

			client2PreviousOffset := client2ResumeOffset
			for range 3 {
				event := readNextCursorPayload(t, reconnectedClient2, "1")
				_, offset := decodeKafkaCursor(t, event.Extensions.Cursor)
				require.Equal(t, client2PreviousOffset.Offset+1, offset.Offset)
				client2PreviousOffset = offset
			}

			// client 1 already consumed the initial message plus the three
			// interim ones, so the total messages-sent count (2 for the
			// initial message to both clients, 3 for the interim messages to
			// client 1 only, 3 for the catch-up messages to client 2 only)
			// must not move while client 1 has nothing new to receive.
			requireStableMessagesSent(t, xEnv, 8, 2*time.Second)

			publishDefaultEmployeeEvent(xEnv, 1)

			finalClient1Event := readNextCursorPayload(t, client1, "1")
			_, finalClient1Offset := decodeKafkaCursor(t, finalClient1Event.Extensions.Cursor)
			require.Equal(t, client1PreviousOffset.Offset+1, finalClient1Offset.Offset)

			finalClient2Event := readNextCursorPayload(t, reconnectedClient2, "1")
			_, finalClient2Offset := decodeKafkaCursor(t, finalClient2Event.Extensions.Cursor)
			require.Equal(t, client2PreviousOffset.Offset+1, finalClient2Offset.Offset)

			completeSubscription(t, client1, "1")
			completeSubscription(t, reconnectedClient2, "1")
		})
	})

	t.Run("ws subscription without delivery-guarantee cursor does not receive a cursor", func(t *testing.T) {
		// subscribe one client to the router without cursor negotiation,
		// receive a message,
		// verify that the message does not have a cursor in the GraphQL response extensions.
		t.Parallel()

		topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			conn := subscribeWithoutCursorGuarantee(t, xEnv)
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			publishDefaultEmployeeEvent(xEnv, 1)
			readNextPayloadWithoutCursor(t, conn, "1")
			completeSubscription(t, conn, "1")
		})
	})
}
