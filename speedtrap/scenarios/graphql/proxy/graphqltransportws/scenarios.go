package graphqltransportws

import (
	"fmt"

	"github.com/gobwas/ws"
	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/speedtrap"
)

// clientHandshake performs the graphql-transport-ws connection handshake.
func clientHandshake(s *speedtrap.S) *speedtrap.ConnectionHandle {
	c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
	require.NoError(s, err)

	require.NoError(s, c.Send(`{"type":"connection_init"}`))
	msg, err := c.Read()
	require.NoError(s, err)
	require.JSONEq(s, `{"type":"connection_ack"}`, msg)

	return c
}

// backendHandshake accepts a backend connection and completes the
// graphql-transport-ws handshake.
func backendHandshake(s *speedtrap.S) *speedtrap.ConnectionHandle {
	b, err := s.Backend("subgraph-a").Accept()
	require.NoError(s, err)
	msg, err := b.Read()
	require.NoError(s, err)
	require.JSONEq(s, `{"type":"connection_init"}`, msg)
	require.NoError(s, b.Send(`{"type":"connection_ack"}`))
	return b
}

// Scenarios contains all graphql-transport-ws proxy scenarios.
// The test harness must register a backend named "subgraph-a".
var Scenarios = []speedtrap.Scenario{
	// Connection phase
	DuplicateConnectionInitClosesSocket,
	SubscribeBeforeAckClosesSocket,
	UnknownMessageTypeClosesSocket,

	// Ping/pong
	PingReceivesPongResponse,
	PongCarriesPingPayload,

	// Subscribe lifecycle
	SubscribeRoundTrip,
	SubscribeWithVariablesAndOperationName,
	MultipleNextMessagesBeforeComplete,
	DuplicateSubscriptionIDClosesSocket,
	ClientCompleteStopsSubscription,
	ServerErrorTerminatesOperation,
	IDReuseAfterOperationCompletes,
	MultipleConcurrentSubscriptions,
	OneSubscriptionErrorDoesNotAffectAnother,

	// Disruption
	BackendTCPDropDuringActiveSubscription,
	BackendCloseFrameDuringActiveSubscription,
	ClientTCPDropCleansUpBackendSubscription,
	ClientCloseFrameCleansUpBackendSubscription,
	BackendNeverAcksConnectionInitTimesOut,

	// Headers and init payload
	AllowlistedHeadersForwardedToBackend,
	NonAllowlistedHeadersFilteredOut,
	ConnectionInitPayloadForwardedToBackend,

	// Multiplexing
	MultipleSubscriptionsShareOneUpstreamConnection,
	DifferentInitPayloadsGetSeparateUpstreamConnections,
}

// ExtractID parses the "id" field from a JSON message.
func ExtractID(msg string) string {
	return gjson.Get(msg, "id").String()
}

// ExtractType parses the "type" field from a JSON message.
func ExtractType(msg string) string {
	return gjson.Get(msg, "type").String()
}

// SubscribeRoundTrip verifies the full subscribe, next, complete lifecycle
// through a proxy, including subscription ID remapping.
var SubscribeRoundTrip = speedtrap.Scenario{
	Name: "subscribe round-trip",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Client subscribes
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key contents}}","variables":{"key":"test"}}}`))

		// Backend receives forwarded subscribe (proxy may remap the ID)
		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key contents}}","variables":{"key":"test"}}}`)
		subID := ExtractID(msg)

		// Backend sends next, client receives it with its original ID
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"test","contents":null}}}}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"next","id":"1","payload":{"data":{"streamA":{"key":"test","contents":null}}}}`)

		// Backend sends complete, client receives it
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"complete"}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}

// DuplicateSubscriptionIDClosesSocket verifies that sending a subscribe with
// an ID that is already active causes the server to close the socket with
// 4409 per the graphql-transport-ws spec.
var DuplicateSubscriptionIDClosesSocket = speedtrap.Scenario{
	Name: "duplicate subscription ID closes socket with 4409",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// First subscribe with id "1"
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription{streamA {key}}"}}`))

		// Backend receives the forwarded subscribe
		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription{streamA {key}}"}}`)

		// Duplicate subscribe with same id "1"
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription{streamA {key}}"}}`))

		// Per spec: server must close with 4409 "Subscriber for <id> already exists"
		cf, err := c.ReadControl()
		require.NoError(s, err)
		require.Equal(s, ws.OpClose, cf.OpCode)
		code, reason := cf.CloseData()
		require.Equal(s, ws.StatusCode(4409), code)
		require.Equal(s, "Subscriber for 1 already exists", reason)
	},
}
