package speedtrap

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
)

func TestBackend(t *testing.T) {
	t.Run("standalone accepts and upgrades connection", func(t *testing.T) {
		b, err := StartBackend()
		require.NoError(t, err)
		t.Cleanup(b.Stop)

		dialer := ws.Dialer{
			Header: ws.HandshakeHeaderHTTP(http.Header{
				"X-Test": {"hello"},
			}),
		}
		conn, _, _, err := dialer.Dial(context.Background(), "ws://"+b.Addr())
		require.NoError(t, err)
		defer conn.Close()

		handle, err := b.Accept()
		require.NoError(t, err)

		require.NotNil(t, handle.UpgradeHeaders)
		require.Equal(t, "hello", handle.UpgradeHeaders.Get("X-Test"))

		err = handle.Send("hello")
		require.NoError(t, err)
	})

	t.Run("standalone captures upgrade headers", func(t *testing.T) {
		b, err := StartBackend()
		require.NoError(t, err)
		t.Cleanup(b.Stop)

		dialer := ws.Dialer{
			Header: ws.HandshakeHeaderHTTP(map[string][]string{"X-Test": {"hello"}}),
		}
		conn, _, _, err := dialer.Dial(context.Background(), "ws://"+b.Addr())
		require.NoError(t, err)
		defer conn.Close()

		handle, err := b.Accept()
		require.NoError(t, err)

		got := handle.UpgradeHeaders.Get("X-Test")
		require.Equal(t, "hello", got)
	})

	t.Run("handler mode accepts and upgrades connection", func(t *testing.T) {
		b := NewBackend()

		srv := httptest.NewServer(b.Handler())
		defer srv.Close()

		addr := strings.TrimPrefix(srv.URL, "http://")
		dialer := ws.Dialer{}
		conn, _, _, err := dialer.Dial(context.Background(), "ws://"+addr)
		require.NoError(t, err)
		defer conn.Close()

		handle, err := b.Accept()
		require.NoError(t, err)

		require.NotNil(t, handle.UpgradeHeaders)

		err = handle.Send("hello")
		require.NoError(t, err)
	})

	t.Run("accept returns error on timeout", func(t *testing.T) {
		b, err := StartBackend(WithTimeout(50 * time.Millisecond))
		require.NoError(t, err)
		t.Cleanup(b.Stop)

		// No connections made — Accept should time out
		_, err = b.Accept()
		require.Error(t, err)
	})

	t.Run("accept returns error after stop", func(t *testing.T) {
		b, err := StartBackend()
		require.NoError(t, err)

		b.Stop()

		_, err = b.Accept()
		require.Error(t, err)
	})

	t.Run("options apply addr, subprotocol, and timeout", func(t *testing.T) {
		b, err := StartBackend(
			WithAddr("127.0.0.1:0"),
			WithSubprotocol("graphql-ws"),
			WithTimeout(1*time.Second),
		)
		require.NoError(t, err)
		t.Cleanup(b.Stop)

		require.Equal(t, []string{"graphql-ws"}, b.subprotocols)
		require.Equal(t, 1*time.Second, b.timeout)

		dialer := ws.Dialer{
			Protocols: []string{"graphql-ws"},
		}
		conn, _, _, err := dialer.Dial(context.Background(), "ws://"+b.Addr())
		require.NoError(t, err)
		defer conn.Close()

		_, err = b.Accept()
		require.NoError(t, err)
	})
}
