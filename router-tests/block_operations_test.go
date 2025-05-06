package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestBlockOperations(t *testing.T) {
	t.Parallel()

	t.Run("block mutations", func(t *testing.T) {
		t.Parallel()

		t.Run("should allow all operations", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)
			})
		})

		t.Run("should block all operations", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockOperationConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, res.Body)
			})
		})

		t.Run("should block operations by header match expression", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "request.header.Get('graphql-client-name') == 'my-client'",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				// Positive test

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client-different"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)

				// Negative test

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, res.Body)
			})
		})

		t.Run("should block operations by query match expression", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "request.url.query.foo == 'bar'",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				// Negative test

				data, err := json.Marshal(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})

				require.NoError(t, err)
				req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(data))
				require.NoError(t, err)

				res, err := xEnv.MakeGraphQLRequestRaw(req)
				require.NoError(t, err)

				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)

				// Positive test

				req, err = http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL()+"?foo=bar", bytes.NewReader(data))
				require.NoError(t, err)

				res, err = xEnv.MakeGraphQLRequestRaw(req)
				require.NoError(t, err)

				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, res.Body)
			})
		})

		t.Run("should block operation by scope expression condition", func(t *testing.T) {
			t.Parallel()

			authenticators, authServer := ConfigureAuth(t)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "'read:miscellaneous' in request.auth.scopes && request.auth.isAuthenticated",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				token, err := authServer.Token(map[string]any{
					"scope": "write:fact read:miscellaneous read:all",
				})
				require.NoError(t, err)
				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
				require.NoError(t, err)
				defer res.Body.Close()
				require.Equal(t, http.StatusOK, res.StatusCode)
				data, err := io.ReadAll(res.Body)
				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, string(data))

				// Negative test

				token, err = authServer.Token(map[string]any{
					"scope": "write:fact read:all",
				})
				require.NoError(t, err)
				header = http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				res, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: DIRECTIVE }) { description } }"}
			`))
				require.NoError(t, err)
				defer res.Body.Close()
				require.Equal(t, http.StatusOK, res.StatusCode)
				data, err = io.ReadAll(res.Body)
				require.NoError(t, err)
				require.Equal(t, `{"data":{"addFact":{"description":"description"}}}`, string(data))
			})
		})
	})

	t.Run("block subscriptions", func(t *testing.T) {

		t.Run("should block all subscriptions", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				err := conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "error", msg.Type)
				require.Equal(t, `[{"message":"operation type 'subscription' is blocked"}]`, string(msg.Payload))
			})
		})

		t.Run("should block subscriptions by header match expression", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "request.header.Get('graphql-client-name') == 'my-client'",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				type currentTimePayload struct {
					Data struct {
						CurrentTime struct {
							UnixTime  float64 `json:"unixTime"`
							Timestamp string  `json:"timestamp"`
						} `json:"currentTime"`
					} `json:"data"`
				}

				// Positive test

				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				err := conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				var payload currentTimePayload

				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)

				err = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, err)

				require.NotEmpty(t, payload.Data.CurrentTime.UnixTime)
				require.NotEmpty(t, payload.Data.CurrentTime.Timestamp)

				_ = conn.Close()

				// Negative test

				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				conn = xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
				err = conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				msg = testenv.WebSocketMessage{}
				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "error", msg.Type)
				require.Equal(t, `[{"message":"operation type 'subscription' is blocked"}]`, string(msg.Payload))
			})
		})

		t.Run("should block subscriptions by scope match expression", func(t *testing.T) {
			t.Parallel()

			authenticators, authServer := ConfigureAuth(t)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
					core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
						RejectOperationIfUnauthorized: false,
					}),
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "'read:block' in request.auth.scopes && request.auth.isAuthenticated",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				type currentTimePayload struct {
					Data struct {
						CurrentTime struct {
							UnixTime  float64 `json:"unixTime"`
							Timestamp string  `json:"timestamp"`
						} `json:"currentTime"`
					} `json:"data"`
				}

				// Positive test

				token, err := authServer.Token(map[string]any{
					"scope": "read:all",
				})
				require.NoError(t, err)

				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}

				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				err = conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				var payload currentTimePayload

				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)

				err = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, err)

				require.NotEmpty(t, payload.Data.CurrentTime.UnixTime)
				require.NotEmpty(t, payload.Data.CurrentTime.Timestamp)

				// Negative test

				token, err = authServer.Token(map[string]any{
					"scope": "read:block",
				})
				require.NoError(t, err)

				header = http.Header{
					"Authorization": []string{"Bearer " + token},
				}

				conn = xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
				err = conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				msg = testenv.WebSocketMessage{}

				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "error", msg.Type)
				require.Equal(t, `[{"message":"operation type 'subscription' is blocked"}]`, string(msg.Payload))

				_ = conn.Close()
			})
		})

		t.Run("should block subscriptions by scope match expression and from initial payload enabled", func(t *testing.T) {
			t.Parallel()

			authenticators, authServer := ConfigureAuth(t)

			testenv.Run(t, &testenv.Config{
				ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
					cfg.Authentication.FromInitialPayload.Enabled = true
					cfg.Enabled = true
				},
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
					core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
						RejectOperationIfUnauthorized: false,
					}),
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "'read:block' in request.auth.scopes && request.auth.isAuthenticated",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				type currentTimePayload struct {
					Data struct {
						CurrentTime struct {
							UnixTime  float64 `json:"unixTime"`
							Timestamp string  `json:"timestamp"`
						} `json:"currentTime"`
					} `json:"data"`
				}

				// Positive test

				token, err := authServer.Token(map[string]any{
					"scope": "read:all",
				})
				require.NoError(t, err)

				header := http.Header{
					"Authorization": []string{"Bearer " + token},
				}

				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				err = conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				var payload currentTimePayload

				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)

				err = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, err)

				require.NotEmpty(t, payload.Data.CurrentTime.UnixTime)
				require.NotEmpty(t, payload.Data.CurrentTime.Timestamp)

				// Negative test

				token, err = authServer.Token(map[string]any{
					"scope": "read:block",
				})
				require.NoError(t, err)

				header = http.Header{
					"Authorization": []string{"Bearer " + token},
				}

				conn = xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
				err = conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)

				msg = testenv.WebSocketMessage{}

				err = conn.ReadJSON(&msg)
				require.NoError(t, err)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "error", msg.Type)
				require.Equal(t, `[{"message":"operation type 'subscription' is blocked"}]`, string(msg.Payload))

				_ = conn.Close()
			})
		})

	})

	t.Run("block non-persisted operations", func(t *testing.T) {
		t.Parallel()

		t.Run("should allow operations", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockNonPersistedOperations = config.BlockOperationConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				// Negative test

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
				require.Equal(t, `{"errors":[{"message":"non-persisted operation is blocked"}]}`, res.Body)

				// Positive test

				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			})
		})

		t.Run("should block operation by header match expression", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockNonPersistedOperations = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "request.header.Get('graphql-client-name') == 'my-client'",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				// Negative test
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client-different"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)

				// Positive test
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
				require.Equal(t, `{"errors":[{"message":"non-persisted operation is blocked"}]}`, res.Body)
			})
		})

		t.Run("should not be possible to access unexported fields", func(t *testing.T) {
			t.Parallel()
			err := testenv.RunWithError(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockNonPersistedOperations = config.BlockOperationConfiguration{
						Enabled:   true,
						Condition: "request.header.Header.Set('graphql-client-name')",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Fatal("this should not be possible")
			})

			require.ErrorContains(t, err, "line 1, column 15: type expr.RequestHeaders has no field Header")
		})
	})
}
