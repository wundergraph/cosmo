package graphqlws

import (
	"fmt"

	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/speedtrap"
)

// MultipleSubscriptionsShareOneUpstreamConnection verifies that the proxy
// multiplexes multiple subscriptions from a single client connection onto one
// upstream backend connection (legacy protocol variant).
var MultipleSubscriptionsShareOneUpstreamConnection = speedtrap.Scenario{
	Name: "multiple subscriptions share one upstream connection",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c := clientHandshake(s)

		// Two starts on the same connection
		require.NoError(s, c.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"mux1"}}}`))
		require.NoError(s, c.Send(`{"id":"2","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"mux2"}}}`))

		// First backend connection
		b := backendHandshake(s)

		// Read both subscribes (order is non-deterministic)
		var subIDMux1, subIDMux2 string
		varKey := func(msg string) string { return gjson.Get(msg, "payload.variables.key").String() }
		speedtrap.ReadSwitch(s, b.Messages(), varKey,
			speedtrap.Case("mux1", func(msg string) {
				ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"mux1"}}}`)
				subIDMux1 = extractID(msg)
			}),
			speedtrap.Case("mux2", func(msg string) {
				ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"mux2"}}}`)
				subIDMux2 = extractID(msg)
			}),
		)

		// Try to accept a second connection — should fail (multiplexed)
		_, err := s.Backend("subgraph-a").TryAccept()
		require.Error(s, err, "expected no second upstream connection (multiplexing)")

		// Send next for mux1, verify client receives it with client ID "1"
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"mux1"}}}}`, subIDMux1)))
		msg := readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"data","payload":{"data":{"streamA":{"key":"mux1"}}}}`)

		// Send next for mux2, verify client receives it with client ID "2"
		require.NoError(s, b.Send(fmt.Sprintf(
			`{"id":"%s","type":"next","payload":{"data":{"streamA":{"key":"mux2"}}}}`, subIDMux2)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"2","type":"data","payload":{"data":{"streamA":{"key":"mux2"}}}}`)

		// Complete mux1
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subIDMux1)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"1","type":"complete"}`)

		// Complete mux2
		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subIDMux2)))
		msg = readSkippingKA(s, c)
		ja.Assertf(msg, `{"id":"2","type":"complete"}`)
	},
}

// DifferentInitPayloadsGetSeparateUpstreamConnections verifies that two client
// connections with different connection_init payloads result in separate upstream
// connections (legacy protocol variant).
var DifferentInitPayloadsGetSeparateUpstreamConnections = speedtrap.Scenario{
	Name: "different init payloads get separate upstream connections",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		// Client 1 with token "aaa"
		c1, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
		require.NoError(s, err)
		require.NoError(s, c1.Send(`{"type":"connection_init","payload":{"token":"aaa"}}`))
		msg, err := c1.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		require.NoError(s, c1.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"sep1"}}}`))

		// Client 2 with token "bbb"
		c2, err := s.Client(speedtrap.WithClientSubprotocol("graphql-ws"))
		require.NoError(s, err)
		require.NoError(s, c2.Send(`{"type":"connection_init","payload":{"token":"bbb"}}`))
		msg, err = c2.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		require.NoError(s, c2.Send(`{"id":"1","type":"start","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"sep2"}}}`))

		// Two separate backend connections expected — accept order is non-deterministic
		conns := make([]*speedtrap.ConnectionHandle, 2)
		for i := range conns {
			conns[i], err = s.Backend("subgraph-a").Accept()
			require.NoError(s, err)
		}

		var b1, b2 *speedtrap.ConnectionHandle
		token := func(t speedtrap.Tagged) string { return gjson.Get(t.Msg, "payload.token").String() }
		speedtrap.ReadSwitch(s, speedtrap.MergeMessages(conns...), token,
			speedtrap.Case("aaa", func(t speedtrap.Tagged) {
				require.JSONEq(s, `{"type":"connection_init","payload":{"token":"aaa"}}`, t.Msg)
				require.NoError(s, t.Conn.Send(`{"type":"connection_ack"}`))
				b1 = t.Conn
			}),
			speedtrap.Case("bbb", func(t speedtrap.Tagged) {
				require.JSONEq(s, `{"type":"connection_init","payload":{"token":"bbb"}}`, t.Msg)
				require.NoError(s, t.Conn.Send(`{"type":"connection_ack"}`))
				b2 = t.Conn
			}),
		)

		// Read forwarded subscribes and complete both conversations
		msg, err = b1.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"sep1"}}}`)
		subID1 := extractID(msg)

		msg, err = b2.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"sep2"}}}`)
		subID2 := extractID(msg)

		require.NoError(s, b1.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID1)))
		msg = readSkippingKA(s, c1)
		ja.Assertf(msg, `{"id":"1","type":"complete"}`)

		require.NoError(s, b2.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID2)))
		msg = readSkippingKA(s, c2)
		ja.Assertf(msg, `{"id":"1","type":"complete"}`)
	},
}
