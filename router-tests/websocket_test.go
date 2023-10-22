package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hasura/go-graphql-client"
	"github.com/hasura/go-graphql-client/pkg/jsonutil"
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

func connectedWebsocket(tb testing.TB, serverPort int) *websocket.Conn {
	dialer := websocket.Dialer{
		Subprotocols: []string{"graphql-transport-ws"},
	}
	conn, _, err := dialer.Dial(fmt.Sprintf("ws://localhost:%d/graphql", serverPort), nil)
	require.NoError(tb, err)
	err = conn.WriteJSON(&wsMessage{
		Type: "connection_init",
	})
	require.NoError(tb, err)
	var msg wsMessage
	err = connReadJSON(conn, &msg)
	require.NoError(tb, err)
	require.Equal(tb, "connection_ack", msg.Type)
	tb.Cleanup(func() {
		err := conn.Close()
		assert.NoError(tb, err)
	})

	return conn
}

func TestQueryOverWebsocket(t *testing.T) {
	const (
		query           = `{ employees { id } }`
		expectedPayload = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`
	)
	_, port := setupListeningServer(t)
	conn := connectedWebsocket(t, port)
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
	// Delete any "extensions" field from the payload, we don't care about it for now
	var payload map[string]json.RawMessage
	err = json.Unmarshal(msg.Payload, &payload)
	require.NoError(t, err)
	delete(payload, "extensions")
	payloadBytes, err := json.Marshal(payload)
	require.NoError(t, err)
	assert.Equal(t, expectedPayload, string(payloadBytes))
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

	_, port := setupListeningServer(t)
	conn := connectedWebsocket(t, port)
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
	_, port := setupListeningServer(t)
	conn := connectedWebsocket(t, port)
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

func TestShutdownWithActiveWebsocket(t *testing.T) {
	server, port := setupListeningServer(t)
	conn := connectedWebsocket(t, port)
	var err error
	const messageID = "1"
	err = conn.WriteJSON(&wsMessage{
		ID:      messageID,
		Type:    "subscribe",
		Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
	})
	require.NoError(t, err)
	// Discard the first message
	var msg wsMessage
	err = connReadJSON(conn, &msg)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, server.Shutdown(ctx))
	_, _, err = conn.NextReader()
	// Check that the WS client error indicates the connection was unexpectedly closed
	cerr, ok := err.(*websocket.CloseError)
	require.True(t, ok)
	assert.Equal(t, websocket.CloseAbnormalClosure, cerr.Code)
}

func TestSubscriptionsOverWebsocketLibrary(t *testing.T) {
	var subscription struct {
		CurrentTime struct {
			UnixTime  float64 `graphql:"unixTime"`
			Timestamp string  `graphql:"timeStamp"`
		} `graphql:"currentTime"`
	}
	_, port := setupListeningServer(t)
	subscriptionURL := fmt.Sprintf("ws://localhost:%d/graphql", port)
	protocols := []graphql.SubscriptionProtocolType{
		graphql.GraphQLWS,
		graphql.SubscriptionsTransportWS,
	}
	for _, p := range protocols {
		p := p
		t.Run(string(p), func(t *testing.T) {
			client := graphql.NewSubscriptionClient(subscriptionURL).WithProtocol(p)
			t.Cleanup(func() {
				err := client.Close()
				assert.NoError(t, err)
			})
			var firstTime float64
			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				data := subscription
				err := jsonutil.UnmarshalGraphQL(dataValue, &data)
				require.NoError(t, err)
				if firstTime == 0 {
					firstTime = data.CurrentTime.UnixTime
				} else {
					assert.Equal(t, firstTime+1, data.CurrentTime.UnixTime)
					return graphql.ErrSubscriptionStopped
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)
			require.NoError(t, client.Run())
		})
	}
}
