package integration

import (
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestWebSocketGoroutineShutdownWithoutReadTimeout(t *testing.T) {
	t.Parallel()

	newConfig := func() *testenv.Config {
		return &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableNetPoll = false
				cfg.WebSocketServerReadTimeout = 0
			},
		}
	}

	assertGoingAway := func(t *testing.T, conn *websocket.Conn) {
		t.Helper()
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))

		// Initialization may emit a protocol error before the close frame.
		for {
			_, _, err := conn.ReadMessage()
			if err == nil {
				continue
			}
			assert.True(t, websocket.IsCloseError(err, websocket.CloseGoingAway), "expected going-away close, got %v", err)
			return
		}
	}

	t.Run("before initialization", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, newConfig(), func(t *testing.T, env *testenv.Environment) {
			conn, resp, err := env.GraphQLWebsocketDialWithRetry(nil, nil)
			require.NoError(t, err)

			t.Cleanup(func() {
				_ = resp.Body.Close()
				_ = conn.Close()
			})

			env.Shutdown()
			assertGoingAway(t, conn)
			env.WaitForConnectionCount(0, time.Second)
		})
	})

	t.Run("idle connection", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, newConfig(), func(t *testing.T, env *testenv.Environment) {
			conn := env.InitGraphQLWebSocketConnection(nil, nil, nil)
			env.WaitForConnectionCount(1, time.Second)

			env.Shutdown()
			assertGoingAway(t, conn)
			env.WaitForConnectionCount(0, time.Second)
		})
	})

	t.Run("partial frame", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, newConfig(), func(t *testing.T, env *testenv.Environment) {
			conn := env.InitGraphQLWebSocketConnection(nil, nil, nil)
			env.WaitForConnectionCount(1, time.Second)

			require.NoError(t, conn.UnderlyingConn().SetWriteDeadline(time.Now().Add(time.Second)))
			_, err := conn.UnderlyingConn().Write([]byte{0x81})
			require.NoError(t, err)

			env.Shutdown()
			assertGoingAway(t, conn)
			env.WaitForConnectionCount(0, time.Second)
		})
	})
}

func TestWebSocketGoroutinePartialPongDoesNotStallSharedTrigger(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableNetPoll = false
			cfg.WebSocketServerReadTimeout = 0
			cfg.WebSocketServerWriteTimeout = 100 * time.Millisecond
		},
	}, func(t *testing.T, env *testenv.Environment) {
		pending := env.InitGraphQLWebSocketConnection(nil, nil, nil)
		healthy := env.InitGraphQLWebSocketConnection(nil, nil, nil)
		sub := testenv.WebSocketMessage{ID: "1", Type: "subscribe", Payload: []byte(`{"query":"subscription { countEmp(max: 10000, intervalMilliseconds: 20) }"}`)}
		require.NoError(t, testenv.WSWriteJSON(t, pending, sub))
		require.NoError(t, testenv.WSWriteJSON(t, healthy, sub))
		env.WaitForSubscriptionCount(2, time.Second)
		env.WaitForTriggerCount(1, time.Second)
		readerDone := make(chan struct{})
		go func() {
			defer close(readerDone)
			// Bound this drain loop directly: closure is expected during cleanup.
			_ = pending.SetReadDeadline(time.Now().Add(5 * time.Second))
			for {
				if _, _, err := pending.ReadMessage(); err != nil {
					return
				}
			}
		}()
		defer func() {
			_ = pending.Close()
			<-readerDone
		}()
		// A missing update is the regression under test, so fail on its first timeout.
		require.NoError(t, healthy.SetReadDeadline(time.Now().Add(time.Second)))
		_, _, err := healthy.ReadMessage()
		require.NoError(t, err)
		_, err = pending.UnderlyingConn().Write([]byte{0x8a, 0x81, 0, 0, 0, 0})
		require.NoError(t, err)
		require.NoError(t, healthy.SetReadDeadline(time.Now().Add(time.Second)))
		for i := range 10 {
			_, _, err = healthy.ReadMessage()
			require.NoError(t, err, "healthy subscriber stalled after %d updates", i)
		}
	})
}

// Frames sent together must remain readable in both connection-handling paths.
// A buffered reader accidentally enabled for netpoll could hide the next frame
// from socket readiness notifications.
func TestWebSocketPipelinedMessages(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		netpoll bool
	}{
		{name: "netpoll", netpoll: true},
		{name: "goroutine", netpoll: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) { cfg.EnableNetPoll = tc.netpoll },
			}, func(t *testing.T, env *testenv.Environment) {
				conn := env.InitGraphQLWebSocketConnection(nil, nil, nil)
				var frames []byte
				for range 3 {
					frame := ws.MaskFrameInPlace(ws.NewTextFrame([]byte(`{"type":"ping"}`)))
					frames = append(frames, ws.MustCompileFrame(frame)...)
				}
				require.NoError(t, conn.UnderlyingConn().SetWriteDeadline(time.Now().Add(time.Second)))
				_, err := conn.UnderlyingConn().Write(frames)
				require.NoError(t, err)
				for range 3 {
					var pong testenv.WebSocketMessage
					require.NoError(t, testenv.WSReadJSON(t, conn, &pong))
					assert.Equal(t, "pong", pong.Type)
				}
			})
		})
	}
}
