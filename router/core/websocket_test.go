package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
)

func websocketTestConnection(t *testing.T, ctx context.Context, timeout time.Duration) (*wsConnectionWrapper, net.Conn) {
	t.Helper()
	server, client := net.Pipe()
	t.Cleanup(func() { _ = client.Close() })
	conn := newWSConnectionWrapper(ctx, server, timeout, time.Second)
	t.Cleanup(func() { _ = conn.Close() })
	require.NoError(t, client.SetDeadline(time.Now().Add(5*time.Second)))
	return conn, client
}

func clientFrame(op ws.OpCode, final bool, payload string) []byte {
	return ws.MustCompileFrame(ws.MaskFrameInPlace(ws.NewFrame(op, final, []byte(payload))))
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
			conn, client := websocketTestConnection(t, t.Context(), time.Second)
			written := make(chan error, 1)
			go func() { _, err := client.Write(tc.frames); written <- err }()
			var msg map[string]string
			require.NoError(t, conn.ReadJSON(&msg))
			require.Equal(t, "ping", msg["type"])
			require.NoError(t, <-written)
		})
	}
}

func TestWebsocketIdleTimeoutCanRetry(t *testing.T) {
	t.Parallel()
	conn, client := websocketTestConnection(t, t.Context(), 20*time.Millisecond)
	var msg json.RawMessage
	require.ErrorIs(t, conn.ReadJSON(&msg), errWebsocketIdleTimeout)
	written := make(chan error, 1)
	go func() { _, err := client.Write(clientFrame(ws.OpText, true, `{}`)); written <- err }()
	require.NoError(t, conn.ReadJSON(&msg))
	require.JSONEq(t, `{}`, string(msg))
	require.NoError(t, <-written)
}

func TestWebsocketReadTimeoutStartsAtFirstByte(t *testing.T) {
	t.Parallel()
	const timeout = 300 * time.Millisecond
	conn, client := websocketTestConnection(t, t.Context(), timeout)
	frame := clientFrame(ws.OpText, true, `{"type":"ping"}`)
	written := make(chan error, 1)
	go func() {
		// Split the frame across the deadline that was armed for the idle wait.
		time.Sleep(timeout - 50*time.Millisecond)
		if _, err := client.Write(frame[:1]); err != nil {
			written <- err
			return
		}
		time.Sleep(timeout / 2)
		_, err := client.Write(frame[1:])
		written <- err
	}()
	var msg map[string]string
	require.NoError(t, conn.ReadJSON(&msg))
	require.Equal(t, "ping", msg["type"])
	require.NoError(t, <-written)
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
			conn, client := websocketTestConnection(t, t.Context(), 50*time.Millisecond)
			written := make(chan error, 1)
			go func() { _, err := client.Write(tc.data); written <- err }()
			var msg json.RawMessage
			err := conn.ReadJSON(&msg)
			require.Error(t, err)
			require.NotErrorIs(t, err, errWebsocketIdleTimeout)
			var netErr net.Error
			require.ErrorAs(t, err, &netErr)
			require.True(t, netErr.Timeout())
			require.NoError(t, <-written)
		})
	}
}

func TestWebsocketControlFrames(t *testing.T) {
	t.Parallel()
	for _, fragmented := range []bool{false, true} {
		t.Run(map[bool]string{false: "idle", true: "fragmented"}[fragmented], func(t *testing.T) {
			t.Parallel()
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
	}
}

func TestWebsocketCancellationInterruptsRead(t *testing.T) {
	t.Parallel()
	for _, partial := range []bool{false, true} {
		t.Run(map[bool]string{false: "idle", true: "partial"}[partial], func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			conn, client := websocketTestConnection(t, ctx, 0)
			result := make(chan error, 1)
			go func() { var msg json.RawMessage; result <- conn.ReadJSON(&msg) }()
			if partial {
				_, err := client.Write([]byte{0x81})
				require.NoError(t, err)
			}
			cancel()
			select {
			case err := <-result:
				require.Error(t, err)
			case <-time.After(time.Second):
				t.Fatal("cancellation did not interrupt the read")
			}
		})
	}
}
