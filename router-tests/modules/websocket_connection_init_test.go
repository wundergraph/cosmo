package module_test

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	websocket_connection_init "github.com/wundergraph/cosmo/router-tests/modules/websocket-connection-init"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func webSocketConnectionInitOptions(module *websocket_connection_init.WebSocketConnectionInitModule, options ...core.Option) []core.Option {
	return append(options,
		core.WithModulesConfig(map[string]any{"webSocketConnectionInitModule": module}),
		core.WithCustomModules(&websocket_connection_init.WebSocketConnectionInitModule{}),
	)
}

// readUntilClosed reads messages until the router closes the connection, and returns how it was closed.
func readUntilClosed(t *testing.T, conn *websocket.Conn) *websocket.CloseError {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue
		}
		var closeErr *websocket.CloseError
		require.ErrorAs(t, err, &closeErr)
		return closeErr
	}
}

// subscribeToCurrentTime starts a subscription on conn and waits for its first event.
func subscribeToCurrentTime(t *testing.T, xEnv *testenv.Environment, conn *websocket.Conn) {
	t.Helper()
	require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
		ID:      "1",
		Type:    "subscribe",
		Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp } }"}`),
	}))
	var next testenv.WebSocketMessage
	require.NoError(t, testenv.WSReadJSON(t, conn, &next))
	require.Equal(t, "next", next.Type)
	xEnv.WaitForSubscriptionCount(1, 10*time.Second)
}

