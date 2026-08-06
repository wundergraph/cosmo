package graphqltransportws

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// PingReceivesPongResponse verifies that the proxy responds to a
// graphql-transport-ws ping message with a pong message.
var PingReceivesPongResponse = speedtrap.Scenario{
	Name: "ping receives pong response",
	Run: func(s *speedtrap.S) {
		c := clientHandshake(s)

		// Send protocol-level ping
		require.NoError(s, c.Send(`{"type":"ping"}`))

		// Expect protocol-level pong
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"pong"}`, msg)
	},
}

// PongCarriesPingPayload verifies that the proxy echoes the ping message's
// payload in the pong response per the graphql-transport-ws spec.
var PongCarriesPingPayload = speedtrap.Scenario{
	Name: "pong carries ping payload",
	Run: func(s *speedtrap.S) {
		c := clientHandshake(s)

		// Send ping with payload
		require.NoError(s, c.Send(`{"type":"ping","payload":{"hello":"world"}}`))

		// Pong must carry the same payload
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"pong","payload":{"hello":"world"}}`, msg)
	},
}
