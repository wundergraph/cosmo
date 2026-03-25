package graphqltransportws

import (
	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// DuplicateConnectionInitClosesSocket verifies that sending a second
// connection_init after acknowledgment terminates the connection with close
// code 4429 per the graphql-transport-ws spec.
var DuplicateConnectionInitClosesSocket = speedtrap.Scenario{
	Name: "duplicate connection init closes socket with 4429",
	Run: func(s *speedtrap.S) {
		c := clientHandshake(s)

		// Second init — server must close with 4429
		require.NoError(s, c.Send(`{"type":"connection_init"}`))

		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, reason := cf.CloseData()
		require.Equal(s, ws.StatusCode(4429), code, "close code should be 4429, got %d", int(code))
		require.Equal(s, "Too many initialisation requests", reason)
	},
}

// SubscribeBeforeAckClosesSocket verifies that sending a subscribe message
// before the connection is acknowledged terminates the connection with close
// code 4401 per the graphql-transport-ws spec.
var SubscribeBeforeAckClosesSocket = speedtrap.Scenario{
	Name: "subscribe before connection ack closes socket with 4401",
	Run: func(s *speedtrap.S) {
		c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(s, err)

		// Send subscribe without init — server must close with 4401
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription{streamA {key}}"}}`))

		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, reason := cf.CloseData()
		require.Equal(s, ws.StatusCode(4401), code)
		require.Equal(s, "Unauthorized", reason)
	},
}

// UnknownMessageTypeClosesSocket verifies that sending an unknown message
// type results in an immediate close with code 4400 per the
// graphql-transport-ws spec.
var UnknownMessageTypeClosesSocket = speedtrap.Scenario{
	Name: "unknown message type closes socket with 4400",
	Run: func(s *speedtrap.S) {
		c := clientHandshake(s)

		// Send a bogus message type — server must close with 4400
		require.NoError(s, c.Send(`{"type":"bogus"}`))

		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, _ := cf.CloseData()
		require.Equal(s, ws.StatusCode(4400), code)
	},
}
