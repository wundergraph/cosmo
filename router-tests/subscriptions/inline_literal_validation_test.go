package integration

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// TestSubscriptionInlineLiteralValidation covers ENG-9820 for the subscription
// request pipeline (websocket.go / buildOperation), which validates operations
// through a separate code path from the HTTP request handler.
//
// An unquoted enum literal used for a String argument must be rejected before
// the subscription is started, with the same schema-validation message the
// query path produces.
func TestSubscriptionInlineLiteralValidation(t *testing.T) {
	t.Parallel()

	t.Run("rejects unquoted enum literal for String argument", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { headerValue(name: hello) { value } }"}`),
			})
			require.NoError(t, err)
			require.NoError(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))

			var msg testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.Equal(t, "error", msg.Type)

			var errs []testenv.GraphQLError
			require.NoError(t, json.Unmarshal(msg.Payload, &errs))
			require.Len(t, errs, 1)
			require.Equal(t, `String cannot represent a non string value: hello`, errs[0].Message)
		})
	})

	t.Run("accepts quoted string literal for String argument", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { headerValue(name: \"foo\", repeat: 1) { value } }"}`),
			})
			require.NoError(t, err)
			require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))

			var msg testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			// A valid subscription yields a "next" message, not an "error".
			require.Equal(t, "next", msg.Type)
		})
	})
}
