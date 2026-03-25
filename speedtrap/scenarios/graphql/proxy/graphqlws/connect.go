package graphqlws

import (
	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// ConnectionInitAndAck verifies the basic connection_init → connection_ack
// handshake for the legacy graphql-ws (subscriptions-transport-ws) protocol.
var ConnectionInitAndAck = speedtrap.Scenario{
	Name: "connection init and ack",
	Run: func(s *speedtrap.S) {
		c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
		require.NoError(s, err)

		require.NoError(s, c.Send(`{"type":"connection_init"}`))
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)
	},
}

// DuplicateConnectionInitClosesSocket verifies that sending a second
// connection_init after acknowledgment closes the connection with 4429. This
// mirrors graphql-transport-ws behavior rather than the reference server which
// silently re-acks. See PROTOCOL_AMENDMENTS.md.
var DuplicateConnectionInitClosesSocket = speedtrap.Scenario{
	Name: "duplicate connection init closes socket with 4429",
	Run: func(s *speedtrap.S) {
		c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
		require.NoError(s, err)

		require.NoError(s, c.Send(`{"type":"connection_init"}`))
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		// Second init — server must close with 4429
		require.NoError(s, c.Send(`{"type":"connection_init"}`))

		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, reason := cf.CloseData()
		require.Equal(s, ws.StatusCode(4429), code, "expected close code 4429, got %d", int(code))
		require.Equal(s, "Too many initialisation requests", reason)
	},
}

// SubscribeBeforeAckClosesSocket verifies that sending a start message before
// the connection is acknowledged closes the connection with 4401. This mirrors
// graphql-transport-ws behavior rather than the reference server which processes
// the subscription without a handshake. See PROTOCOL_AMENDMENTS.md.
var SubscribeBeforeAckClosesSocket = speedtrap.Scenario{
	Name: "subscribe before connection ack closes socket with 4401",
	Run: func(s *speedtrap.S) {
		c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
		require.NoError(s, err)

		// Send start without connection_init — server must close with 4401
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"noack"}}}`))

		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, _ := cf.CloseData()
		require.Equal(s, ws.StatusCode(4401), code, "expected close code 4401, got %d", int(code))
	},
}

// UnknownMessageTypeClosesSocket verifies that sending an unknown message type
// closes the connection with 4400. This mirrors graphql-transport-ws behavior
// rather than the reference server which returns an error message and keeps
// the connection alive. See PROTOCOL_AMENDMENTS.md.
var UnknownMessageTypeClosesSocket = speedtrap.Scenario{
	Name: "unknown message type closes socket with 4400",
	Run: func(s *speedtrap.S) {
		c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
		require.NoError(s, err)

		require.NoError(s, c.Send(`{"type":"connection_init"}`))
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		// Send a bogus message type — server must close with 4400
		require.NoError(s, c.Send(`{"type":"bogus"}`))

		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, _ := cf.CloseData()
		require.Equal(s, ws.StatusCode(4400), code, "expected close code 4400, got %d", int(code))
	},
}
