package graphqltransportws

import (
	"fmt"

	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// BackendTCPDropDuringActiveSubscription verifies that when the backend
// forcibly drops TCP during an active subscription, the client receives an
// error for the affected subscription.
var BackendTCPDropDuringActiveSubscription = speedtrap.Scenario{
	Name: "backend TCP drop during active subscription",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"drop"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"drop"}}}`)

		// Forcibly close TCP — no close frame
		require.NoError(s, b.Drop())

		// Client must receive exactly one error with UPSTREAM_SERVICE_ERROR
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"error","id":"1","payload":[{"message":"upstream service error","extensions":{"code":"UPSTREAM_SERVICE_ERROR"}}]}`)
	},
}

// BackendCloseFrameDuringActiveSubscription verifies that when the backend
// sends a close frame during an active subscription, the client receives an
// error for the affected subscription.
var BackendCloseFrameDuringActiveSubscription = speedtrap.Scenario{
	Name: "backend close frame during active subscription",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"bclose"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"bclose"}}}`)

		// Backend sends close frame
		require.NoError(s, b.SendClose(1011, "internal error"))

		// Client must receive exactly one error with UPSTREAM_SERVICE_ERROR and close info
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"error","id":"1","payload":[{"message":"upstream service error","extensions":{"code":"UPSTREAM_SERVICE_ERROR","closeCode":1011,"closeReason":"internal error"}}]}`)
	},
}

// ClientTCPDropCleansUpBackendSubscription verifies the proxy cleans up the
// backend subscription when the client forcibly drops TCP.
var ClientTCPDropCleansUpBackendSubscription = speedtrap.Scenario{
	Name: "client TCP drop cleans up backend subscription",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"cdrop"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"cdrop"}}}`)
		subID := ExtractID(msg)

		// Client forcibly drops TCP
		require.NoError(s, c.Drop())

		// Backend must receive complete for the active subscription
		msg, err = b.Read()
		if err != nil {
			return // connection closed — acceptable
		}
		require.JSONEq(s, fmt.Sprintf(`{"type":"complete","id":"%s"}`, subID), msg)
	},
}

// ClientCloseFrameCleansUpBackendSubscription verifies the proxy cleans up the
// backend subscription when the client sends a close frame.
var ClientCloseFrameCleansUpBackendSubscription = speedtrap.Scenario{
	Name: "client close frame cleans up backend subscription",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"cclose"}}}`))

		b := backendHandshake(s)
		msg, err := b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"cclose"}}}`)
		subID := ExtractID(msg)

		// Client sends close frame
		require.NoError(s, c.SendClose(1000, "going away"))

		// Backend must receive complete for the active subscription
		msg, err = b.Read()
		if err != nil {
			return // connection closed — acceptable
		}
		require.JSONEq(s, fmt.Sprintf(`{"type":"complete","id":"%s"}`, subID), msg)
	},
}

// BackendNeverAcksConnectionInitTimesOut verifies that when the backend accepts
// the connection but never sends connection_ack, the client receives an error
// for the pending subscribe.
var BackendNeverAcksConnectionInitTimesOut = speedtrap.Scenario{
	Name: "backend never acks connection init times out",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"noack"}}}`))

		// Backend accepts but never sends connection_ack
		b, err := s.Backend("subgraph-a").Accept()
		require.NoError(s, err)
		msg, err := b.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_init"}`, msg)
		// Deliberately do NOT send connection_ack

		// Client must receive an error for the pending subscribe
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"error","id":"1","payload":[{"message":"upstream service error","extensions":{"code":"UPSTREAM_SERVICE_ERROR"}}]}`)
	},
}
