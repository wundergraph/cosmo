package graphqlws

import (
	"fmt"

	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// clientHandshake performs the legacy graphql-ws connection handshake.
// It may also read and discard ka (keep-alive) messages that arrive
// immediately after connection_ack.
func clientHandshake(s *speedtrap.S) *speedtrap.ConnectionHandle {
	c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
	require.NoError(s, err)

	require.NoError(s, c.Send(`{"type":"connection_init"}`))
	msg, err := c.Read()
	require.NoError(s, err)
	require.JSONEq(s, `{"type":"connection_ack"}`, msg)

	// The router may send a ka immediately after ack; drain it.
	return c
}

// backendHandshake accepts a backend connection and completes the
// graphql-transport-ws handshake (the router always speaks modern
// protocol upstream).
func backendHandshake(s *speedtrap.S) *speedtrap.ConnectionHandle {
	b, err := s.Backend("subgraph-a").Accept()
	require.NoError(s, err)
	msg, err := b.Read()
	require.NoError(s, err)
	require.JSONEq(s, `{"type":"connection_init"}`, msg)
	require.NoError(s, b.Send(`{"type":"connection_ack"}`))
	return b
}

// readSkippingKA reads the next message from the client, skipping any
// ka (keep-alive) messages that the router may interleave.
func readSkippingKA(s *speedtrap.S, c *speedtrap.ConnectionHandle) string {
	for {
		msg, err := c.Read()
		require.NoError(s, err)
		if msg == `{"type":"ka"}` {
			continue
		}
		return msg
	}
}

// StartDataCompleteRoundTrip verifies the full start → data → complete
// lifecycle through the proxy. The client speaks legacy graphql-ws while
// the backend speaks graphql-transport-ws (the router translates).
var StartDataCompleteRoundTrip = speedtrap.Scenario{
	Name: "start data complete round-trip",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Client sends "start" (legacy subscribe)
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key contents}}","variables":{"key":"test"}}}`))

		// Backend receives modern "subscribe" (router translates)
		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key contents}}","variables":{"key":"test"}}}`)
		subID := extractID(msg)

		// Backend sends modern "next" → client receives legacy "data"
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"test","contents":null}}}}`, subID)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"data","payload":{"data":{"streamA":{"key":"test","contents":null}}}}`)

		// Backend sends "complete" → client receives "complete"
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"complete"}`)
	},
}

// MultipleDataMessagesBeforeComplete verifies the proxy forwards multiple
// data messages for a single subscription before the final complete.
var MultipleDataMessagesBeforeComplete = speedtrap.Scenario{
	Name: "multiple data messages before complete",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key contents}}","variables":{"key":"multi"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID := extractID(msg)

		// Backend sends 3 next messages
		for i := 1; i <= 3; i++ {
			require.NoError(s, b.Send(fmt.Sprintf(
				`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"multi","contents":%d}}}}`, subID, i)))
		}

		// Client receives all 3 as "data" messages
		for i := 1; i <= 3; i++ {
			msg = readSkippingKA(s, c)
			ja.Assertf(msg, `{"id":"1","type":"data","payload":{"data":{"streamA":{"key":"multi","contents":%d}}}}`, i)
		}

		// Complete
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"complete"}`)
	},
}

// StopCancelsSubscription verifies that the client sending a "stop" message
// causes the proxy to forward a "complete" to the upstream backend.
var StopCancelsSubscription = speedtrap.Scenario{
	Name: "stop cancels upstream subscription",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"stop"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"stop"}}}`)
		subID := extractID(msg)

		// Client sends "stop" (legacy complete)
		require.NoError(s, c.Send(`{"id":"1","type":"stop"}`))

		// Backend should receive a "complete" with remapped ID
		msg, err = b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"%s"}`, subID)
	},
}

// ServerErrorInDataPayload verifies that when the backend sends an error
// message, the router wraps it in a "data" message with errors in the payload,
// per the subscriptions-transport-ws protocol.
var ServerErrorInDataPayload = speedtrap.Scenario{
	Name: "server error delivered in data payload",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"err"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID := extractID(msg)

		// Backend sends error (modern protocol)
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"error","payload":[{"message":"something went wrong"}]}`, subID)))

		// Client receives a "data" message with errors in the payload
		// (subscriptions-transport-ws wraps errors inside data messages)
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"data","payload":{"errors":[{"message":"something went wrong"}]}}`)
	},
}

