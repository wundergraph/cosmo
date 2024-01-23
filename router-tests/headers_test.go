package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestForwardHeaders(t *testing.T) {
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

	t.Run("HTTP", func(t *testing.T) {
		cases := []struct {
			headerName string
			testName   string
		}{
			{headerNameInGlobalRule, "global rule"},
			{headerNameInSubgraphRule, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, c := range cases {
				headerName := c.headerName
				t.Run(c.testName, func(t *testing.T) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Header: http.Header{
							headerName: []string{headerValue},
						},
						Query: `query { headerValue(name:"` + headerName + `") }`,
					})
					require.Equal(t, `{"data":{"headerValue":"`+headerValue+`"}}`, res.Body)

				})
			}
		})
	})

	t.Run("HTTP with client extension", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			})
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
		})
	})

	t.Run("ws", func(t *testing.T) {
		cases := []struct {
			headerName string
			payload    string
			testName   string
		}{
			{headerNameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, c := range cases {
				c := c
				t.Run(c.testName, func(t *testing.T) {

					header := http.Header{
						c.headerName: []string{headerValue},
					}
					conn := xEnv.InitGraphQLWebSocketConnection(header, nil)
					err := conn.WriteJSON(&testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(c.payload),
					})
					require.NoError(t, err)
					var msg testenv.WebSocketMessage
					err = conn.ReadJSON(&msg)
					require.NoError(t, err)
					require.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue+`"}}}`, string(msg.Payload))
				})
			}
		})
	})

	t.Run("ws with client extension", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { headerValue(name:\"foo\", repeat:3) { value initialPayload }}","extensions":{"token":"123"}}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"headerValue":{"value":"","initialPayload":{"extensions":{"token":"123"}}}}}`, string(msg.Payload))
		})
	})

	t.Run("ws with multiple conns", func(t *testing.T) {
		t.Parallel()

		cases := []struct {
			headerName string
			payload    string
			testName   string
		}{
			{headerNameInGlobalRule, subscriptionForGlobalRulePayload, "global rule"},
			{headerNameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, c := range cases {
				c := c
				t.Run(c.testName, func(t *testing.T) {
					header1 := http.Header{
						c.headerName: []string{headerValue},
					}
					header2 := http.Header{
						c.headerName: []string{headerValue2},
					}
					conn1 := xEnv.InitGraphQLWebSocketConnection(header1, nil)
					conn2 := xEnv.InitGraphQLWebSocketConnection(header2, nil)

					var err error
					err = conn1.WriteJSON(testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(c.payload),
					})
					require.NoError(t, err)

					err = conn2.WriteJSON(testenv.WebSocketMessage{
						ID:      "2",
						Type:    "subscribe",
						Payload: []byte(c.payload),
					})
					require.NoError(t, err)

					var msg testenv.WebSocketMessage
					// Must match the 3 in the subscription payload
					for ii := 0; ii < 3; ii++ {
						err = conn1.ReadJSON(&msg)
						require.NoError(t, err)
						require.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue+`"}}}`, string(msg.Payload))

						err = conn2.ReadJSON(&msg)
						require.NoError(t, err)
						require.JSONEq(t, `{"data":{"headerValue":{"value":"`+headerValue2+`"}}}`, string(msg.Payload))
					}
				})
			}
		})
	})
}
