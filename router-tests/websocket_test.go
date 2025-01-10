package integration

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"go.uber.org/zap"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
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
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestWebSockets(t *testing.T) {
	t.Parallel()

	t.Run("disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			DisableWebSockets: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, _, err := xEnv.GraphQLWebsocketDialWithRetry(nil, nil)
			require.Error(t, err)
		})
	})
	t.Run("query", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
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
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
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
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
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
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
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
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
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
			require.Equal(t, `[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",0,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",1,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",2,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",3,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",4,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",5,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",6,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",7,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",8,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",9,"startDate"]}]`, string(res.Payload))
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
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
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
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } startDate }}"}`),
			})
			require.NoError(t, err)

			go func() {
				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				// Trigger the subscription via NATS
				subject := xEnv.GetPubSubName("employeeUpdated.3")
				message := []byte(`{"id":3,"__typename": "Employee"}`)
				err := xEnv.NatsConnectionDefault.Publish(subject, message)
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()

			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized to load field 'Subscription.employeeUpdated.startDate', Reason: not authenticated.","path":["employeeUpdated","startDate"]}]`, string(res.Payload))

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription with authorization reject", func(t *testing.T) {
		t.Parallel()
		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
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
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } startDate }}"}`),
			})
			require.NoError(t, err)
			go func() {
				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				// Trigger the subscription via NATS
				subject := xEnv.GetPubSubName("employeeUpdated.3")
				message := []byte(`{"id":3,"__typename": "Employee"}`)
				err := xEnv.NatsConnectionDefault.Publish(subject, message)
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized"}]`, string(res.Payload))

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription with authorization via initial payload with reject", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.WebsocketInitialPayloadAuthenticatorOptions{
			TokenDecoder: tokenDecoder,
			Key:          "Authorization",
		}
		authenticator, err := authentication.NewWebsocketInitialPayloadAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
				cfg.Authentication.FromInitialPayload.Enabled = true
				cfg.Enabled = true
			},
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			initialPayload := []byte(`{"Authorization":"Bearer ` + token + `"}`)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, initialPayload)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id }}"}`),
			})
			require.NoError(t, err)

			go func() {
				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				// Trigger the subscription via NATS
				subject := xEnv.GetPubSubName("employeeUpdated.3")
				message := []byte(`{"id":3,"__typename": "Employee"}`)
				err := xEnv.NatsConnectionDefault.Publish(subject, message)
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()

			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `{"data":{"employeeUpdated":{"id":3}}}`, string(res.Payload))

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription with authorization via initial payload no token with reject", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.WebsocketInitialPayloadAuthenticatorOptions{
			TokenDecoder: tokenDecoder,
			Key:          "Authorization",
		}
		authenticator, err := authentication.NewWebsocketInitialPayloadAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
				cfg.Authentication.FromInitialPayload.Enabled = true
				cfg.Enabled = true
			},
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.NoError(t, err)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id }}"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			payload, err := json.Marshal(res.Payload)
			require.NoError(t, err)
			require.JSONEq(t, `[{"message":"unauthorized"}]`, string(payload))

			xEnv.WaitForSubscriptionCount(0, time.Second*5)
			xEnv.WaitForConnectionCount(0, time.Second*5)
			require.NoError(t, conn.Close())
		})
	})
	t.Run("subscription with authorization via initial payload invalid token without reject", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authOptions := authentication.WebsocketInitialPayloadAuthenticatorOptions{
			TokenDecoder: tokenDecoder,
			Key:          "Authorization",
		}
		authenticator, err := authentication.NewWebsocketInitialPayloadAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
				cfg.Authentication.FromInitialPayload.Enabled = true
				cfg.Enabled = true
			},
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: false,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.NoError(t, err)
			initialPayload := []byte(`{"Authorization": true }`)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, initialPayload)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id }}"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			payload, err := json.Marshal(res.Payload)
			require.NoError(t, err)
			require.JSONEq(t, `[{"message":"unauthorized"}]`, string(payload))

			xEnv.WaitForSubscriptionCount(0, time.Second*5)
			xEnv.WaitForConnectionCount(0, time.Second*5)
			require.NoError(t, conn.Close())
		})
	})
	t.Run("subscription without authorization with initial payload token export to request header", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
				cfg.Authentication.FromInitialPayload.Enabled = true
				cfg.Authentication.FromInitialPayload.ExportToken.Enabled = true
				cfg.Enabled = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			initialPayload := []byte(`{"Authorization":"` + token + `"}`)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, initialPayload)
			err = conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id }}"}`),
			})
			require.NoError(t, err)

			var done atomic.Bool
			go func() {
				defer done.Store(true)
				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				// Trigger the subscription via NATS
				subject := xEnv.GetPubSubName("employeeUpdated.3")
				message := []byte(`{"id":3,"__typename": "Employee"}`)
				err := xEnv.NatsConnectionDefault.Publish(subject, message)
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()
			require.Eventually(t, done.Load, time.Second*5, time.Millisecond*100)

			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `{"data":{"employeeUpdated":{"id":3}}}`, string(res.Payload))
			require.NoError(t, conn.Close())

			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			expectConnectAndReadCurrentTime(t, xEnv)
		})
	})
	t.Run("subscription with multiple reconnects and netPoll", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			expectConnectAndReadCurrentTime(t, xEnv)
			expectConnectAndReadCurrentTime(t, xEnv)
		})
	})
	t.Run("subscription with multiple reconnects and netPoll disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableNetPoll = false
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			expectConnectAndReadCurrentTime(t, xEnv)
			expectConnectAndReadCurrentTime(t, xEnv)
		})
	})
	t.Run("subscription with header propagation", func(t *testing.T) {
		t.Parallel()

		headerRules := config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "Authorization",
					},
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "Not-AllowListed-But-Forwarded",
					},
				},
			},
		}

		var wg sync.WaitGroup
		wg.Add(1)

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							defer wg.Done()

							notAllowListedButForwarded := r.Header.Get("Not-AllowListed-But-Forwarded")
							require.Equal(t, "but still part of the origin upgrade request", notAllowListedButForwarded)

							upgrader := websocket.Upgrader{
								CheckOrigin: func(r *http.Request) bool {
									return true
								},
								Subprotocols: []string{"graphql-transport-ws"},
							}
							require.Equal(t, "Bearer test", r.Header.Get("Authorization"))
							conn, err := upgrader.Upgrade(w, r, nil)
							require.NoError(t, err)
							defer conn.Close()

							_, message, err := conn.ReadMessage()
							require.NoError(t, err)
							require.Equal(t, `{"type":"connection_init","payload":{"Custom-Auth":"test","extensions":{"upgradeHeaders":{"Authorization":"Bearer test","Canonical-Header-Name":"matches","Reverse-Canonical-Header-Name":"matches as well","X-Custom-Auth":"customAuth"},"upgradeQueryParams":{"token":"Bearer Something"},"initialPayload":{"Custom-Auth":"test"}}}}`, string(message))

							err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"connection_ack"}`))
							require.NoError(t, err)

							_, message, err = conn.ReadMessage()
							require.NoError(t, err)
							require.Equal(t, `{"id":"1","type":"subscribe","payload":{"query":"subscription{currentTime {unixTime timeStamp}}","extensions":{"upgradeHeaders":{"Authorization":"Bearer test","Canonical-Header-Name":"matches","Reverse-Canonical-Header-Name":"matches as well","X-Custom-Auth":"customAuth"},"upgradeQueryParams":{"token":"Bearer Something"},"initialPayload":{"Custom-Auth":"test"}}}}`, string(message))

							err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"next","id":"1","payload":{"data":{"currentTime":{"unixTime":1,"timeStamp":"2021-09-01T12:00:00Z"}}}}`))
							require.NoError(t, err)

							_, message, err = conn.ReadMessage()
							if errors.Is(err, websocket.ErrCloseSent) {
								return
							}
							require.Equal(t, `{"id":"1","type":"complete"}`, string(message))

							err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"complete","id":"1"}`))
							require.NoError(t, err)
						})
					},
				},
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

			conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
				"Authorization":                 []string{"Bearer test"},
				"Ignored":                       []string{"ignored"},
				"X-Custom-Auth":                 []string{"customAuth"},
				"canonical-header-name":         []string{"matches"},
				"Reverse-Canonical-Header-Name": []string{"matches as well"},
				"Not-AllowListed-But-Forwarded": []string{"but still part of the origin upgrade request"},
			}, url.Values{
				"token":   []string{"Bearer Something"},
				"ignored": []string{"ignored"},
			},
				[]byte(`{"Custom-Auth":"test"}`),
			)
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
			require.Equal(t, float64(1), payload.Data.CurrentTime.UnixTime)

			// Sending a complete must stop the subscription
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "complete",
			})
			require.NoError(t, err)

			var complete testenv.WebSocketMessage
			err = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			require.NoError(t, err)
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "1", complete.ID)
			require.Equal(t, "complete", complete.Type)

			wg.Wait()

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("empty allow lists should allow all headers and query args", func(t *testing.T) {
		t.Parallel()

		headerRules := config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "Authorization",
					},
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "Not-AllowListed-But-Forwarded",
					},
				},
			},
		}

		var wg sync.WaitGroup
		wg.Add(1)

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
				cfg.ForwardUpgradeHeaders.AllowList = nil
				cfg.ForwardUpgradeQueryParams.AllowList = nil
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							defer wg.Done()

							notAllowListedButForwarded := r.Header.Get("Not-AllowListed-But-Forwarded")
							require.Equal(t, "but still part of the origin upgrade request", notAllowListedButForwarded)

							upgrader := websocket.Upgrader{
								CheckOrigin: func(r *http.Request) bool {
									return true
								},
								Subprotocols: []string{"graphql-transport-ws"},
							}
							require.Equal(t, "Bearer test", r.Header.Get("Authorization"))
							conn, err := upgrader.Upgrade(w, r, nil)
							require.NoError(t, err)
							defer conn.Close()

							_, message, err := conn.ReadMessage()
							require.NoError(t, err)
							message = jsonparser.Delete(message, "payload", "extensions", "upgradeHeaders", "Sec-Websocket-Key") // Sec-Websocket-Key is a random value
							require.Equal(t, `{"type":"connection_init","payload":{"Custom-Auth":"test","extensions":{"upgradeHeaders":{"Authorization":"Bearer test","Canonical-Header-Name":"matches","Connection":"Upgrade","Ignored":"ignored","Not-Allowlisted-But-Forwarded":"but still part of the origin upgrade request","Reverse-Canonical-Header-Name":"matches as well","Sec-Websocket-Protocol":"graphql-transport-ws","Sec-Websocket-Version":"13","Upgrade":"websocket","User-Agent":"Go-http-client/1.1","X-Custom-Auth":"customAuth"},"upgradeQueryParams":{"ignored":"ignored","token":"Bearer Something","x-custom-auth":"customAuth"},"initialPayload":{"Custom-Auth":"test"}}}}`, string(message))

							err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"connection_ack"}`))
							require.NoError(t, err)

							_, message, err = conn.ReadMessage()
							require.NoError(t, err)
							message = jsonparser.Delete(message, "payload", "extensions", "upgradeHeaders", "Sec-Websocket-Key") // Sec-Websocket-Key is a random value
							require.Equal(t, `{"id":"1","type":"subscribe","payload":{"query":"subscription{currentTime {unixTime timeStamp}}","extensions":{"upgradeHeaders":{"Authorization":"Bearer test","Canonical-Header-Name":"matches","Connection":"Upgrade","Ignored":"ignored","Not-Allowlisted-But-Forwarded":"but still part of the origin upgrade request","Reverse-Canonical-Header-Name":"matches as well","Sec-Websocket-Protocol":"graphql-transport-ws","Sec-Websocket-Version":"13","Upgrade":"websocket","User-Agent":"Go-http-client/1.1","X-Custom-Auth":"customAuth"},"upgradeQueryParams":{"ignored":"ignored","token":"Bearer Something","x-custom-auth":"customAuth"},"initialPayload":{"Custom-Auth":"test"}}}}`, string(message))

							err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"next","id":"1","payload":{"data":{"currentTime":{"unixTime":1,"timeStamp":"2021-09-01T12:00:00Z"}}}}`))
							require.NoError(t, err)

							_, message, err = conn.ReadMessage()
							if errors.Is(err, websocket.ErrCloseSent) {
								return
							}
							require.Equal(t, `{"id":"1","type":"complete"}`, string(message))

							err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"complete","id":"1"}`))
							require.NoError(t, err)
						})
					},
				},
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

			conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
				"Authorization":                 []string{"Bearer test"},
				"Ignored":                       []string{"ignored"},
				"X-Custom-Auth":                 []string{"customAuth"},
				"canonical-header-name":         []string{"matches"},
				"Reverse-Canonical-Header-Name": []string{"matches as well"},
				"Not-AllowListed-But-Forwarded": []string{"but still part of the origin upgrade request"},
			}, url.Values{
				"token":         []string{"Bearer Something"},
				"ignored":       []string{"ignored"},
				"x-custom-auth": []string{"customAuth"},
			},
				[]byte(`{"Custom-Auth":"test"}`),
			)
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
			require.Equal(t, float64(1), payload.Data.CurrentTime.UnixTime)

			// Sending a complete must stop the subscription
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "complete",
			})
			require.NoError(t, err)

			var complete testenv.WebSocketMessage
			err = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			require.NoError(t, err)
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "1", complete.ID)
			require.Equal(t, "complete", complete.Type)

			wg.Wait()

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription with header propagation sse subgraph post", func(t *testing.T) {
		t.Parallel()

		headerRules := config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "Authorization",
					},
				},
			},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			ModifyRouterConfig: func(cfg *nodev1.RouterConfig) {
				for i := range cfg.EngineConfig.DatasourceConfigurations {
					t := true
					if cfg.EngineConfig.DatasourceConfigurations[i].CustomGraphql == nil {
						continue
					}
					cfg.EngineConfig.DatasourceConfigurations[i].CustomGraphql.Subscription.UseSSE = &t
					p := common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST
					cfg.EngineConfig.DatasourceConfigurations[i].CustomGraphql.Subscription.Protocol = &p
				}
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							require.Equal(t, "Bearer test", r.Header.Get("Authorization"))
							data, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							defer r.Body.Close()
							require.Equal(t, `{"query":"subscription{currentTime {unixTime timeStamp}}","extensions":{"upgradeHeaders":{"Authorization":"Bearer test"},"initialPayload":{"Custom-Auth":"test"}}}`, string(data))

							w.Header().Set("Content-Type", "text/event-stream")
							w.Header().Set("Cache-Control", "no-cache")
							w.Header().Set("Connection", "keep-alive")
							w.WriteHeader(http.StatusOK)
							flusher, ok := w.(http.Flusher)
							if !ok {
								http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
								return
							}
							_, err = fmt.Fprintf(w, "data: %s\n\n", `{"data":{"currentTime":{"unixTime":1,"timeStamp":"2021-09-01T12:00:00Z"}}}`)
							require.NoError(t, err)
							flusher.Flush()
						})
					},
				},
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

			conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
				"Authorization": []string{"Bearer test"},
			}, nil, []byte(`{"Custom-Auth":"test"}`))
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
			require.Equal(t, float64(1), payload.Data.CurrentTime.UnixTime)

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
	t.Run("subscription with header propagation sse subgraph get", func(t *testing.T) {
		t.Parallel()

		headerRules := config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "Authorization",
					},
				},
			},
		}
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			ModifyRouterConfig: func(cfg *nodev1.RouterConfig) {
				for i := range cfg.EngineConfig.DatasourceConfigurations {
					t := true
					if cfg.EngineConfig.DatasourceConfigurations[i].CustomGraphql == nil {
						continue
					}
					cfg.EngineConfig.DatasourceConfigurations[i].CustomGraphql.Subscription.UseSSE = &t
					p := common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE
					cfg.EngineConfig.DatasourceConfigurations[i].CustomGraphql.Subscription.Protocol = &p
				}
			},
			RouterOptions: []core.Option{
				core.WithHeaderRules(headerRules),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							require.Equal(t, "Bearer test", r.Header.Get("Authorization"))
							require.Equal(t, http.MethodGet, r.Method)
							query := r.URL.Query()
							require.Equal(t, "subscription{currentTime {unixTime timeStamp}}", query.Get("query"))
							require.Equal(t, `{"upgradeHeaders":{"Authorization":"Bearer test"},"initialPayload":{"Custom-Auth":"test"}}`, query.Get("extensions"))

							w.Header().Set("Content-Type", "text/event-stream")
							w.Header().Set("Cache-Control", "no-cache")
							w.Header().Set("Connection", "keep-alive")
							w.WriteHeader(http.StatusOK)
							flusher, ok := w.(http.Flusher)
							if !ok {
								http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
								return
							}
							_, err := fmt.Fprintf(w, "data: %s\n\n", `{"data":{"currentTime":{"unixTime":1,"timeStamp":"2021-09-01T12:00:00Z"}}}`)
							require.NoError(t, err)
							flusher.Flush()
						})
					},
				},
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

			conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
				"Authorization": []string{"Bearer test"},
			}, nil, []byte(`{"Custom-Auth":"test"}`))
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
			require.Equal(t, float64(1), payload.Data.CurrentTime.UnixTime)

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
	t.Run("subscription with upgrade error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							// This will cause the upgrade to fail
							w.WriteHeader(http.StatusTeapot)
						})
					},
				},
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

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "error", msg.Type)
			require.Equal(t, `[{"message":"Subscription Upgrade request failed for Subgraph 'employees'.","extensions":{"statusCode":418}}]`, string(msg.Payload))
		})
	})
	t.Run("subscription with unexposed upgrade error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							// This will cause the upgrade to fail
							w.WriteHeader(http.StatusTeapot)
						})
					},
				},
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

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "error", msg.Type)
			require.Equal(t, `[{"message":"Subscription Upgrade request failed"}]`, string(msg.Payload))
		})
	})
	t.Run("subscription error in resolver", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							// This will cause the upgrade to fail
							w.WriteHeader(http.StatusTeapot)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { returnsError }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "error", msg.Type)
			require.Equal(t, `[{"message":"this is an error","path":["returnsError"]}]`, string(msg.Payload))
		})
	})
	t.Run("subscription error in resolver unexposed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							// This will cause the upgrade to fail
							w.WriteHeader(http.StatusTeapot)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { returnsError }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "error", msg.Type)
			require.Equal(t, `[{"message":"Unable to subscribe"}]`, string(msg.Payload))
		})
	})
	t.Run("multiple subscriptions one connection", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL()).
				WithProtocol(graphql.GraphQLWS)

			var wg sync.WaitGroup

			var subscriptionCountEmp struct {
				CountEmp int `graphql:"countEmp(max: $max, intervalMilliseconds: $interval)"`
			}
			var (
				firstCountEmpID, countEmpID, countEmp2ID, countHobID string
				firstCountEmp, countEmp, countEmp2, countHob         int
				err                                                  error
				variables                                            = map[string]interface{}{
					"max":      10,
					"interval": 200,
				}
			)

			wg.Add(1)

			firstCountEmpID, err = client.Subscribe(&subscriptionCountEmp, map[string]interface{}{
				"max":      5,
				"interval": 100,
			}, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				data := subscriptionCountEmp
				err := jsonutil.UnmarshalGraphQL(dataValue, &data)
				require.NoError(t, err)
				require.Equal(t, firstCountEmp, data.CountEmp)
				if firstCountEmp == 5 {
					wg.Done()
					err = client.Unsubscribe(firstCountEmpID)
					require.NoError(t, err)
				}
				firstCountEmp++

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", firstCountEmpID)

			wg.Add(1)

			countEmpID, err = client.Subscribe(&subscriptionCountEmp, variables, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				data := subscriptionCountEmp
				err := jsonutil.UnmarshalGraphQL(dataValue, &data)
				require.NoError(t, err)
				require.Equal(t, countEmp, data.CountEmp)
				if countEmp == 5 {
					wg.Done()
					err = client.Unsubscribe(countEmpID)
					require.NoError(t, err)
				}
				countEmp++

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", countEmpID)

			var subscriptionCountEmp2 struct {
				CountEmp int `graphql:"countEmp2(max: $max, intervalMilliseconds: $interval)"`
			}

			wg.Add(1)

			countEmp2ID, err = client.Subscribe(&subscriptionCountEmp2, variables, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				data := subscriptionCountEmp2
				err := jsonutil.UnmarshalGraphQL(dataValue, &data)
				require.NoError(t, err)
				require.Equal(t, countEmp2, data.CountEmp)
				if countEmp2 == 5 {
					wg.Done()
					err = client.Unsubscribe(countEmp2ID)
					require.NoError(t, err)
				}
				countEmp2++

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", countEmp2ID)

			var subscriptionCountHob struct {
				CountHob int `graphql:"countHob(max: $max, intervalMilliseconds: $interval)"`
			}

			wg.Add(1)

			countHobID, err = client.Subscribe(&subscriptionCountHob, variables, func(dataValue []byte, errValue error) error {
				require.NoError(t, errValue)
				data := subscriptionCountHob
				err := jsonutil.UnmarshalGraphQL(dataValue, &data)
				require.NoError(t, err)
				require.Equal(t, countHob, data.CountHob)
				if countHob == 5 {
					wg.Done()
					err = client.Unsubscribe(countHobID)
					require.NoError(t, err)
				}
				countHob++

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", countHobID)

			wg.Add(1)
			go func() {
				defer wg.Done()
				require.NoError(t, client.Run())
			}()

			wg.Wait()

			xEnv.WaitForSubscriptionCount(0, time.Second*5)
			xEnv.WaitForConnectionCount(0, time.Second*5)
			xEnv.WaitForTriggerCount(0, time.Second*5)

			require.NoError(t, client.Close())
		})
	})
	t.Run("error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
			})
			require.NoError(t, err)
			err = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			require.NoError(t, err)
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
	t.Run("subscription with library graphql-ws", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				CurrentTime struct {
					UnixTime  float64 `graphql:"unixTime"`
					Timestamp string  `graphql:"timeStamp"`
				} `graphql:"currentTime"`
			}
			client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL()).WithProtocol(graphql.GraphQLWS)
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
					require.Greater(t, data.CurrentTime.UnixTime, firstTime)
					return graphql.ErrSubscriptionStopped
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)
			require.NoError(t, client.Run())
		})
	})
	t.Run("subscription with library graphql-transport-ws", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				CurrentTime struct {
					UnixTime  float64 `graphql:"unixTime"`
					Timestamp string  `graphql:"timeStamp"`
				} `graphql:"currentTime"`
			}
			client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL()).WithProtocol(graphql.SubscriptionsTransportWS)
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
					require.Greater(t, data.CurrentTime.UnixTime, firstTime)
					return graphql.ErrSubscriptionStopped
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)
			_ = client.Run()
		})
	})
	t.Run("forward extensions", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make sure sending two simultaneous subscriptions with different extensions
			// triggers two subscriptions to the upstream
			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			conn2 := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
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
	t.Run("forward query params via initial payload", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make sure sending two simultaneous subscriptions with different extensions
			// triggers two subscriptions to the upstream

			xEnv.SetExtraURLQueryValues(url.Values{
				"Authorization": []string{"token 123"},
			})

			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			var err error
			err = conn1.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }","extensions":{"token":"456"}}`),
			})
			require.NoError(t, err)

			var msg testenv.WebSocketMessage
			var payload struct {
				Data struct {
					InitialPayload json.RawMessage `json:"initialPayload"`
				} `json:"data"`
			}
			err = conn1.ReadJSON(&msg)
			require.NoError(t, err)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, `{"extensions":{"token":"456","upgradeQueryParams":{"Authorization":"token 123"}}}`, string(payload.Data.InitialPayload))
		})
	})
	t.Run("forward query params via initial payload alongside existing", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make sure sending two simultaneous subscriptions with different extensions
			// triggers two subscriptions to the upstream

			xEnv.SetExtraURLQueryValues(url.Values{
				"Authorization": []string{"token 123"},
			})

			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			var err error
			err = conn1.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)

			var msg testenv.WebSocketMessage
			var payload struct {
				Data struct {
					InitialPayload json.RawMessage `json:"initialPayload"`
				} `json:"data"`
			}
			err = conn1.ReadJSON(&msg)
			require.NoError(t, err)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, `{"extensions":{"upgradeQueryParams":{"Authorization":"token 123"}}}`, string(payload.Data.InitialPayload))
		})
	})
	t.Run("same graphql path as playground", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, []byte(`{"123": 456, "extensions": {"hello": "world"}}`))
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
			require.Equal(t, `{"data":{"initialPayload":{"123":456,"extensions":{"initialPayload":{"123":456,"extensions":{"hello":"world"}}}}}}`, string(msg.Payload))
		})
	})
	t.Run("different path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/foo",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, []byte(`{"123": 456, "extensions": {"hello": "world"}}`))
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
			require.Equal(t, `{"data":{"initialPayload":{"123":456,"extensions":{"initialPayload":{"123":456,"extensions":{"hello":"world"}}}}}}`, string(msg.Payload))
		})
	})

	// Feature Flags

	t.Run("query a field from a feature flag that provides the productCount field / feature flags", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(map[string][]string{
				"X-Feature-Flag": {"myff"},
			}, nil, nil)
			err := conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id productCount } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `{"data":{"employees":[{"id":1,"productCount":5},{"id":2,"productCount":2},{"id":3,"productCount":2},{"id":4,"productCount":3},{"id":5,"productCount":2},{"id":7,"productCount":0},{"id":8,"productCount":2},{"id":10,"productCount":3},{"id":11,"productCount":1},{"id":12,"productCount":4}]}}`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})

	t.Run("return an error because the field is not provided by the base graph / feature flags", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id productCount } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `[{"message":"field: productCount not defined on type: Employee"}]`, string(res.Payload))
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})

	// times out on GitHub Actions

	t.Run("shutdown with netPoll", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableNetPoll = true
				cfg.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
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

	t.Run("shutdown without netPoll", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableNetPoll = false
				cfg.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
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
			var closeError *websocket.CloseError
			ok := errors.As(err, &closeError)
			require.True(t, ok)
			require.Equal(t, websocket.CloseAbnormalClosure, closeError.Code)
		})
	})
	t.Run("single connection with initial payload", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, []byte(`{"123":456,"extensions":{"hello":"world"}}`))
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"123":456,"extensions":{"initialPayload":{"123":456,"extensions":{"hello":"world"}}}}}}`, string(msg.Payload))
		})
	})
	t.Run("single connection with initial payload and extensions in the request", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// "extensions" in the request should override the "extensions" in initial payload
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, []byte(`{"123":456,"extensions":{"hello":"world"}}`))
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { initialPayload(repeat:3) }","extensions":{"hello":"world2"}}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"123":456,"extensions":{"hello":"world2","initialPayload":{"123":456,"extensions":{"hello":"world"}}}}}}`, string(msg.Payload))
		})
	})
	t.Run("single connection multiple differing subscriptions", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

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
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
				time.Sleep(time.Millisecond * 100)
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
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
				cfg.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// "extensions" in the request should override the "extensions" in initial payload
			conn1 := xEnv.InitGraphQLWebSocketConnection(nil, nil, []byte(`{"id":1}`))
			conn2 := xEnv.InitGraphQLWebSocketConnection(nil, nil, []byte(`{"id":2}`))
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
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"initialPayload":{"id":1}},"id":1}}}`, string(msg.Payload))

			err = conn2.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"initialPayload":{"id":2}},"id":2}}}`, string(msg.Payload))
		})
	})
	t.Run("absinthe subscription", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 500
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			type currentTimePayload struct {
				Result struct {
					Data struct {
						CurrentTime struct {
							UnixTime  float64 `json:"unixTime"`
							Timestamp string  `json:"timestamp"`
						} `json:"currentTime"`
					} `json:"data"`
				} `json:"result"`
			}

			conn := xEnv.InitAbsintheWebSocketConnection(nil, json.RawMessage(`["1", "1", "__absinthe__:control", "phx_join", {}]`))
			err := conn.WriteJSON(json.RawMessage(`["1", "1", "__absinthe__:control", "doc", {"query":"subscription { currentTime { unixTime timeStamp }}" }]`))
			require.NoError(t, err)
			var msg json.RawMessage
			var payload currentTimePayload

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			h := sha256.New()
			h.Write([]byte("1"))
			operationId := new(big.Int).SetBytes(h.Sum(nil))
			require.Equal(t, string(msg), fmt.Sprintf(`["1","1","__absinthe__:control","phx_reply",{"status":"ok","response":{"subscriptionId":"__absinthe__:doc:1:%s"}}]`, operationId))
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Contains(t, string(msg), `["1","1","__absinthe__:control","subscription:data"`)
			var data []json.RawMessage
			err = json.Unmarshal(msg, &data)
			require.NoError(t, err)
			require.Equal(t, 5, len(data))
			err = json.Unmarshal(data[4], &payload)
			require.NoError(t, err)

			unix1 := payload.Result.Data.CurrentTime.UnixTime

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Contains(t, string(msg), `["1","1","__absinthe__:control","subscription:data"`)
			err = json.Unmarshal(msg, &data)
			require.NoError(t, err)
			require.Equal(t, 5, len(data))
			err = json.Unmarshal(data[4], &payload)
			require.NoError(t, err)

			unix2 := payload.Result.Data.CurrentTime.UnixTime
			require.Greater(t, unix2, unix1)

			// Sending a complete must stop the subscription
			err = conn.WriteJSON(json.RawMessage(`["1", "1", "__absinthe__:control", "phx_leave", {}]`))
			require.NoError(t, err)

			var complete json.RawMessage
			err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
			require.NoError(t, err)
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, string(complete), fmt.Sprintf(`["1","","__absinthe__:control","phx_reply",{"status":"ok","response":{"subscriptionId":"__absinthe__:doc:1:%s"}}]`, operationId))

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

	t.Run("websocket negotiation headers should not leak down", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Request: []*config.RequestHeaderRule{
						{
							Operation: config.HeaderRuleOperationPropagate,
							Matching:  ".*",
						},
					},
				},
			})},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime } }"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = conn.ReadJSON(&res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
}

func expectConnectAndReadCurrentTime(t *testing.T, xEnv *testenv.Environment) {
	type currentTimePayload struct {
		Data struct {
			CurrentTime struct {
				UnixTime  float64 `json:"unixTime"`
				Timestamp string  `json:"timestamp"`
			} `json:"currentTime"`
		} `json:"data"`
	}

	conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
	defer conn.Close()

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
	require.Greater(t, unix2, unix1)

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
}
