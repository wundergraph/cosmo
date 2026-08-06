package speedtrap

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
)

const testTimeout = 2 * time.Second

// connectedPair creates a WebSocket-upgraded pair of ConnectionHandles
// using a local TCP listener and gobwas/ws Dialer+Upgrader.
func connectedPair(t *testing.T) (client, server *ConnectionHandle) {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { ln.Close() })

	type result struct {
		handle *ConnectionHandle
		err    error
	}

	serverCh := make(chan result, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			serverCh <- result{err: err}
			return
		}

		headers := make(http.Header)
		u := ws.Upgrader{
			OnHeader: func(key, value []byte) error {
				headers.Add(string(key), string(value))
				return nil
			},
		}

		hs, err := u.Upgrade(conn)
		if err != nil {
			conn.Close()
			serverCh <- result{err: err}
			return
		}

		h := newConnectionHandle(conn, ws.StateServerSide, hs, headers, testTimeout)
		serverCh <- result{handle: h}
	}()

	dialer := ws.Dialer{}
	conn, _, hs, err := dialer.Dial(context.Background(), "ws://"+ln.Addr().String())
	require.NoError(t, err)

	clientHandle := newConnectionHandle(conn, ws.StateClientSide, hs, nil, testTimeout)

	res := <-serverCh
	require.NoError(t, res.err)

	t.Cleanup(func() {
		clientHandle.Drop()
		res.handle.Drop()
	})

	return clientHandle, res.handle
}

func TestConnectionHandle(t *testing.T) {
	t.Run("handshake captures negotiated protocol for client", func(t *testing.T) {
		b, err := StartBackend(WithSubprotocol("test"))
		require.NoError(t, err)
		t.Cleanup(b.Stop)

		dialer := ws.Dialer{
			Protocols: []string{"test"},
		}
		conn, _, hs, err := dialer.Dial(context.Background(), "ws://"+b.Addr())
		require.NoError(t, err)

		client := newConnectionHandle(conn, ws.StateClientSide, hs, nil, testTimeout)
		t.Cleanup(func() { client.Drop() })

		require.Equal(t, "test", client.Handshake.Protocol)
	})

	t.Run("upgrade headers are captured for backend", func(t *testing.T) {
		b, err := StartBackend()
		require.NoError(t, err)
		t.Cleanup(b.Stop)

		dialer := ws.Dialer{
			Header: ws.HandshakeHeaderHTTP(map[string][]string{"X-Custom": {"test-value"}}),
		}
		conn, _, _, err := dialer.Dial(context.Background(), "ws://"+b.Addr())
		require.NoError(t, err)
		defer conn.Close()

		handle, err := b.Accept()
		require.NoError(t, err)

		require.Equal(t, "test-value", handle.UpgradeHeaders.Get("X-Custom"))
	})

	t.Run("send delivers message to other side", func(t *testing.T) {
		client, server := connectedPair(t)

		err := client.Send(`{"type":"hello"}`)
		require.NoError(t, err)

		msg, err := server.Read()
		require.NoError(t, err)
		require.Equal(t, `{"type":"hello"}`, msg)

		err = server.Send(`{"type":"world"}`)
		require.NoError(t, err)

		msg, err = client.Read()
		require.NoError(t, err)
		require.Equal(t, `{"type":"world"}`, msg)
	})

	t.Run("send close delivers code and reason to other side", func(t *testing.T) {
		client, server := connectedPair(t)

		err := server.SendClose(4400, "rate limited")
		require.NoError(t, err)

		cf, err := client.ReadControl()
		require.NoError(t, err)

		require.Equal(t, ws.OpClose, cf.OpCode)

		code, reason := cf.CloseData()
		require.Equal(t, ws.StatusCode(4400), code)
		require.Equal(t, "rate limited", reason)
	})

	t.Run("drop closes connection and terminates read loop", func(t *testing.T) {
		client, server := connectedPair(t)

		err := client.Drop()
		require.NoError(t, err)

		select {
		case <-server.done:
			// expected
		case <-time.After(testTimeout):
			t.Fatal("readLoop did not terminate after Drop")
		}
	})

	t.Run("read returns buffered messages when multiple sent before reading", func(t *testing.T) {
		client, server := connectedPair(t)

		for i := range 5 {
			msg := fmt.Sprintf(`{"n":%d}`, i)
			err := client.Send(msg)
			require.NoError(t, err)
		}

		time.Sleep(50 * time.Millisecond)

		for range 5 {
			_, err := server.Read()
			require.NoError(t, err)
		}
	})

	t.Run("read returns error after connection dropped", func(t *testing.T) {
		client, server := connectedPair(t)

		err := server.Drop()
		require.NoError(t, err)

		// Wait for readLoop to detect the close
		<-client.done

		_, err = client.Read()
		require.Error(t, err)
	})

	t.Run("read returns error on timeout", func(t *testing.T) {
		shortTimeout := 50 * time.Millisecond

		ln, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		t.Cleanup(func() { ln.Close() })

		serverCh := make(chan *ConnectionHandle, 1)
		go func() {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			u := ws.Upgrader{}
			hs, err := u.Upgrade(conn)
			if err != nil {
				conn.Close()
				return
			}
			serverCh <- newConnectionHandle(conn, ws.StateServerSide, hs, nil, shortTimeout)
		}()

		dialer := ws.Dialer{}
		conn, _, hs, err := dialer.Dial(context.Background(), "ws://"+ln.Addr().String())
		require.NoError(t, err)
		t.Cleanup(func() { conn.Close() })

		client := newConnectionHandle(conn, ws.StateClientSide, hs, nil, shortTimeout)
		t.Cleanup(func() { client.Drop() })

		server := <-serverCh
		t.Cleanup(func() { server.Drop() })

		// No messages sent — Read should time out
		_, err = client.Read()
		require.Error(t, err)
	})

	t.Run("read control returns error on timeout", func(t *testing.T) {
		shortTimeout := 50 * time.Millisecond

		ln, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		t.Cleanup(func() { ln.Close() })

		serverCh := make(chan *ConnectionHandle, 1)
		go func() {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			u := ws.Upgrader{}
			hs, err := u.Upgrade(conn)
			if err != nil {
				conn.Close()
				return
			}
			serverCh <- newConnectionHandle(conn, ws.StateServerSide, hs, nil, shortTimeout)
		}()

		dialer := ws.Dialer{}
		conn, _, hs, err := dialer.Dial(context.Background(), "ws://"+ln.Addr().String())
		require.NoError(t, err)
		t.Cleanup(func() { conn.Close() })

		client := newConnectionHandle(conn, ws.StateClientSide, hs, nil, shortTimeout)
		t.Cleanup(func() { client.Drop() })

		server := <-serverCh
		t.Cleanup(func() { server.Drop() })

		// No control frames sent — ReadControl should time out
		_, err = client.ReadControl()
		require.Error(t, err)
	})
}
