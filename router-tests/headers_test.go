package integration_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestForwardHeaders(t *testing.T) {
	t.Parallel()
	const (
		// Make sure you copy these to the struct tag in the subscription test
		headerNameInGlobalRule   = "foo"
		headerNameInSubgraphRule = "barista" // This matches the regex in test1 subgraph forwarding rules
		headerValue              = "bar"
		headerValue2             = "baz"

		subscriptionForGlobalRulePayload   = `{"query": "subscription { headerValue(name:\"foo\", repeat:3) { value }}"}`
		subscriptionForSubgraphRulePayload = `{"query": "subscription { headerValue(name:\"barista\", repeat:3) { value }}"}`
	)

	headerRules := config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
				{
					Operation: config.HeaderRuleOperationPropagate,
					Named:     headerNameInGlobalRule,
				},
			},
		},
		Subgraphs: map[string]config.GlobalHeaderRule{
			"test1": {
				Request: []config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Matching:  "(?i)^bar.*",
					},
				},
			},
		},
	}
	server, serverPort := setupListeningServer(t, core.WithHeaderRules(headerRules))

	t.Run("HTTP", func(t *testing.T) {
		cases := []struct {
			headerName string
			testName   string
		}{
			{headerNameInGlobalRule, "global rule"},
			{headerNameInSubgraphRule, "subgraph rule"},
		}
		for _, c := range cases {
			headerName := c.headerName
			t.Run(c.testName, func(t *testing.T) {
				rr := httptest.NewRecorder()
				req := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query": "query { headerValue(name:\"`+headerName+`\") }"}`))
				req.Header.Add(headerName, headerValue)
				server.Server.Handler.ServeHTTP(rr, req)
				assert.Equal(t, `{"data":{"headerValue":"`+headerValue+`"}}`, rr.Body.String())
			})
		}
	})

	t.Run("HTTP with client extension", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query": "query { initialPayload }","extensions":{"token":"123"}}`))
		server.Server.Handler.ServeHTTP(rr, req)
		assert.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, rr.Body.String())
	})

	t.Run("ws", func(t *testing.T) {
		cases := []struct {
			headerName string
			payload    string
			testName   string
		}{
			{headerNameInGlobalRule, subscriptionForGlobalRulePayload, "global rule"},
			{headerNameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
		}
		for _, c := range cases {
			c := c
			t.Run(c.testName, func(t *testing.T) {
				header := http.Header{
					c.headerName: []string{headerValue},
				}
				conn := connectedWebsocket(t, serverPort, "/graphql", &connectedWebsocketOptions{Header: header})
				err := conn.WriteJSON(&wsMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(c.payload),
				})
				assert.NoError(t, err)
				var msg wsMessage
				err = connReadJSON(conn, &msg)
				require.NoError(t, err)
				assert.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue+`"}}}`, string(msg.Payload))
			})
		}
	})

	t.Run("ws with client extension", func(t *testing.T) {
		conn := connectedWebsocket(t, serverPort, "/graphql", nil)
		err := conn.WriteJSON(&wsMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: []byte(`{"query":"subscription { headerValue(name:\"foo\", repeat:3) { value initialPayload }}","extensions":{"token":"123"}}`),
		})
		assert.NoError(t, err)
		var msg wsMessage
		err = connReadJSON(conn, &msg)
		require.NoError(t, err)
		assert.JSONEq(t, `{"data":{"headerValue":{"value":"","initialPayload":{"extensions":{"token":"123"}}}}}`, string(msg.Payload))
	})

	t.Run("ws with multiple conns", func(t *testing.T) {
		cases := []struct {
			headerName string
			payload    string
			testName   string
		}{
			{headerNameInGlobalRule, subscriptionForGlobalRulePayload, "global rule"},
			{headerNameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
		}
		for _, c := range cases {
			c := c
			t.Run(c.testName, func(t *testing.T) {
				header1 := http.Header{
					c.headerName: []string{headerValue},
				}
				header2 := http.Header{
					c.headerName: []string{headerValue2},
				}
				conn1 := connectedWebsocket(t, serverPort, "/graphql", &connectedWebsocketOptions{Header: header1})
				conn2 := connectedWebsocket(t, serverPort, "/graphql", &connectedWebsocketOptions{Header: header2})
				var err error
				err = conn1.WriteJSON(&wsMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(c.payload),
				})
				assert.NoError(t, err)
				err = conn2.WriteJSON(&wsMessage{
					ID:      "2",
					Type:    "subscribe",
					Payload: []byte(c.payload),
				})
				assert.NoError(t, err)
				var msg wsMessage
				// Must match the 3 in the subscription payload
				for ii := 0; ii < 3; ii++ {
					err = connReadJSON(conn1, &msg)
					require.NoError(t, err)
					assert.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue+`"}}}`, string(msg.Payload))

					err = connReadJSON(conn2, &msg)
					require.NoError(t, err)
					assert.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue2+`"}}}`, string(msg.Payload))
				}
			})
		}
	})

}
