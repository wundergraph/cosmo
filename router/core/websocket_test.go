package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"testing"
	"testing/synctest"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
)

// The tests below run in synctest bubbles: net.Pipe deadlines follow the bubble's
// fake clock, so timeouts are exact and cost no wall-clock time.

func websocketTestConnection(t *testing.T, ctx context.Context, timeout time.Duration) (*wsConnectionWrapper, net.Conn) {
	t.Helper()
	server, client := net.Pipe()
	t.Cleanup(func() { _ = client.Close() })
	conn := newWSConnectionWrapper(ctx, server, timeout, time.Second)
	t.Cleanup(func() { _ = conn.Close() })
	// A read that never returns would deadlock the bubble and abort the whole
	// test binary. Close both ends after an hour of fake time so it fails this test instead.
	watchdog := time.AfterFunc(time.Hour, func() {
		_ = conn.Close()
		_ = client.Close()
	})
	t.Cleanup(func() { watchdog.Stop() })
	return conn, client
}

func clientFrame(op ws.OpCode, final bool, payload string) []byte {
	return ws.MustCompileFrame(ws.MaskFrameInPlace(ws.NewFrame(op, final, []byte(payload))))
}

func assertTimeout(t *testing.T, err error) {
	t.Helper()
	require.NotErrorIs(t, err, errWebsocketIdleTimeout)
	var netErr net.Error
	require.ErrorAs(t, err, &netErr)
	require.True(t, netErr.Timeout())
}

func TestWebsocketReadJSON(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		frames []byte
	}{
		{"text", clientFrame(ws.OpText, true, `{"type":"ping"}`)},
		{"fragmented", append(clientFrame(ws.OpText, false, `{"type":`), clientFrame(ws.OpContinuation, true, `"ping"}`)...)},
		{"binary then text", append(clientFrame(ws.OpBinary, true, "ignored"), clientFrame(ws.OpText, true, `{"type":"ping"}`)...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				conn, client := websocketTestConnection(t, t.Context(), time.Second)
				written := make(chan error, 1)
				go func() { _, err := client.Write(tc.frames); written <- err }()
				var msg map[string]string
				require.NoError(t, conn.ReadJSON(&msg))
				require.Equal(t, "ping", msg["type"])
				require.NoError(t, <-written)
			})
		})
	}
}

func TestWebsocketIdleTimeoutCanRetry(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		const timeout = 5 * time.Second
		conn, client := websocketTestConnection(t, t.Context(), timeout)
		start := time.Now()
		var msg json.RawMessage
		require.ErrorIs(t, conn.ReadJSON(&msg), errWebsocketIdleTimeout)
		require.Equal(t, timeout, time.Since(start))
		written := make(chan error, 1)
		go func() { _, err := client.Write(clientFrame(ws.OpText, true, `{}`)); written <- err }()
		require.NoError(t, conn.ReadJSON(&msg))
		require.JSONEq(t, `{}`, string(msg))
		require.NoError(t, <-written)
	})
}

func TestWebsocketInitializedConnectionHasNoIdleTimeout(t *testing.T) {
	t.Parallel()
	const timeout = 5 * time.Second
	t.Run("idle", func(t *testing.T) {
		t.Parallel()
		synctest.Test(t, func(t *testing.T) {
			conn, client := websocketTestConnection(t, t.Context(), timeout)
			conn.initialized = true
			result := make(chan error, 1)
			go func() { var msg json.RawMessage; result <- conn.ReadJSON(&msg) }()
			time.Sleep(10 * timeout)
			synctest.Wait()
			require.Empty(t, result, "idle read returned before any data arrived")
			_, err := client.Write(clientFrame(ws.OpText, true, `{}`))
			require.NoError(t, err)
			require.NoError(t, <-result)
		})
	})
	t.Run("partial", func(t *testing.T) {
		t.Parallel()
		synctest.Test(t, func(t *testing.T) {
			conn, client := websocketTestConnection(t, t.Context(), timeout)
			conn.initialized = true
			written := make(chan error, 1)
			go func() { _, err := client.Write([]byte{0x81}); written <- err }()
			start := time.Now()
			var msg json.RawMessage
			assertTimeout(t, conn.ReadJSON(&msg))
			require.Equal(t, timeout, time.Since(start))
			require.NoError(t, <-written)
		})
	})
}

func TestWebsocketReadTimeoutStartsAtFirstByte(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		const timeout = 5 * time.Second
		conn, client := websocketTestConnection(t, t.Context(), timeout)
		conn.initialized = true
		frame := clientFrame(ws.OpText, true, `{"type":"ping"}`)
		result := make(chan error, 1)
		go func() {
			var msg map[string]string
			err := conn.ReadJSON(&msg)
			if err == nil && msg["type"] != "ping" {
				err = fmt.Errorf("unexpected message: %v", msg)
			}
			result <- err
		}()
		// The first byte arrives 1s before the idle deadline; the rest arrives
		// after it, but within the timeout counted from the first byte.
		time.Sleep(timeout - time.Second)
		_, err := client.Write(frame[:1])
		require.NoError(t, err)
		time.Sleep(timeout - time.Second)
		synctest.Wait()
		select {
		case err := <-result:
			t.Fatalf("read ended before the message completed: %v", err)
		default:
		}
		_, err = client.Write(frame[1:])
		require.NoError(t, err)
		require.NoError(t, <-result)
	})
}

