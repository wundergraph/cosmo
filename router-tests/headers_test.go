package integration

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestForwardHeaders(t *testing.T) {
	t.Parallel()

	const (
		// Make sure you copy these to the struct tag in the subscription test
		headerNameInGlobalRule        = "foo"
		headerNameInSubgraphRule      = "barista"              // This matches the regex in test1 subgraph forwarding rules
		headerNameCaseInsensitiveRule = "bAz-CAse-Insensitive" // This matches the regex in test1 subgraph forwarding rules
		headerValue                   = "bar"
		headerValue2                  = "baz"

		subscriptionForGlobalRulePayload       = `{"query": "subscription { headerValue(name:\"foo\", repeat:3) { value }}"}`
		subscriptionForSubgraphRulePayload     = `{"query": "subscription { headerValue(name:\"barista\", repeat:3) { value }}"}`
		subscriptionForSubgraphCaseRulePayload = `{"query": "subscription { headerValue(name:\"baz-case-insensitive\", repeat:3) { value }}"}`
	)

	headerRules := config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{
					Operation: config.HeaderRuleOperationPropagate,
					Named:     headerNameInGlobalRule,
				},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"test1": {
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Matching:  "(?i)^bar.*",
					},
					{
						Operation: config.HeaderRuleOperationPropagate,
						Matching:  "^baz-case-.*",
					},
				},
			},
		},
	}

	t.Run("cookie filtering should remove no cookies when not specified", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "Cookie",
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Cookies: []*http.Cookie{
					{
						Name:  "allowed",
						Value: "allowed",
					},
					{
						Name:  "allowed_as_well",
						Value: "allowed",
					},
				},
				Query: `query { headerValue(name:"Cookie") }`,
			})
			require.Equal(t, `{"data":{"headerValue":"allowed=allowed; allowed_as_well=allowed"}}`, res.Body)

		})
	})

	t.Run("cookie filtering should remove no cookies when whitelist is empty", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					CookieWhitelist: []string{},
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "Cookie",
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Cookies: []*http.Cookie{
					{
						Name:  "allowed",
						Value: "allowed",
					},
					{
						Name:  "allowed_as_well",
						Value: "allowed",
					},
				},
				Query: `query { headerValue(name:"Cookie") }`,
			})
			require.Equal(t, `{"data":{"headerValue":"allowed=allowed; allowed_as_well=allowed"}}`, res.Body)

		})
	})

	t.Run("cookie filtering should remove cookies not on the whitelist", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					CookieWhitelist: []string{"allowed"},
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "Cookie",
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Cookies: []*http.Cookie{
					{
						Name:  "allowed",
						Value: "allowed",
					},
					{
						Name:  "disallowed",
						Value: "disallowed",
					},
				},
				Query: `query { headerValue(name:"Cookie") }`,
			})
			require.Equal(t, `{"data":{"headerValue":"allowed=allowed"}}`, res.Body)

		})
	})

	t.Run("HTTP", func(t *testing.T) {
		t.Parallel()

		cases := []struct {
			headerName string
			testName   string
		}{
			{headerNameInGlobalRule, "global rule"},
			{headerNameInSubgraphRule, "subgraph rule"},
			{headerNameCaseInsensitiveRule, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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

	t.Run("SetHeadersFromContext", func(t *testing.T) {
		t.Parallel()

		setRequestDynamicAttribute := func(headerName, contextField string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Operation: config.HeaderRuleOperationSet,
								Name:      headerName,
								ValueFrom: &config.CustomDynamicAttribute{
									ContextField: contextField,
								}}}}})}
		}
		opNameHeader := "x-operation-info"

		t.Run("successfully sets operation name header", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: setRequestDynamicAttribute(opNameHeader, core.ContextFieldOperationName),
			},
				func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query myQuery { headerValue(name:"` + opNameHeader + `") }`,
					})
					headerVal := "myQuery"
					require.Equal(t, `{"data":{"headerValue":"`+headerVal+`"}}`, res.Body)
				})
		})

		t.Run("set dynamic header overwrites explicit header", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: setRequestDynamicAttribute(opNameHeader, core.ContextFieldOperationName),
			},
				func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
						Query: `query myQuery { headerValue(name:"` + opNameHeader + `") }`,
					}, map[string]string{
						opNameHeader: "not-myQuery",
					})
					require.NoError(t, err)
					headerVal := "myQuery"
					require.Equal(t, `{"data":{"headerValue":"`+headerVal+`"}}`, res.Body)
				})
		})
	})

	t.Run("HTTP with client extension", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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
		t.Parallel()

		cases := []struct {
			headerName string
			payload    string
			testName   string
		}{
			{headerNameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
			{headerNameCaseInsensitiveRule, subscriptionForSubgraphCaseRulePayload, "subgraph case insensitive rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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
					conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
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
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { headerValue(name:\"foo\", repeat:3) { value initialPayload }}","extensions":{"token":"123"}}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"headerValue":{"value":"","initialPayload":{"extensions":{"token":"123"}}}}}`, string(msg.Payload))
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
			{headerNameCaseInsensitiveRule, subscriptionForSubgraphCaseRulePayload, "subgraph case insensitive rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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
					conn1 := xEnv.InitGraphQLWebSocketConnection(header1, nil, nil)
					conn2 := xEnv.InitGraphQLWebSocketConnection(header2, nil, nil)

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

func TestForwardRenamedHeaders(t *testing.T) {
	t.Parallel()

	const (
		// Make sure you copy these to the struct tag in the subscription test
		headerNameInGlobalRule     = "foo"
		headerNameInSubgraphRule   = "barista" // This matches the regex in test1 subgraph forwarding rules
		headerRenameInGlobalRule   = "light"
		headerRenameInSubgraphRule = "cell" // This matches the regex in test1 subgraph forwarding rules
		headerValue                = "bar"
		headerValue2               = "baz"

		subscriptionForGlobalRulePayload   = `{"query": "subscription { headerValue(name:\"light\", repeat:3) { value }}"}`
		subscriptionForSubgraphRulePayload = `{"query": "subscription { headerValue(name:\"cell\", repeat:3) { value }}"}`
	)

	headerRules := config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{
					Operation: config.HeaderRuleOperationPropagate,
					Named:     headerNameInGlobalRule,
					Rename:    headerRenameInGlobalRule,
				},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"test1": {
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Matching:  "(?i)^bar.*",
						Rename:    headerRenameInSubgraphRule,
					},
				},
			},
		},
	}

	t.Run("HTTP", func(t *testing.T) {
		t.Parallel()

		cases := []struct {
			headerName   string
			headerRename string
			testName     string
		}{
			{headerNameInGlobalRule, headerRenameInGlobalRule, "global rule"},
			{headerNameInSubgraphRule, headerRenameInSubgraphRule, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, c := range cases {
				headerName := c.headerName
				log.Println(c.testName, c.headerName, c.headerRename)
				log.Println(headerName, headerValue)
				t.Run(c.testName, func(t *testing.T) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Header: http.Header{
							headerName: []string{headerValue},
						},
						Query: `query { headerValue(name:"` + c.headerRename + `") }`,
					})
					log.Println(res.Body)
					require.Equal(t, `{"data":{"headerValue":"`+headerValue+`"}}`, res.Body)

				})
			}
		})
	})

	t.Run("HTTP with client extension", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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
		t.Parallel()

		cases := []struct {
			headerName   string
			headerRename string
			payload      string
			testName     string
		}{
			{headerNameInSubgraphRule, headerRenameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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
					conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
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
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { headerValue(name:\"light\", repeat:3) { value initialPayload }}","extensions":{"token":"123"}}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"headerValue":{"value":"","initialPayload":{"extensions":{"token":"123"}}}}}`, string(msg.Payload))
		})
	})

	t.Run("ws with multiple conns", func(t *testing.T) {
		t.Parallel()

		cases := []struct {
			headerName   string
			headerRename string
			payload      string
			testName     string
		}{
			{headerNameInGlobalRule, headerRenameInGlobalRule, subscriptionForGlobalRulePayload, "global rule"},
			{headerNameInSubgraphRule, headerRenameInSubgraphRule, subscriptionForSubgraphRulePayload, "subgraph rule"},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 10
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
					conn1 := xEnv.InitGraphQLWebSocketConnection(header1, nil, nil)
					conn2 := xEnv.InitGraphQLWebSocketConnection(header2, nil, nil)

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

	t.Run("forward all headers that dont match the exclude list", func(t *testing.T) {
		t.Parallel()

		header1, value1 := "header1", "value1"
		header2, value2 := "header2", "value2"
		header3, value3 := "header3", "value3"

		type headerPayload struct {
			Data map[string]string `json:"data"`
		}

		headerRules := &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{
					Operation:   config.HeaderRuleOperationPropagate,
					Matching:    `^(` + strings.ToUpper(header1) + `|Header7)$`,
					NegateMatch: true,
				},
			},
		}

		t.Run("for all", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: headerRules,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: http.Header{
						header1: []string{value1},
						header2: []string{value2},
						header3: []string{value3},
					},
					Query: `query {
						val1: headerValue(name:"` + header1 + `"),
						val2: headerValue(name:"` + header2 + `"),
						val3: headerValue(name:"` + header3 + `")
					}`,
				})

				require.JSONEq(t, `{"data":{"val1":"","val2":"`+value2+`","val3":"`+value3+`"}}`, res.Body)

				var headerPayloadEntry headerPayload
				err := json.Unmarshal([]byte(res.Body), &headerPayloadEntry)
				require.NoError(t, err)

				// Header1 should be excluded because we are looking for everything but header1
				require.Equal(t, headerPayloadEntry.Data["val1"], "")
				require.Equal(t, headerPayloadEntry.Data["val2"], value2)
				require.Equal(t, headerPayloadEntry.Data["val3"], value3)
			})
		})

		t.Run("for subgraph", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						Subgraphs: map[string]*config.GlobalHeaderRule{
							"test1": headerRules,
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: http.Header{
						header1: []string{value1},
						header2: []string{value2},
						header3: []string{value3},
					},
					Query: `query {
						val1: headerValue(name:"` + header1 + `"),
						val2: headerValue(name:"` + header2 + `"),
						val3: headerValue(name:"` + header3 + `")
					}`,
				})
				require.JSONEq(t, `{"data":{"val1":"","val2":"`+value2+`","val3":"`+value3+`"}}`, res.Body)

				var headerPayloadEntry headerPayload
				err := json.Unmarshal([]byte(res.Body), &headerPayloadEntry)
				require.NoError(t, err)

				// Header1 should be excluded because we are looking for everything but header1
				require.Equal(t, headerPayloadEntry.Data["val1"], "")
				require.Equal(t, headerPayloadEntry.Data["val2"], value2)
				require.Equal(t, headerPayloadEntry.Data["val3"], value3)
			})
		})

	})
}
