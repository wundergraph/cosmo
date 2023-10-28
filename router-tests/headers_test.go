package integration_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestForwardHeaders(t *testing.T) {
	const (
		headerName   = "foo" // Make sure you copy this to the struct tag in the subscription test
		headerValue  = "bar"
		headerValue2 = "baz"

		subscriptionPayload = `{"query": "subscription { headerValue(name:\"foo\", repeat:3) { value }}"}`
	)

	headerRules := config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
				{
					Operation: "propagate",
					Named:     headerName,
				},
			},
		},
	}
	server, serverPort := setupListeningServer(t, core.WithHeaderRules(headerRules))

	t.Run("HTTP", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query": "query { headerValue(name:\"`+headerName+`\") }"}`))
		req.Header.Add(headerName, headerValue)
		server.Server.Handler.ServeHTTP(rr, req)
		assert.Equal(t, `{"data":{"headerValue":"`+headerValue+`"}}`, rr.Body.String())
	})

	t.Run("ws", func(t *testing.T) {
		header := http.Header{
			headerName: []string{headerValue},
		}
		conn := connectedWebsocket(t, serverPort, header)
		err := conn.WriteJSON(&wsMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: []byte(subscriptionPayload),
		})
		assert.NoError(t, err)
		var msg wsMessage
		err = connReadJSON(conn, &msg)
		require.NoError(t, err)
		assert.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue+`"}}}`, string(msg.Payload))
	})

	t.Run("ws with multiple conns", func(t *testing.T) {
		header1 := http.Header{
			headerName: []string{headerValue},
		}
		header2 := http.Header{
			headerName: []string{headerValue2},
		}
		conn1 := connectedWebsocket(t, serverPort, header1)
		conn2 := connectedWebsocket(t, serverPort, header2)
		var err error
		err = conn1.WriteJSON(&wsMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: []byte(subscriptionPayload),
		})
		assert.NoError(t, err)
		err = conn2.WriteJSON(&wsMessage{
			ID:      "2",
			Type:    "subscribe",
			Payload: []byte(subscriptionPayload),
		})
		assert.NoError(t, err)
		var msg wsMessage
		// Must match the 3 in the subscription payload
		for ii := 0; ii < 3; ii++ {
			err = connReadJSON(conn1, &msg)
			require.NoError(t, err)
			assert.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue+`"}}}`, string(msg.Payload))

			err = connReadJSON(conn2, &msg)
			require.NoError(t, err)
			assert.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue2+`"}}}`, string(msg.Payload))
		}
	})

}
