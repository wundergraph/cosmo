package integration

import (
	"context"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// Pings and subscriptions work while another connection holds an incomplete frame.
func TestWebSocketIncompleteFrame(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.WebSocketServerReadTimeout = 30 * time.Second
		},
	}, func(t *testing.T, env *testenv.Environment) {
		pending := env.InitGraphQLWebSocketConnection(nil, nil, nil)
		// One header byte makes the socket readable without completing a frame.
		require.NoError(t, pending.UnderlyingConn().SetWriteDeadline(time.Now().Add(time.Second)))
		_, err := pending.UnderlyingConn().Write([]byte{0x81})
		require.NoError(t, err)

		healthy := env.InitGraphQLWebSocketConnection(nil, nil, nil)
		// Finish well within the read timeout of the pending frame.
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		defer cancel()
		stop := context.AfterFunc(ctx, func() { _ = healthy.Close() })
		defer stop()
		for range 3 {
			require.NoError(t, testenv.WSWriteJSON(t, healthy, testenv.WebSocketMessage{Type: "ping"}))
			var pong testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, healthy, &pong))
			require.Equal(t, "pong", pong.Type)
		}
		require.NoError(t, testenv.WSWriteJSON(t, healthy, testenv.WebSocketMessage{
			ID: "1", Type: "subscribe",
			Payload: []byte(`{"query":"subscription { countEmp(max: 100, intervalMilliseconds: 100) }"}`),
		}))
		var next testenv.WebSocketMessage
		require.NoError(t, testenv.WSReadJSON(t, healthy, &next))
		require.Equal(t, "next", next.Type)
		require.Equal(t, "1", next.ID)
		env.WaitForSubscriptionCount(1, time.Second)
		require.NoError(t, testenv.WSWriteJSON(t, healthy, testenv.WebSocketMessage{ID: "1", Type: "complete"}))
		env.WaitForSubscriptionCount(0, time.Second)
		require.NoError(t, ctx.Err())
	})
}

func TestWebSocketShutdownWithoutReadTimeout(t *testing.T) {
	t.Parallel()
	for _, state := range []string{"initializing", "idle", "partial"} {
		t.Run(state, func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.WebSocketServerReadTimeout = 0
				},
			}, func(t *testing.T, env *testenv.Environment) {
				var conn *websocket.Conn
				if state == "initializing" {
					var err error
					conn, _, err = env.GraphQLWebsocketDialWithRetry(nil, nil)
					require.NoError(t, err)
					t.Cleanup(func() { _ = conn.Close() })
				} else {
					conn = env.InitGraphQLWebSocketConnection(nil, nil, nil)
					env.WaitForConnectionCount(1, time.Second)
				}
				if state == "partial" {
					require.NoError(t, conn.UnderlyingConn().SetWriteDeadline(time.Now().Add(time.Second)))
					_, err := conn.UnderlyingConn().Write([]byte{0x81})
					require.NoError(t, err)
				}
				env.Shutdown()
				require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
				// Initialization may emit a protocol error before the close frame.
				for {
					_, _, err := conn.ReadMessage()
					if err == nil {
						continue
					}
					var closeErr *websocket.CloseError
					require.ErrorAs(t, err, &closeErr)
					require.Equal(t, websocket.CloseGoingAway, closeErr.Code)
					break
				}
				env.WaitForConnectionCount(0, time.Second)
			})
		})
	}
}
