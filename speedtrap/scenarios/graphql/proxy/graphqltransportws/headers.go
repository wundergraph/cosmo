package graphqltransportws

import (
	"fmt"
	"net/http"

	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
)

// AllowlistedHeadersForwardedToBackend verifies that client upgrade headers
// matching the router's header propagation rules are forwarded as HTTP headers
// on the upstream WebSocket dial.
var AllowlistedHeadersForwardedToBackend = speedtrap.Scenario{
	Name: "allowlisted headers forwarded to backend",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		headers := http.Header{
			"Authorization":  {"Bearer tok"},
			"X-Custom-Trace": {"abc123"},
		}
		c, err := s.Client(
			speedtrap.WithClientSubprotocol("graphql-transport-ws"),
			speedtrap.WithClientHeaders(headers),
		)
		require.NoError(s, err)
		require.NoError(s, c.Send(`{"type":"connection_init"}`))
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"hdr"}}}`))

		b, err := s.Backend("subgraph-a").Accept()
		require.NoError(s, err)

		require.Equal(s, "Bearer tok", b.UpgradeHeaders.Get("Authorization"))
		require.Equal(s, "abc123", b.UpgradeHeaders.Get("X-Custom-Trace"))

		msg, err = b.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_init"}`, msg)
		require.NoError(s, b.Send(`{"type":"connection_ack"}`))

		// Read the forwarded subscribe and complete the conversation
		msg, err = b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"hdr"}}}`)
		subID := ExtractID(msg)

		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}

// NonAllowlistedHeadersFilteredOut verifies that client upgrade headers NOT
// matching the router's header propagation rules are stripped before the
// upstream WebSocket dial.
var NonAllowlistedHeadersFilteredOut = speedtrap.Scenario{
	Name: "non-allowlisted headers filtered out",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		headers := http.Header{
			"Authorization":     {"Bearer tok"},
			"X-Secret-Internal": {"should-be-stripped"},
		}
		c, err := s.Client(
			speedtrap.WithClientSubprotocol("graphql-transport-ws"),
			speedtrap.WithClientHeaders(headers),
		)
		require.NoError(s, err)
		require.NoError(s, c.Send(`{"type":"connection_init"}`))
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"filter"}}}`))

		b, err := s.Backend("subgraph-a").Accept()
		require.NoError(s, err)

		require.Equal(s, "Bearer tok", b.UpgradeHeaders.Get("Authorization"))
		require.Empty(s, b.UpgradeHeaders.Get("X-Secret-Internal"))

		msg, err = b.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_init"}`, msg)
		require.NoError(s, b.Send(`{"type":"connection_ack"}`))

		// Read the forwarded subscribe and complete the conversation
		msg, err = b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"filter"}}}`)
		subID := ExtractID(msg)

		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}

// ConnectionInitPayloadForwardedToBackend verifies that the connection_init
// payload from the client is forwarded to the backend.
var ConnectionInitPayloadForwardedToBackend = speedtrap.Scenario{
	Name: "connection init payload forwarded to backend",
	Run: func(s *speedtrap.S) {
		ja := jsonassert.New(s)

		c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(s, err)
		require.NoError(s, c.Send(`{"type":"connection_init","payload":{"token":"abc"}}`))
		msg, err := c.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_ack"}`, msg)

		require.NoError(s, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"init"}}}`))

		b, err := s.Backend("subgraph-a").Accept()
		require.NoError(s, err)
		msg, err = b.Read()
		require.NoError(s, err)
		require.JSONEq(s, `{"type":"connection_init","payload":{"token":"abc"}}`, msg)
		require.NoError(s, b.Send(`{"type":"connection_ack"}`))

		// Read the forwarded subscribe and complete the conversation
		msg, err = b.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"subscribe","id":"<<PRESENCE>>","payload":{"query":"subscription($key: String){streamA(key: $key){key}}","variables":{"key":"init"}}}`)
		subID := ExtractID(msg)

		require.NoError(s, b.Send(fmt.Sprintf(`{"id":"%s","type":"complete"}`, subID)))
		msg, err = c.Read()
		require.NoError(s, err)
		ja.Assertf(msg, `{"type":"complete","id":"1"}`)
	},
}
