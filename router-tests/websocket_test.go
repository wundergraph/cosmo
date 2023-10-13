package integration_test

import (
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type wsMessage struct {
	ID      string          `json:"id,omitempty"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func connReadJSON(conn *websocket.Conn, v interface{}) error {
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	defer conn.SetReadDeadline(time.Time{})
	return conn.ReadJSON(v)
}

func connectedWebsocket(tb testing.TB) *websocket.Conn {
	dialer := websocket.Dialer{
		Subprotocols: []string{"graphql-transport-ws"},
	}
	conn, _, err := dialer.Dial("ws://localhost:3002/graphql", nil)
	require.NoError(tb, err)
	err = conn.WriteJSON(&wsMessage{
		Type: "connection_init",
	})
	require.NoError(tb, err)
	var msg wsMessage
	err = connReadJSON(conn, &msg)
	require.NoError(tb, err)
	require.Equal(tb, "connection_ack", msg.Type)
	// tb.Cleanup(func() {
	// 	err := conn.Close()
	// 	assert.NoError(tb, err)
	// })

	return conn
}

func TestQueryOverWebsocket(t *testing.T) {
	const (
		query           = `{ employees { id } }`
		expectedPayload = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`
	)
	setupListeningServer(t)
	conn := connectedWebsocket(t)
	var err error
	q := &testQuery{
		Body: query,
	}
	const messageID = "1"
	err = conn.WriteJSON(&wsMessage{
		ID:      messageID,
		Type:    "subscribe",
		Payload: q.Data(),
	})
	assert.NoError(t, err)
	var msg wsMessage
	err = connReadJSON(conn, &msg)
	require.NoError(t, err)
	assert.Equal(t, "next", msg.Type)
	assert.Equal(t, messageID, msg.ID)
	assert.Equal(t, expectedPayload, string(msg.Payload))
	err = connReadJSON(conn, &msg)
	require.NoError(t, err)
	assert.Equal(t, "complete", msg.Type)
	assert.Equal(t, messageID, msg.ID)
}

func TestSubscriptionOverWebsocket(t *testing.T) {
	type currentTimePayload struct {
		Data struct {
			CurrentTime struct {
				UnixTime  float64 `json:"unixTime"`
				Timestamp string  `json:"timestamp"`
			} `json:"currentTime"`
		} `json:"data"`
	}
	setupListeningServer(t)
	conn := connectedWebsocket(t)
	var err error
	const messageID = "1"
	err = conn.WriteJSON(&wsMessage{
		ID:      messageID,
		Type:    "subscribe",
		Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
	})
	require.NoError(t, err)
	var msg wsMessage
	var payload currentTimePayload

	// Read a result and store its timestamp, next result should be 1 second later
	err = connReadJSON(conn, &msg)
	require.NoError(t, err)
	assert.Equal(t, messageID, msg.ID)
	assert.Equal(t, "next", msg.Type)
	err = json.Unmarshal(msg.Payload, &payload)
	require.NoError(t, err)

	unix1 := payload.Data.CurrentTime.UnixTime

	err = connReadJSON(conn, &msg)
	require.NoError(t, err)
	assert.Equal(t, messageID, msg.ID)
	assert.Equal(t, "next", msg.Type)
	err = json.Unmarshal(msg.Payload, &payload)
	require.NoError(t, err)

	unix2 := payload.Data.CurrentTime.UnixTime
	assert.Equal(t, unix1+1, unix2)

	// Sending a complete must stop the subscription
	err = conn.WriteJSON(&wsMessage{
		ID:   messageID,
		Type: "complete",
	})
	require.NoError(t, err)
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	// This should timeout because no more data is coming
	_, _, err = conn.NextReader()
	netErr, ok := err.(net.Error)
	require.True(t, ok)
	assert.True(t, netErr.Timeout())
	conn.SetReadDeadline(time.Time{})
}

type graphqlError struct {
	Message string `json:"message"`
}

func TestErrorOverWebsocket(t *testing.T) {
	setupListeningServer(t)
	conn := connectedWebsocket(t)
	var err error
	const messageID = "1"
	err = conn.WriteJSON(&wsMessage{
		ID:      messageID,
		Type:    "subscribe",
		Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
	})
	require.NoError(t, err)
	var msg wsMessage
	err = connReadJSON(conn, &msg)
	require.NoError(t, err)
	assert.Equal(t, "error", msg.Type)
	// Payload should be an array of GraphQLError
	var errors []graphqlError
	err = json.Unmarshal(msg.Payload, &errors)
	require.NoError(t, err)
	assert.Len(t, errors, 1)
	assert.Equal(t, errors[0].Message, `field: does_not_exist not defined on type: Subscription`)
}
