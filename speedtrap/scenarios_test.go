package speedtrap

import (
	"net/http"
	"testing"

	"github.com/gobwas/ws"
	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
)

const testSubprotocol = "test"

// directConfig returns a HarnessConfig that points the client directly at a
// standalone backend (no proxy). The backend address is used as ProxyAddr so
// that t.Client dials the backend's listener.
func directConfig(t *testing.T) (HarnessConfig, *Backend) {
	t.Helper()
	b, err := StartBackend(WithSubprotocol(testSubprotocol))
	require.NoError(t, err)
	t.Cleanup(b.Stop)

	cfg := HarnessConfig{
		ProxyAddr: "ws://" + b.Addr(),
		Backends: map[string]*Backend{
			"default": b,
		},
	}
	return cfg, b
}

func TestRunScenario(t *testing.T) {
	t.Run("relays messages in both directions", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "message relay",
			Run: func(st *S) {
				c, err := st.Client(WithClientSubprotocol(testSubprotocol))
				require.NoError(st, err, "dial")

				b, err := st.Backend("default").Accept()
				require.NoError(st, err, "accept")

				// Send message from client to backend
				require.NoError(st, c.Send("ping"))

				// Expect to receive it
				msg, err := b.Read()
				require.NoError(st, err, "read")
				require.Equal(st, "ping", msg)

				// Send message from backend to client
				require.NoError(st, b.Send("pong"))

				// Expect to receive it
				msg, err = c.Read()
				require.NoError(st, err, "read")
				require.Equal(st, "pong", msg)
			},
		})
	})

	t.Run("delivers close code from client to backend", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "client to backend close",
			Run: func(st *S) {
				c, err := st.Client(WithClientSubprotocol(testSubprotocol))
				require.NoError(st, err, "dial")

				b, err := st.Backend("default").Accept()
				require.NoError(st, err, "accept")

				require.NoError(st, c.SendClose(4999, "goodbye"))

				cf, err := b.ReadControl()
				require.NoError(st, err)
				require.Equal(st, ws.OpClose, cf.OpCode)

				code, reason := cf.CloseData()
				require.Equal(st, ws.StatusCode(4999), code)
				require.Equal(st, "goodbye", reason)
			},
		})
	})

	t.Run("delivers close code from backend to client", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "backend to client close",
			Run: func(st *S) {
				c, err := st.Client(WithClientSubprotocol(testSubprotocol))
				require.NoError(st, err, "dial")

				b, err := st.Backend("default").Accept()
				require.NoError(st, err, "accept")

				require.NoError(st, b.SendClose(4999, "goodbye"))

				cf, err := c.ReadControl()
				require.NoError(st, err)
				require.Equal(st, ws.OpClose, cf.OpCode)

				code, reason := cf.CloseData()
				require.Equal(st, ws.StatusCode(4999), code)
				require.Equal(st, "goodbye", reason)
			},
		})
	})

	t.Run("client handshake captures negotiated subprotocol", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "client handshake",
			Run: func(st *S) {
				c, err := st.Client(WithClientSubprotocol(testSubprotocol))
				require.NoError(st, err, "dial")
				require.Equal(st, testSubprotocol, c.Handshake.Protocol)

				b, err := st.Backend("default").Accept()
				require.NoError(st, err, "accept")
				require.Equal(st, testSubprotocol, b.Handshake.Protocol)
			},
		})
	})

	t.Run("accepts client with no subprotocol when backend requires one", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "no subprotocol offered",
			Run: func(st *S) {
				c, err := st.Client()
				require.NoError(st, err, "dial")
				require.Empty(st, c.Handshake.Protocol)

				b, err := st.Backend("default").Accept()
				require.NoError(st, err, "accept")
				require.Empty(st, b.Handshake.Protocol)
			},
		})
	})

	t.Run("backend handle captures upgrade headers", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "backend upgrade headers",
			Run: func(st *S) {
				_, err := st.Client(
					WithClientSubprotocol(testSubprotocol),
					WithClientHeaders(http.Header{"X-Request-Id": {"abc-123"}}),
				)
				require.NoError(st, err, "dial")

				b, err := st.Backend("default").Accept()
				require.NoError(st, err, "accept")
				require.Equal(st, "abc-123", b.UpgradeHeaders.Get("X-Request-Id"))
			},
		})
	})

	t.Run("continues execution after non-fatal fail", func(t *testing.T) {
		cfg, _ := directConfig(t)

		canary := false
		result := RunScenario(cfg, Scenario{
			Name: "non-fatal failure",
			Run: func(st *S) {
				st.Error("something went wrong")
				canary = true
			},
		})

		require.False(t, result.Passed)
		require.True(t, canary, "expected execution to continue after Fail")
		require.Len(t, result.Failures, 1)
		require.False(t, result.Failures[0].Fatal, "expected non-fatal failure")
	})

	t.Run("stops execution on fatal", func(t *testing.T) {
		cfg, _ := directConfig(t)

		canary := false
		result := RunScenario(cfg, Scenario{
			Name: "fatal stops execution",
			Run: func(st *S) {
				st.Fatal("critical error")
				canary = true
			},
		})

		require.False(t, result.Passed)
		require.False(t, canary, "expected execution to stop after Fatal")
		require.Len(t, result.Failures, 1)
		require.True(t, result.Failures[0].Fatal, "expected fatal failure")
	})

	t.Run("records formatted message from errorf", func(t *testing.T) {
		cfg, _ := directConfig(t)

		result := RunScenario(cfg, Scenario{
			Name: "errorf formatting",
			Run: func(st *S) {
				st.Errorf("got %d, want %d", 1, 2)
			},
		})

		require.False(t, result.Passed)
		require.Len(t, result.Failures, 1)
		require.Equal(t, "got 1, want 2", result.Failures[0].Message)
	})

	t.Run("stops execution on fatalf", func(t *testing.T) {
		cfg, _ := directConfig(t)

		canary := false
		result := RunScenario(cfg, Scenario{
			Name: "fatalf stops execution",
			Run: func(st *S) {
				st.Fatalf("code %d: %s", 500, "internal error")
				canary = true
			},
		})

		require.False(t, result.Passed)
		require.False(t, canary, "expected execution to stop after Fatalf")
		require.Equal(t, "code 500: internal error", result.Failures[0].Message)
		require.True(t, result.Failures[0].Fatal, "expected fatal failure")
	})

	t.Run("passes when matchers succeed", func(t *testing.T) {
		cfg, _ := directConfig(t)

		RequireScenario(t, cfg, Scenario{
			Name: "matchers work",
			Run: func(s *S) {
				c, err := s.Client(WithClientSubprotocol(testSubprotocol))
				require.NoError(s, err, "dial")
				b, err := s.Backend("default").Accept()
				require.NoError(s, err, "accept")

				require.NoError(s, c.Send(`{"type":"subscribe","id":"1","payload":{"query":"{ hello }"}}`))

				msg, err := b.Read()
				require.NoError(s, err)
				jsonassert.New(s).Assertf(msg, `{"type":"subscribe","id":"1","payload":"<<PRESENCE>>"}`)

				require.NoError(s, b.Send(`{"type":"next","id":"1","payload":{"data":{"hello":"world"}}}`))

				msg, err = c.Read()
				require.NoError(s, err)
				require.JSONEq(s, `{"type":"next","id":"1","payload":{"data":{"hello":"world"}}}`, msg)
			},
		})
	})
}