func TestWebSocketConnectionInitHook(t *testing.T) {
	t.Parallel()

	t.Run("is called once for each connection, with its authentication", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := testutils.ConfigureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators: authenticators,
		})
		require.NoError(t, err)

		var calls atomic.Int32
		subjects := make(chan any, 2)
		module := &websocket_connection_init.WebSocketConnectionInitModule{
			Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
				calls.Add(1)
				if auth := ctx.Authentication(); auth != nil {
					subjects <- auth.Claims()["sub"]
				} else {
					subjects <- nil
				}
				return nil
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: webSocketConnectionInitOptions(module, core.WithAccessController(accessController)),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{"sub": "user-1"})
			require.NoError(t, err)
			conn := xEnv.InitGraphQLWebSocketConnection(http.Header{"Authorization": []string{"Bearer " + token}}, nil, nil)
			testenv.AwaitChannelWithT(t, 10*time.Second, subjects, func(t *testing.T, subject any) {
				assert.Equal(t, "user-1", subject)
			}, "the hook wasn't called")

			// The connection still serves operations.
			require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id } }"}`),
			}))
			var res testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &res))
			assert.Equal(t, "next", res.Type)
			assert.Equal(t, int32(1), calls.Load())
		})
	})

	t.Run("gets the upgrade request, the connection_init payload and a logger", func(t *testing.T) {
		t.Parallel()

		type seen struct {
			header  string
			payload string
			logger  bool
		}
		seenByHook := make(chan seen, 1)
		module := &websocket_connection_init.WebSocketConnectionInitModule{
			Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
				seenByHook <- seen{
					header:  ctx.Request().Header.Get("X-Client-Name"),
					payload: string(ctx.InitialPayload()),
					logger:  ctx.Logger() != nil,
				}
				return nil
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: webSocketConnectionInitOptions(module),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.InitGraphQLWebSocketConnection(http.Header{"X-Client-Name": []string{"hook-test"}}, nil, []byte(`{"client":"hook-test"}`))
			testenv.AwaitChannelWithT(t, 10*time.Second, seenByHook, func(t *testing.T, got seen) {
				assert.Equal(t, seen{header: "hook-test", payload: `{"client":"hook-test"}`, logger: true}, got)
			}, "the hook wasn't called")
		})
	})

	for _, netPoll := range []bool{false, true} {
		t.Run(fmt.Sprintf("a module closes the connection with its code and ends its subscriptions, net poll %t", netPoll), func(t *testing.T) {
			t.Parallel()

			connections := make(chan core.WebSocketConnection, 1)
			module := &websocket_connection_init.WebSocketConnectionInitModule{
				Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
					connections <- ctx.Connection()
					return nil
				},
			}

			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.EnableNetPoll = netPoll
				},
				RouterOptions: webSocketConnectionInitOptions(module),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				subscribeToCurrentTime(t, xEnv, conn)
				var connection core.WebSocketConnection
				testenv.AwaitChannelWithT(t, 10*time.Second, connections, func(t *testing.T, c core.WebSocketConnection) {
					connection = c
				}, "the hook wasn't called")

				connection.Close(4401, "Unauthorized")

				closeErr := readUntilClosed(t, conn)
				assert.Equal(t, 4401, closeErr.Code)
				assert.Equal(t, "Unauthorized", closeErr.Text)
				testenv.AwaitChannelWithT(t, 10*time.Second, connection.Context().Done(), func(*testing.T, struct{}) {}, "the connection's context didn't end")
				xEnv.WaitForSubscriptionCount(0, 10*time.Second)

				// A later call does nothing.
				connection.Close(4403, "Forbidden")
			})
		})
	}

	t.Run("a connection a module refuses is closed with 4403", func(t *testing.T) {
		t.Parallel()

		module := &websocket_connection_init.WebSocketConnectionInitModule{
			Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
				return errors.New("refused")
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: webSocketConnectionInitOptions(module),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			closeErr := readUntilClosed(t, conn)
			assert.Equal(t, 4403, closeErr.Code)
			assert.Equal(t, "Forbidden", closeErr.Text)
		})
	})

	for _, netPoll := range []bool{false, true} {
		t.Run(fmt.Sprintf("a close code outside the ranges left to applications is sent as a policy violation, net poll %t", netPoll), func(t *testing.T) {
			t.Parallel()

			// Closing during the hook shuts the connection down before the router reads from it.
			module := &websocket_connection_init.WebSocketConnectionInitModule{
				Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
					ctx.Connection().Close(1006, "abnormal")
					return nil
				},
			}

			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.EnableNetPoll = netPoll
				},
				RouterOptions: webSocketConnectionInitOptions(module),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				closeErr := readUntilClosed(t, conn)
				assert.Equal(t, websocket.ClosePolicyViolation, closeErr.Code)
				assert.Equal(t, "abnormal", closeErr.Text)
			})
		})
	}

	t.Run("a reason longer than a close frame holds is cut short between characters", func(t *testing.T) {
		t.Parallel()

		// 100 two-byte characters: 123 bytes would end inside the 62nd.
		reason := strings.Repeat("é", 100)
		module := &websocket_connection_init.WebSocketConnectionInitModule{
			Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
				ctx.Connection().Close(4401, reason)
				return nil
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: webSocketConnectionInitOptions(module),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			closeErr := readUntilClosed(t, conn)
			assert.Equal(t, 4401, closeErr.Code)
			assert.Equal(t, strings.Repeat("é", 61), closeErr.Text)
		})
	})

	t.Run("the connection's context ends when the client disconnects", func(t *testing.T) {
		t.Parallel()

		connections := make(chan core.WebSocketConnection, 1)
		module := &websocket_connection_init.WebSocketConnectionInitModule{
			Callback: func(ctx core.WebSocketConnectionInitHandlerContext) error {
				connections <- ctx.Connection()
				return nil
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: webSocketConnectionInitOptions(module),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			var connection core.WebSocketConnection
			testenv.AwaitChannelWithT(t, 10*time.Second, connections, func(t *testing.T, c core.WebSocketConnection) {
				connection = c
			}, "the hook wasn't called")
			require.NoError(t, conn.Close())
			testenv.AwaitChannelWithT(t, 10*time.Second, connection.Context().Done(), func(*testing.T, struct{}) {}, "the connection's context didn't end")
		})
	})
}
