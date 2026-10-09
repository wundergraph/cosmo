package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"testing"
	"testing/synctest"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The tests below run in synctest bubbles: net.Pipe deadlines follow the bubble's
// fake clock, so timeouts are exact and cost no wall-clock time.

func websocketTestConnection(t *testing.T, ctx context.Context, timeout time.Duration) (*wsConnectionWrapper, net.Conn) {
	t.Helper()
	server, client := net.Pipe()
	t.Cleanup(func() { _ = client.Close() })
	conn := newWSConnectionWrapper(ctx, server, timeout, time.Second, false)
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
	netErr, ok := errors.AsType[net.Error](err)
	require.True(t, ok, "expected net.Error, got %T: %v", err, err)
	assert.True(t, netErr.Timeout())
}

func TestWebsocketReadTimeoutStartsAtFirstByte(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		const timeout = 5 * time.Second
		conn, client := websocketTestConnection(t, t.Context(), timeout)
		conn.reader.MarkInitialized()
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

		// Stay idle across several read timeouts, then start a partial message.
		time.Sleep(10 * timeout)
		synctest.Wait()
		require.Empty(t, result, "idle read returned before any data arrived")

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
		assert.NoError(t, <-result)
	})
}

func TestWebsocketInitializationDeadline(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		frames []byte
		pong   bool
	}{
		{"ping", clientFrame(ws.OpPing, true, "heartbeat"), true},
		{"pong", clientFrame(ws.OpPong, true, "heartbeat"), false},
		{"binary", clientFrame(ws.OpBinary, true, "ignored"), false},
		{"fragmented binary", append(clientFrame(ws.OpBinary, false, "ignored"), clientFrame(ws.OpContinuation, true, "ignored")...), false},
		{"partial initialization", clientFrame(ws.OpText, false, `{"type":"connection_init"`), false},
	}
	for _, tc := range cases {
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
				assert.Equal(t, timeout, time.Since(start), "frames before connection_init must not extend its deadline")
				assert.NoError(t, <-written)
			})
		})
	}
}

func TestWebsocketPartialMessageTimeout(t *testing.T) {
	t.Parallel()
	frame := clientFrame(ws.OpText, true, `{"type":"ping"}`)
	cases := []struct {
		name string
		data []byte
	}{
		{"header", frame[:1]},
		{"payload", frame[:len(frame)-1]},
		{"continuation", clientFrame(ws.OpText, false, `{"type":`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				const timeout = 5 * time.Second
				conn, client := websocketTestConnection(t, t.Context(), timeout)
				conn.reader.MarkInitialized()
				written := make(chan error, 1)
				go func() { _, err := client.Write(tc.data); written <- err }()

				start := time.Now()
				var msg json.RawMessage
				assertTimeout(t, conn.ReadJSON(&msg))
				assert.Equal(t, timeout, time.Since(start))
				assert.NoError(t, <-written)
			})
		})
	}
}

func TestWebsocketFragmentedMessageWithPing(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		conn, client := websocketTestConnection(t, t.Context(), time.Second)
		conn.reader.MarkInitialized()
		var msg map[string]string
		result := make(chan error, 1)
		go func() { result <- conn.ReadJSON(&msg) }()

		_, err := client.Write(clientFrame(ws.OpText, false, `{"type":`))
		require.NoError(t, err)

		_, err = client.Write(clientFrame(ws.OpPing, true, "heartbeat"))
		require.NoError(t, err)

		pong, err := ws.ReadFrame(client)
		require.NoError(t, err)
		assert.Equal(t, ws.OpPong, pong.Header.OpCode)
		assert.Equal(t, "heartbeat", string(pong.Payload))

		_, err = client.Write(clientFrame(ws.OpContinuation, true, `"ping"}`))
		require.NoError(t, err)
		require.NoError(t, <-result)
		assert.Equal(t, "ping", msg["type"])
	})
}

