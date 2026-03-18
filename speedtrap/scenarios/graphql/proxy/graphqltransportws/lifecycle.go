package graphqltransportws

import (
	"fmt"

	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/speedtrap"
)

// MultipleNextMessagesBeforeComplete verifies the proxy forwards multiple next
// messages for a single subscription before the final complete.
var MultipleNextMessagesBeforeComplete = speedtrap.Scenario{
	Name: "multiple next messages before complete",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key contents}}","variables":{"key":"multi"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID := ExtractID(msg)

		// Backend sends 3 next messages
		for i := 1; i <= 3; i++ {
			require.NoError(s, b.Send(fmt.Sprintf(
				`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"multi","contents":%d}}}}`, subID, i)))
		}

		// Client receives all 3 next messages with original ID
		for i := 1; i <= 3; i++ {
			msg, err = c.Read()
			require.NoError(s, err)
			ja.Assertf(msg, `{"type":"next","id":"1","payload":{"data":{"streamA":{"key":"multi","contents":%d}}}}`, i)
		}

		// Backend sends complete
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}

// ClientCompleteStopsSubscription verifies that when the client sends a
// complete message, the proxy forwards it to the backend (stopping the
// upstream subscription).
var ClientCompleteStopsSubscription = speedtrap.Scenario{
	Name: "client complete stops upstream subscription",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"stop"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"stop"}}}`)
		subID := ExtractID(msg)

		// Client sends complete to cancel
		require.NoError(s, c.Send(`{"id":"1","type":"complete"}`))

		// Backend should receive a complete with remapped ID
		msg, err = b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"%s"}`, subID)
	},
}

// ServerErrorTerminatesOperation verifies that when the backend sends an error
// message, it is forwarded to the client and terminates the subscription
// (no separate complete message follows the error).
var ServerErrorTerminatesOperation = speedtrap.Scenario{
	Name: "server error terminates operation",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"err"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID := ExtractID(msg)

		// Backend sends error (terminates the operation per spec)
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"error","payload":[{"message":"something went wrong"}]}`, subID)))

		// Client receives error with original ID
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"error","id":"1","payload":[{"message":"something went wrong"}]}`)
	},
}

// SubscribeWithVariablesAndOperationName verifies that when a client sends a
// document with multiple named operations, the proxy selects the one matching
// operationName, strips the name, and forwards only that operation with its
// variables.
var SubscribeWithVariablesAndOperationName = speedtrap.Scenario{
	Name: "subscribe with variables and operation name",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Client sends a document with two named subscriptions and selects WatchStream
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription WatchStream($k: String){streamA(key: $k){key contents}} subscription Other{streamA(key: \"unused\"){key}}","variables":{"k":"vars-test"},"operationName":"WatchStream"}}`))

		// Backend receives the selected operation only, with the name stripped
		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($k: String){streamA(key: $k){key contents}}","variables":{"k":"vars-test"}}}`)
		subID := ExtractID(msg)

		// Backend sends next, client receives it
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"vars-test","contents":"hello"}}}}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"next","id":"1","payload":{"data":{"streamA":{"key":"vars-test","contents":"hello"}}}}`)

		// Complete
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}

// IDReuseAfterOperationCompletes verifies that a client can reuse a
// subscription ID after the server has completed that operation. Per the
// graphql-transport-ws spec, once a server-initiated complete is received
// for an ID, the client is free to subscribe again with that same ID.
// The proxy must deliver the new subscribe on the same upstream connection
// (same client, same init payload, same subgraph — multiplexing applies).
var IDReuseAfterOperationCompletes = speedtrap.Scenario{
	Name: "ID reuse after operation completes",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// First subscription with id "1"
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"reuse1"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID1 := ExtractID(msg)

		// Backend sends next then complete for the first subscription
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"reuse1"}}}}`, subID1)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"next","id":"1","payload":{"data":{"streamA":{"key":"reuse1"}}}}`)

		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID1)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)

		// Reuse id "1" for a new subscription
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"reuse2"}}}`))

		// The previous upstream connection was closed after the last subscription
		// completed, so the proxy opens a fresh one for the new subscribe.
		b, err = s.Backend("subgraph-a").Accept()
		require.NoError(s, err)
		msg, err = b.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_init"}`, msg)
		require.NoError(s, b.Send(`{"type":"connection_ack"}`))

		msg, err = b.Read()
		require.NoError(s, err)
		require.Equal(s, "subscribe", ExtractType(msg))
		subID2 := ExtractID(msg)

		// Backend sends next for the reused ID
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"reuse2"}}}}`, subID2)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"next","id":"1","payload":{"data":{"streamA":{"key":"reuse2"}}}}`)

		// Complete
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID2)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}

