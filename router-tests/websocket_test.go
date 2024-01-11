package integration_test

import (
	"encoding/json"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hasura/go-graphql-client"
	"github.com/hasura/go-graphql-client/pkg/jsonutil"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/config"
)

func TestWebSockets(t *testing.T) {
	t.Parallel()

	t.Run("query", func(t *testing.T) {
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
			require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
	t.Run("subscription", func(t *testing.T) {
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
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { does_not_exist }"}`),
			})
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
	t.Run("subscription with library", func(t *testing.T) {
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
					t.Parallel()
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
	t.Run("multiple connections with different initial payloads", func(t *testing.T) {
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
