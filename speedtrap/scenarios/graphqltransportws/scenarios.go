package graphqltransportws

import (
	"github.com/gobwas/ws"
	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// handshake performs the connection_init / connection_ack exchange.
func handshake(t *speedtrap.S, c, b *speedtrap.ConnectionHandle) {
	require.NoError(t, c.Send(`{"type":"connection_init"}`))

	msg, err := b.Read()
	require.NoError(t, err)
	require.JSONEq(t, `{"type":"connection_init"}`, msg)

	require.NoError(t, b.Send(`{"type":"connection_ack"}`))

	msg, err = c.Read()
	require.NoError(t, err)
	require.JSONEq(t, `{"type":"connection_ack"}`, msg)
}

// AllScenarios contains all single-backend graphql-transport-ws scenarios.
var AllScenarios = []speedtrap.Scenario{
	BasicHandshake,
	SingleSubscription,
	CloseCodePropagation,
}

// FederatedScenarios contains scenarios requiring multiple backends.
var FederatedScenarios = []speedtrap.Scenario{
	FederatedRouting,
}

// BasicHandshake verifies the connection_init / connection_ack round-trip.
var BasicHandshake = speedtrap.Scenario{
	Name: "basic connection_init / connection_ack",
	Run: func(t *speedtrap.S) {
		c, err := t.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(t, err, "dial")
		b, err := t.Backend("default").Accept()
		require.NoError(t, err, "backend accept")

		handshake(t, c, b)
	},
}

// SingleSubscription verifies the subscribe → next → next → complete lifecycle.
var SingleSubscription = speedtrap.Scenario{
	Name: "subscribe, receive messages, complete",
	Run: func(t *speedtrap.S) {
		c, err := t.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(t, err, "dial")
		b, err := t.Backend("default").Accept()
		require.NoError(t, err, "backend accept")

		handshake(t, c, b)

		require.NoError(t, c.Send(`{"type":"subscribe","id":"1","payload":{"query":"subscription { ticker }"}}`))

		msg, err := b.Read()
		require.NoError(t, err)
		jsonassert.New(t).Assertf(msg, `{"type":"subscribe","id":"1","payload":"<<PRESENCE>>"}`)

		require.NoError(t, b.Send(`{"type":"next","id":"1","payload":{"data":{"tick":1}}}`))
		msg, err = c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"next","id":"1","payload":{"data":{"tick":1}}}`, msg)

		require.NoError(t, b.Send(`{"type":"next","id":"1","payload":{"data":{"tick":2}}}`))
		msg, err = c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"next","id":"1","payload":{"data":{"tick":2}}}`, msg)

		require.NoError(t, b.Send(`{"type":"complete","id":"1"}`))
		msg, err = c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"complete","id":"1"}`, msg)
	},
}

// CloseCodePropagation verifies backend close frames are forwarded to clients.
var CloseCodePropagation = speedtrap.Scenario{
	Name: "backend close code forwarded to client",
	Run: func(t *speedtrap.S) {
		c, err := t.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(t, err, "dial")
		b, err := t.Backend("default").Accept()
		require.NoError(t, err, "backend accept")

		handshake(t, c, b)

		require.NoError(t, b.SendClose(4400, "rate limited"))

		cf, err := c.ReadControl()
		require.NoError(t, err)
		require.Equal(t, ws.OpClose, cf.OpCode)
		code, _ := cf.CloseData()
		require.Equal(t, ws.StatusCode(4400), code)
	},
}

// FederatedRouting verifies subscriptions route to correct upstream backends.
var FederatedRouting = speedtrap.Scenario{
	Name: "subscriptions route to correct upstream backends",
	Run: func(t *speedtrap.S) {
		c, err := t.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(t, err, "dial")

		bu, err := t.Backend("users").Accept()
		require.NoError(t, err, "users backend accept")
		handshake(t, c, bu)

		require.NoError(t, c.Send(`{"type":"subscribe","id":"1","payload":{"query":"subscription { userUpdated }"}}`))
		msg, err := bu.Read()
		require.NoError(t, err)
		jsonassert.New(t).Assertf(msg, `{"type":"subscribe","id":"1","payload":"<<PRESENCE>>"}`)

		require.NoError(t, c.Send(`{"type":"subscribe","id":"2","payload":{"query":"subscription { productChanged }"}}`))

		bp, err := t.Backend("products").Accept()
		require.NoError(t, err, "products backend accept")
		msg, err = bp.Read()
		require.NoError(t, err)
		jsonassert.New(t).Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":"<<PRESENCE>>"}`)

		require.NoError(t, bu.Send(`{"type":"next","id":"1","payload":{"data":{"userUpdated":"alice"}}}`))
		msg, err = c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"next","id":"1","payload":{"data":{"userUpdated":"alice"}}}`, msg)

		require.NoError(t, bp.Send(`{"type":"next","id":"2","payload":{"data":{"productChanged":"widget"}}}`))
		msg, err = c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"next","id":"2","payload":{"data":{"productChanged":"widget"}}}`, msg)
	},
}