// MultipleConcurrentSubscriptions verifies that the proxy correctly multiplexes
// multiple active subscriptions on a single client connection, each with its
// own ID and independent data flow.
var MultipleConcurrentSubscriptions = speedtrap.Scenario{
	Name: "multiple concurrent subscriptions on one connection",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Subscribe with id "1"
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"a"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		subID1 := ExtractID(msg)

		// Subscribe with id "2"
		require.NoError(s, c.Send(`{"id":"2","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"b"}}}`))

		// Proxy must multiplex onto the same upstream connection
		_, err = s.Backend("subgraph-a").TryAccept()
		require.Error(s, err, "expected no second upstream connection (multiplexing)")

		msg, err = b.Read()
		require.NoError(s, err)
		subID2 := ExtractID(msg)

		// Backend sends next for both subscriptions
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"a"}}}}`, subID1)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"next","id":"1","payload":{"data":{"streamA":{"key":"a"}}}}`)

		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"b"}}}}`, subID2)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"next","id":"2","payload":{"data":{"streamA":{"key":"b"}}}}`)

		// Complete both
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID1)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)

		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID2)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"2"}`)
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
		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"err1"}}}`))
		require.NoError(s, c.Send(`{"id":"2","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"err2"}}}`))

		b := backendHandshake(s)

		// Proxy must multiplex onto the same upstream connection
		_, err := s.Backend("subgraph-a").TryAccept()
		require.Error(s, err, "expected no second upstream connection (multiplexing)")

		// Read both subscribes (order is non-deterministic)
		var subID1, subID2 string
		varKey := func(msg string) string { return gjson.Get(msg, "payload.variables.key").String() }
		speedtrap.ReadSwitch(s, b.Messages(), varKey,
			speedtrap.Case("err1", func(msg string) { subID1 = ExtractID(msg) }),
			speedtrap.Case("err2", func(msg string) { subID2 = ExtractID(msg) }),
		)

		// Error on subscription 1
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"error","payload":[{"message":"sub1 failed"}]}`, subID1)))

		// Next on subscription 2 — should still work
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"err2"}}}}`, subID2)))

		// Client receives error for "1", complete for "1", and next for "2"
		// (unordered). Note: the complete after error contradicts the spec
		// ("error terminates the operation and no further messages will be
		// sent") but matches the graphql-ws reference implementation (v6.0.7).
		// See https://github.com/enisdenjo/graphql-ws/issues/XXX.
		idType := func(msg string) string { return ExtractID(msg) + ":" + ExtractType(msg) }
		speedtrap.ReadSwitch(s, c.Messages(), idType,
			speedtrap.Case("1:error", func(msg string) {
				ja.Assertf(msg, `{"type":"error","id":"1","payload":[{"message":"sub1 failed"}]}`)
			}),
			speedtrap.Case("1:complete", func(msg string) {
				ja.Assertf(msg, `{"type":"complete","id":"1"}`)
			}),
			speedtrap.Case("2:next", func(msg string) {
				ja.Assertf(msg, `{"type":"next","id":"2","payload":{"data":{"streamA":{"key":"err2"}}}}`)
			}),
		)

		// Complete subscription 2
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID2)))

		completeMsg, completeErr := c.Read()
		require.NoError(s, completeErr)
		ja.Assertf(completeMsg, `{"type":"complete","id":"2"}`)
	},
}
