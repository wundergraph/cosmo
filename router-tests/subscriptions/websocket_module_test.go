package integration

import (
	"encoding/json"
	"math"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

// Interface guard
var (
	_ core.EnginePreOriginHandler  = (*MyCustomWebsocketModule)(nil)
	_ core.EnginePostOriginHandler = (*MyCustomWebsocketModule)(nil)
	_ core.Module                  = (*MyCustomWebsocketModule)(nil)
)

type MyCustomWebsocketModule struct {
	t                 *testing.T
	postHandlerCalled *bool
}

func (m MyCustomWebsocketModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "myCustomWebsocketModule",
		Priority: math.MaxInt32,
		New: func() core.Module {
			return &MyCustomWebsocketModule{
				t:                 m.t,
				postHandlerCalled: m.postHandlerCalled,
			}
		},
	}
}

func (m MyCustomWebsocketModule) OnOriginResponse(resp *http.Response, ctx core.RequestContext) *http.Response {
	*m.postHandlerCalled = true

	require.NotNil(m.t, resp)
	require.Equal(m.t, resp.StatusCode, http.StatusSwitchingProtocols)
	require.Equal(m.t, resp.Header.Get("Connection"), "Upgrade")
	require.Equal(m.t, resp.Header.Get("Sec-WebSocket-Protocol"), "graphql-ws")
	require.NotEmpty(m.t, resp.Header.Get("Sec-WebSocket-Accept"))

	return resp
}

func (m MyCustomWebsocketModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {

	require.NotNil(m.t, req)
	require.Equal(m.t, req.Header.Get("Connection"), "Upgrade")
	require.Equal(m.t, req.Header.Get("Upgrade"), "websocket")
	require.Equal(m.t, req.Header.Get("Sec-WebSocket-Version"), "13")
	require.Equal(m.t, req.Header.Get("Sec-WebSocket-Protocol"), "graphql-transport-ws,graphql-ws")
	require.NotEmpty(m.t, req.Header.Get("Sec-WebSocket-Key"))

	require.Equal(m.t, ctx.Operation().Name(), "currentTime")
	require.Equal(m.t, ctx.Operation().Hash(), uint64(10840416806766942577))
	require.Equal(m.t, ctx.Operation().ClientInfo().Name, "my-client")
	require.Equal(m.t, ctx.Operation().ClientInfo().Version, "1.0.0")
	require.Equal(m.t, ctx.Operation().Type(), core.OperationTypeSubscription)
	require.Equal(m.t, ctx.Operation().Content(), "subscription currentTime {currentTime {unixTime timeStamp}}")

	return req, nil
}

func TestWebsocketCustomModule(t *testing.T) {
	t.Parallel()

	t.Run("Should be able to intercept upgrade requests and access all operation information / async subscription", func(t *testing.T) {
		t.Parallel()

		postHandlerCalled := new(bool)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithCustomModules(&MyCustomWebsocketModule{
					t:                 t,
					postHandlerCalled: postHandlerCalled,
				}),
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
				"sessionToken":           []string{"123"},
				"GraphQL-Client-Name":    []string{"my-client"},
				"GraphQL-Client-Version": []string{"1.0.0"},
			}, nil, nil)

			t.Cleanup(func() {
				_ = conn.Close()
			})

			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription currentTime { currentTime { unixTime timeStamp }}"}`),
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

			// Sending a complete must stop the subscription
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "complete",
			})
			require.NoError(t, err)

			require.Truef(t, *postHandlerCalled, "post handler was not called")
		})
	})
}
