package integration_test

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/buger/jsonparser"
	"github.com/gorilla/websocket"
	"github.com/hasura/go-graphql-client"
	"github.com/hasura/go-graphql-client/pkg/jsonutil"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestWebSockets(t *testing.T) {
	t.Parallel()

	t.Run("query", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("query with authorization reject", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		authOptions := authentication.JWKSAuthenticatorOptions{
			Name: jwksName,
			URL:  authServer.JWKSURL(),
		}
		authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id startDate } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized"}]`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("query with authorization no-reject", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		authOptions := authentication.JWKSAuthenticatorOptions{
			Name: jwksName,
			URL:  authServer.JWKSURL(),
		}
		authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: false,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id startDate } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized to load field 'Query.employees.startDate'. Reason: not authenticated","path":["employees",0,"startDate"]}]`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription with authorization no-reject", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		authOptions := authentication.JWKSAuthenticatorOptions{
			Name: jwksName,
			URL:  authServer.JWKSURL(),
		}
		authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: false,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } startDate }}"}`),
			})
			require.NoError(t, err)
			go func() {
				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				// Trigger the subscription via NATS
				subject := "employeeUpdated.3"
				message := []byte(`{"id":3,"__typename": "Employee"}`)
				err := xEnv.NC.Publish(subject, message)
				require.NoError(t, err)
				err = xEnv.NC.Flush()
				require.NoError(t, err)
			}()
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized to load field 'Subscription.employeeUpdated.startDate'. Reason: not authenticated","path":["employeeUpdated","startDate"]}]`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription with authorization reject", func(t *testing.T) {
		t.Parallel()
		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		authOptions := authentication.JWKSAuthenticatorOptions{
			Name: jwksName,
			URL:  authServer.JWKSURL(),
		}
		authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } startDate }}"}`),
			})
			require.NoError(t, err)
			go func() {
				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				// Trigger the subscription via NATS
				subject := "employeeUpdated.3"
				message := []byte(`{"id":3,"__typename": "Employee"}`)
				err := xEnv.NC.Publish(subject, message)
				require.NoError(t, err)
				err = xEnv.NC.Flush()
				require.NoError(t, err)
			}()
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized"}]`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 10
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

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload currentTimePayload

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)

			unix1 := payload.Data.CurrentTime.UnixTime

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)

			unix2 := payload.Data.CurrentTime.UnixTime
			require.Equal(t, unix1+1, unix2)

			// Sending a complete must stop the subscription
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "complete",
			})
			require.NoError(t, err)

			var complete testenv.WebSocketMessage
			err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
			require.NoError(t, err)
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "1", complete.ID)
			require.Equal(t, "complete", complete.Type)

			err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
			require.NoError(t, err)
			_, _, err = conn.ReadMessage()
			require.Error(t, err)
			var netErr net.Error
			if errors.As(err, &netErr) {
				require.True(t, netErr.Timeout())
			} else {
				require.Fail(t, "expected net.Error")
			}
		})
	})
	t.Run("error", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
			})
			require.NoError(t, err)
			conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "error", msg.Type)
			// Payload should be an array of GraphQLError
			var errs []testenv.GraphQLError
			err = json.Unmarshal(msg.Payload, &errs)
			require.NoError(t, err)
			require.Len(t, errs, 1)
			require.Equal(t, errs[0].Message, `field: does_not_exist not defined on type: Subscription`)
		})
	})
	t.Run("subscription with library", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				CurrentTime struct {
					UnixTime  float64 `graphql:"unixTime"`
					Timestamp string  `graphql:"timeStamp"`
				} `graphql:"currentTime"`
			}
			protocols := []graphql.SubscriptionProtocolType{
				graphql.GraphQLWS,
				graphql.SubscriptionsTransportWS,
			}
			for _, p := range protocols {
				p := p
				t.Run(string(p), func(t *testing.T) {
					client := graphql.NewSubscriptionClient(xEnv.GraphQLSubscriptionURL()).WithProtocol(p)
					t.Cleanup(func() {
						err := client.Close()
						require.NoError(t, err)
					})
					var firstTime float64
					subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
						require.NoError(t, errValue)
						data := subscription
						err := jsonutil.UnmarshalGraphQL(dataValue, &data)
						require.NoError(t, err)
						if firstTime == 0 {
							firstTime = data.CurrentTime.UnixTime
						} else {
							require.Equal(t, firstTime+1, data.CurrentTime.UnixTime)
							return graphql.ErrSubscriptionStopped
						}
						return nil
					})
					require.NoError(t, err)
					require.NotEqual(t, "", subscriptionID)
					require.NoError(t, client.Run())
				})
			}
		})
	})
	t.Run("forward extensions", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make sure sending two simultaneous subscriptions with different extensions
			// triggers two subscriptions to the upstream
			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			conn2 := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			var err error
			err = conn1.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }","extensions":{"token":"123"}}`),
			})
			require.NoError(t, err)

			err = conn2.WriteJSON(&testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }","extensions":{"token":"456"}}`),
			})
			require.NoError(t, err)

			var msg testenv.WebSocketMessage
			var payload struct {
				Data struct {
					InitialPayload struct {
						Extensions struct {
							Token string `json:"token"`
						} `json:"extensions"`
					} `json:"initialPayload"`
				} `json:"data"`
			}
			err = conn1.ReadJSON(&msg)
			require.NoError(t, err)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, "123", payload.Data.InitialPayload.Extensions.Token)

			err = conn2.ReadJSON(&msg)
			require.NoError(t, err)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, "456", payload.Data.InitialPayload.Extensions.Token)
		})
	})
	t.Run("same graphql path as playground", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, []byte(`{"123": 456, "extensions": {"hello": "world"}}`))
			var err error
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"initialPayload":{"123":456,"extensions":{"hello":"world"}}}}`, string(msg.Payload))
		})
	})
	t.Run("different path", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/foo",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, []byte(`{"123": 456, "extensions": {"hello": "world"}}`))
			var err error
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"initialPayload":{"123":456,"extensions":{"hello":"world"}}}}`, string(msg.Payload))
		})
	})

	// times out on GitHub Actions

	t.Run("shutdown with epoll", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableWebSocketEpollKqueue = true
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
			})
			require.NoError(t, err)
			// Discard the first message
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			xEnv.Shutdown()
			_, _, err = conn.NextReader()
			// Check that the WS client error indicates the connection was unexpectedly closed
			closeError, ok := err.(*websocket.CloseError)
			require.True(t, ok)
			require.Equal(t, websocket.CloseAbnormalClosure, closeError.Code)
		})
	})

	t.Run("shutdown without epoll", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableWebSocketEpollKqueue = false
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
			})
			require.NoError(t, err)
			// Discard the first message
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			xEnv.Shutdown()
			_, _, err = conn.NextReader()
			// Check that the WS client error indicates the connection was unexpectedly closed
			closeError, ok := err.(*websocket.CloseError)
			require.True(t, ok)
			require.Equal(t, websocket.CloseAbnormalClosure, closeError.Code)
		})
	})
	t.Run("single connection with initial payload", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, []byte(`{"123":456,"extensions":{"hello":"world"}}`))
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"initialPayload":{"123":456,"extensions":{"hello":"world"}}}}`, string(msg.Payload))
		})
	})
	t.Run("single connection with initial payload and extensions in the request", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// "extensions" in the request should override the "extensions" in initial payload
			conn := xEnv.InitGraphQLWebSocketConnection(nil, []byte(`{"123":456,"extensions":{"hello":"world"}}`))
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }","extensions":{"hello":"world2"}}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"initialPayload":{"123":456,"extensions":{"hello":"world2"}}}}`, string(msg.Payload))
		})
	})
	t.Run("single connection multiple differing subscriptions", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)

			xEnv.WaitForConnectionCount(1, time.Second*5)

			sub1 := testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`),
			}
			err := conn.WriteJSON(&sub1)
			require.NoError(t, err)

			sub2 := testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			}
			err = conn.WriteJSON(&sub2)
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(2, time.Second*5)

			wg := sync.WaitGroup{}
			wg.Add(1)

			count := 0
			sub1Count := 0
			sub2Count := 0

			go func() {

				defer conn.Close()

				var msg testenv.WebSocketMessage
				for {
					err := conn.ReadJSON(&msg)
					if err != nil {
						return
					}
					if msg.Type == "next" {
						count++
						switch msg.ID {
						case "1":
							stefan, err := jsonparser.GetString(msg.Payload, "data", "employeeUpdated", "details", "forename")
							require.NoError(t, err)
							require.Equal(t, "Stefan", stefan)
							sub1Count++
							if sub1Count == 2 {
								stop := testenv.WebSocketMessage{
									ID:   "1",
									Type: "complete",
								}
								err = conn.WriteJSON(&stop)
								require.NoError(t, err)
								var complete testenv.WebSocketMessage
								err = conn.ReadJSON(&complete)
								require.NoError(t, err)
								require.Equal(t, "1", complete.ID)
								require.Equal(t, "complete", complete.Type)
							}
						case "2":
							timeStamp, err := jsonparser.GetString(msg.Payload, "data", "currentTime", "timeStamp")
							require.NoError(t, err)
							require.NotEqual(t, "", timeStamp)
							sub2Count++
							if sub2Count == 2 {
								stop := testenv.WebSocketMessage{
									ID:   "2",
									Type: "complete",
								}
								err = conn.WriteJSON(&stop)
								require.NoError(t, err)
								var complete testenv.WebSocketMessage
								err = conn.ReadJSON(&complete)
								require.NoError(t, err)
								require.Equal(t, "2", complete.ID)
								require.Equal(t, "complete", complete.Type)
							}
						}
					}
					if count == 4 {
						terminate := testenv.WebSocketMessage{
							Type: "connection_terminate",
						}
						err = conn.WriteJSON(&terminate)
						require.NoError(t, err)
						_, _, err = conn.NextReader()
						require.Error(t, err)
						wg.Done()
						return
					}
				}
			}()

			go func() {
				time.Sleep(time.Millisecond * 100)
				err := xEnv.NC.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
				time.Sleep(time.Millisecond * 100)
				err = xEnv.NC.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
			}()

			wg.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
			xEnv.WaitForConnectionCount(0, time.Second*5)
		})
	})
	t.Run("multiple connections with different initial payloads", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketReadTimeout = time.Millisecond * 10
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// "extensions" in the request should override the "extensions" in initial payload
			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, []byte(`{"id":1}`))
			conn2 := xEnv.InitGraphQLWebSocketConnection(nil, []byte(`{"id":2}`))
			err := conn1.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)
			err = conn2.WriteJSON(&testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn1.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"initialPayload":{"id":1}}}`, string(msg.Payload))

			err = conn2.ReadJSON(&msg)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"initialPayload":{"id":2}}}`, string(msg.Payload))
		})
	})
}