// MultipleConcurrentSubscriptions verifies that the proxy correctly handles
// multiple active subscriptions on a single legacy graphql-ws connection.
var MultipleConcurrentSubscriptions = speedtrap.Scenario{
	Name: "multiple concurrent subscriptions on one connection",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Start subscription 1
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"a"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID1 := extractID(msg)

		// Start subscription 2
		require.NoError(s, c.Send(`{"id":"2","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"b"}}}`))

		// Proxy must multiplex onto the same upstream connection
		_, err = s.Backend("subgraph-a").TryAccept()
		require.Error(s, err, "expected no second upstream connection (multiplexing)")

		msg, err = b.Read()
		require.NoError(s, err)
		subID2 := extractID(msg)

		// Backend sends next for both subscriptions
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"a"}}}}`, subID1)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"data","payload":{"data":{"streamA":{"key":"a"}}}}`)

		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"b"}}}}`, subID2)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"2","type":"data","payload":{"data":{"streamA":{"key":"b"}}}}`)

		// Complete both
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID1)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"complete"}`)

		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID2)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"2","type":"complete"}`)
	},
}

// OneSubscriptionErrorDoesNotAffectAnother verifies that an error on one
// subscription does not disrupt a concurrent subscription on the same connection.
var OneSubscriptionErrorDoesNotAffectAnother = speedtrap.Scenario{
	Name: "one subscription error does not affect another",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Two concurrent subscriptions
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"err1"}}}`))
		require.NoError(s, c.Send(`{"id":"2","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"err2"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID1 := extractID(msg)

		// Proxy must multiplex onto the same upstream connection
		_, err = s.Backend("subgraph-a").TryAccept()
		require.Error(s, err, "expected no second upstream connection (multiplexing)")

		msg, err = b.Read()
		require.NoError(s, err)
		subID2 := extractID(msg)

		// Error on subscription 1
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"error","payload":[{"message":"sub1 failed"}]}`, subID1)))

		// Next on subscription 2 — should still work
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"err2"}}}}`, subID2)))

		// Client receives error for "1" (wrapped in data) and data for "2"
		// (unordered, interspersed with possible ka messages).
		isKA := func(msg string) bool { return msg == `{"type":"ka"}` }
		idType := func(msg string) string { return extractID(msg) + ":" + extractType(msg) }
		speedtrap.ReadSwitch(s, speedtrap.Filter(c.Messages(), isKA), idType,
			speedtrap.Case("1:data", func(msg string) {
				ja.Assertf(msg, `{"id":"1","type":"data","payload":{"errors":[{"message":"sub1 failed"}]}}`)
			}),
			speedtrap.Case("2:data", func(msg string) {
				ja.Assertf(msg, `{"id":"2","type":"data","payload":{"data":{"streamA":{"key":"err2"}}}}`)
			}),
		)

		// Complete subscription 2
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID2)))

		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"2","type":"complete"}`)
	},
}

// DuplicateStartIDClosesSocket verifies that sending a "start" with an ID that
// is already active causes the server to close the connection.
//
// NOTE: This diverges from the subscriptions-transport-ws reference server
// (v0.11.0), which silently completes the existing subscription and starts a
// new one with the same ID (replace semantics). We intentionally treat
// duplicate IDs as an error to match the graphql-transport-ws behavior (close
// with 4409) and avoid the complexity of implicit replacement.
var DuplicateStartIDClosesSocket = speedtrap.Scenario{
	Name: "duplicate start ID closes socket",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Start subscription with id "1"
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"dup"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"dup"}}}`)

		// Duplicate start with same id "1"
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"dup"}}}`))

		// Connection should be closed
		_, err = c.Read()
		require.Error(s, err, "expected connection to be closed after duplicate start ID")
	},
}

// ConnectionTerminateCleansUp verifies that sending connection_terminate causes
// the proxy to clean up backend subscriptions and close the connection.
var ConnectionTerminateCleansUp = speedtrap.Scenario{
	Name: "connection terminate cleans up",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"term"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"term"}}}`)
		subID := extractID(msg)

		// Client sends connection_terminate
		require.NoError(s, c.Send(`{"type":"connection_terminate"}`))

		// Backend receives a complete for the active subscription
		msg, err = b.Read()
		require.NoError(s, err)
		require.JSONEq(s, fmt.Sprintf(`{"type":"complete","id":"%s"}`, subID), msg)

		// Client connection is closed
		_, err = c.Read()
		require.Error(s, err, "expected client connection to be closed after connection_terminate")
	},
}