func TestWebsocketInitializationDeadline(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		frames []byte
		pong   bool
	}{
		{"ping", clientFrame(ws.OpPing, true, "heartbeat"), true},
		{"pong", clientFrame(ws.OpPong, true, "heartbeat"), false},
		{"binary", clientFrame(ws.OpBinary, true, "ignored"), false},
		{"fragmented binary", append(clientFrame(ws.OpBinary, false, "ignored"), clientFrame(ws.OpContinuation, true, "ignored")...), false},
		{"partial initialization", clientFrame(ws.OpText, false, `{"type":"connection_init"`), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				const timeout = 5 * time.Second
				conn, client := websocketTestConnection(t, t.Context(), timeout)
				written := make(chan error, 1)
				go func() {
					time.Sleep(timeout - time.Second)
					_, err := client.Write(tc.frames)
					if err == nil && tc.pong {
						var pong ws.Frame
						pong, err = ws.ReadFrame(client)
						if err == nil && pong.Header.OpCode != ws.OpPong {
							err = fmt.Errorf("expected pong, got %v", pong.Header.OpCode)
						}
					}
					written <- err
				}()
				start := time.Now()
				var msg json.RawMessage
				require.Error(t, conn.ReadJSON(&msg))
				require.Equal(t, timeout, time.Since(start), "frames before connection_init must not extend its deadline")
				require.NoError(t, <-written)
			})
		})
	}
}

func TestWebsocketPartialMessageTimeoutCannotRetry(t *testing.T) {
	t.Parallel()
	frame := clientFrame(ws.OpText, true, `{"type":"ping"}`)
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"header", frame[:1]},
		{"payload", frame[:len(frame)-1]},
		{"continuation", clientFrame(ws.OpText, false, `{"type":`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				const timeout = 5 * time.Second
				conn, client := websocketTestConnection(t, t.Context(), timeout)
				written := make(chan error, 1)
				go func() { _, err := client.Write(tc.data); written <- err }()
				start := time.Now()
				var msg json.RawMessage
				assertTimeout(t, conn.ReadJSON(&msg))
				require.Equal(t, timeout, time.Since(start))
				require.NoError(t, <-written)
			})
		})
	}
}

func TestWebsocketControlFrames(t *testing.T) {
	t.Parallel()
	for _, fragmented := range []bool{false, true} {
		t.Run(map[bool]string{false: "idle", true: "fragmented"}[fragmented], func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				conn, client := websocketTestConnection(t, t.Context(), time.Second)
				result := make(chan error, 1)
				go func() {
					var msg map[string]string
					err := conn.ReadJSON(&msg)
					if err == nil && msg["type"] != "ping" {
						err = fmt.Errorf("unexpected message: %v", msg)
					}
					result <- err
				}()
				if fragmented {
					_, err := client.Write(clientFrame(ws.OpText, false, `{"type":`))
					require.NoError(t, err)
				}
				_, err := client.Write(clientFrame(ws.OpPing, true, "heartbeat"))
				require.NoError(t, err)
				pong, err := ws.ReadFrame(client)
				require.NoError(t, err)
				require.Equal(t, ws.OpPong, pong.Header.OpCode)
				require.Equal(t, "heartbeat", string(pong.Payload))
				if fragmented {
					_, err = client.Write(clientFrame(ws.OpContinuation, true, `"ping"}`))
				} else {
					_, err = client.Write(clientFrame(ws.OpText, true, `{"type":"ping"}`))
				}
				require.NoError(t, err)
				require.NoError(t, <-result)
			})
		})
	}
}

func TestWebsocketCancellationInterruptsRead(t *testing.T) {
	t.Parallel()
	for _, partial := range []bool{false, true} {
		t.Run(map[bool]string{false: "idle", true: "partial"}[partial], func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				// No read timeout: only cancellation can end the read.
				conn, client := websocketTestConnection(t, ctx, 0)
				result := make(chan error, 1)
				go func() { var msg json.RawMessage; result <- conn.ReadJSON(&msg) }()
				if partial {
					_, err := client.Write([]byte{0x81})
					require.NoError(t, err)
				}
				synctest.Wait()
				require.Empty(t, result, "read returned before cancellation")
				cancel()
				synctest.Wait()
				select {
				case err := <-result:
					require.Error(t, err)
				default:
					t.Fatal("cancellation did not interrupt the read")
				}
			})
		})
	}
}