func TestWebsocketControlWriteTimeoutStartsAfterPayload(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		conn, client := websocketTestConnection(t, t.Context(), 5*time.Second)
		result := make(chan error, 1)
		go func() { var msg json.RawMessage; result <- conn.ReadJSON(&msg) }()

		frame := clientFrame(ws.OpPing, true, "x")
		_, err := client.Write(frame[:len(frame)-1])
		require.NoError(t, err)

		time.Sleep(2 * time.Second) // Longer than the 1s write timeout, within the 5s read timeout.
		_, err = client.Write(frame[len(frame)-1:])
		require.NoError(t, err)
		require.NoError(t, client.SetReadDeadline(time.Now().Add(time.Second)))

		pong, err := ws.ReadFrame(client)
		require.NoError(t, err)
		assert.Equal(t, ws.OpPong, pong.Header.OpCode)
		assert.Equal(t, "x", string(pong.Payload))

		_, err = client.Write(clientFrame(ws.OpText, true, `{}`))
		require.NoError(t, err)
		assert.NoError(t, <-result)
	})
}

func TestWebsocketCloseInterruptsWriter(t *testing.T) {
	cases := []struct {
		name       string
		useNetPoll bool
	}{
		{name: "goroutine", useNetPoll: false},
		{name: "netpoll", useNetPoll: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, client := net.Pipe()
			conn := newWSConnectionWrapper(t.Context(), server, 0, 0, tc.useNetPoll)
			t.Cleanup(func() {
				_ = conn.Close()
				_ = client.Close()
			})

			result := make(chan error, 1)
			go func() { result <- conn.WriteText("blocked") }()
			require.Eventually(t, func() bool {
				if conn.mu.TryLock() {
					conn.mu.Unlock()
					return false
				}
				return true
			}, time.Second, time.Millisecond)

			closed := make(chan error, 1)
			go func() { closed <- conn.Close() }()
			select {
			case err := <-closed:
				require.NoError(t, err)
			case <-time.After(time.Second):
				_ = conn.conn.Close()
				<-closed
				t.Fatal("Close blocked behind a writer without a timeout")
			}

			assert.Error(t, <-result)
		})
	}
}

func TestWebsocketIdleAfterTraffic(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		op           ws.OpCode
		initializing bool
	}{
		{"initialization", ws.OpText, true},
		{"text", ws.OpText, false},
		{"ping", ws.OpPing, false},
		{"pong", ws.OpPong, false},
		{"binary", ws.OpBinary, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				const timeout = 5 * time.Second
				conn, client := websocketTestConnection(t, t.Context(), timeout)
				if !tc.initializing {
					conn.reader.MarkInitialized()
				}
				result := make(chan error, 1)
				read := func() { var msg json.RawMessage; result <- conn.ReadJSON(&msg) }
				go read()
				_, err := client.Write(clientFrame(tc.op, true, `{}`))
				require.NoError(t, err)

				if tc.op == ws.OpPing {
					pong, err := ws.ReadFrame(client)
					require.NoError(t, err)
					assert.Equal(t, ws.OpPong, pong.Header.OpCode)
				}

				if tc.op == ws.OpText {
					require.NoError(t, <-result)

					conn.reader.MarkInitialized()
					go read()
				}

				// Both a new ReadJSON call and its control/binary frame loop
				// must clear the previous frame's deadline before waiting idle.
				time.Sleep(10 * timeout)
				synctest.Wait()
				require.Empty(t, result, "previous traffic left an idle read deadline")

				_, err = client.Write(clientFrame(ws.OpText, true, `{}`))
				require.NoError(t, err)
				assert.NoError(t, <-result)
			})
		})
	}
}

func TestWebsocketReadAfterCancellation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		initialized bool
	}{
		{name: "initializing", initialized: false},
		{name: "initialized", initialized: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				conn, _ := websocketTestConnection(t, ctx, 5*time.Second)
				if tc.initialized {
					conn.reader.MarkInitialized()
				}
				cancel()
				synctest.Wait() // Let cancellation set its interrupting deadline first.
				result := make(chan error, 1)
				go func() { var msg json.RawMessage; result <- conn.ReadJSON(&msg) }()
				synctest.Wait()
				select {
				case err := <-result:
					assert.ErrorIs(t, err, context.Canceled)
				default:
					t.Fatal("new read overwrote cancellation and blocked")
				}
			})
		})
	}
}
