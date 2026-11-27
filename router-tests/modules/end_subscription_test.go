package module_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	end_subscription "github.com/wundergraph/cosmo/router-tests/modules/end-subscription"
	start_subscription "github.com/wundergraph/cosmo/router-tests/modules/start-subscription"
	subscription_on_create "github.com/wundergraph/cosmo/router-tests/modules/subscription-on-create"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

const endSubscriptionTimeout = 10 * time.Second

// subscriptionTokenKey is the key under which SubscriptionOnStart handlers store a value for SubscriptionOnEnd.
const subscriptionTokenKey = "subscriptionToken"

func newEndSubscriptionModule(callback func(ctx core.SubscriptionOnEndHandlerContext)) *end_subscription.EndSubscriptionModule {
	return &end_subscription.EndSubscriptionModule{
		HookCallCount: &atomic.Int32{},
		Callback:      callback,
	}
}

func endSubscriptionRouterOptions(modulesConfig map[string]any, modules ...core.Module) []core.Option {
	return []core.Option{
		core.WithModulesConfig(modulesConfig),
		core.WithCustomModules(modules...),
	}
}

// requireEndHookCallCount waits until the SubscriptionOnEnd hook has been called the expected number of times.
func requireEndHookCallCount(t *testing.T, module *end_subscription.EndSubscriptionModule, expected int32) {
	t.Helper()

	require.Eventually(t, func() bool {
		return module.HookCallCount.Load() >= expected
	}, endSubscriptionTimeout, 50*time.Millisecond)
	require.Equal(t, expected, module.HookCallCount.Load())
}

// subscribeOverSSE starts a subscription over SSE. Canceling ctx disconnects the client.
func subscribeOverSSE(t *testing.T, ctx context.Context, xEnv *testenv.Environment, query string) *http.Response {
	t.Helper()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader([]byte(`{"query":"`+query+`"}`)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := xEnv.RouterClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = resp.Body.Close() })
	require.Equal(t, http.StatusOK, resp.StatusCode)

	return resp
}

func TestEndSubscriptionHook(t *testing.T) {
	t.Parallel()

	t.Run("SubscriptionOnEnd is called once when a WebSocket client completes an engine subscription", func(t *testing.T) {
		t.Parallel()

		type endedSubscription struct {
			operationName string
			operationType string
			hasRequest    bool
			hasLogger     bool
		}
		ended := make(chan endedSubscription, 1)

		customModule := newEndSubscriptionModule(func(ctx core.SubscriptionOnEndHandlerContext) {
			ended <- endedSubscription{
				operationName: ctx.Operation().Name(),
				operationType: ctx.Operation().Type(),
				hasRequest:    ctx.Request() != nil,
				hasLogger:     ctx.Logger() != nil,
			}
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{"endSubscriptionModule": customModule},
				&end_subscription.EndSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription CountEmployees { countEmp(max: 1000, intervalMilliseconds: 200) }","operationName":"CountEmployees"}`),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, endSubscriptionTimeout)
			require.Equal(t, int32(0), customModule.HookCallCount.Load())

			err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
			require.NoError(t, err)

			testenv.AwaitChannelWithT(t, endSubscriptionTimeout, ended, func(t *testing.T, subscription endedSubscription) {
				assert.Equal(t, endedSubscription{
					operationName: "CountEmployees",
					operationType: "subscription",
					hasRequest:    true,
					hasLogger:     true,
				}, subscription)
			})

			// Closing the connection must not call the hook again for the completed subscription.
			require.NoError(t, conn.Close())
			xEnv.WaitForConnectionCount(0, endSubscriptionTimeout)
			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("SubscriptionOnEnd is called once when the subgraph completes an engine subscription", func(t *testing.T) {
		t.Parallel()

		customModule := newEndSubscriptionModule(nil)

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{"endSubscriptionModule": customModule},
				&end_subscription.EndSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { countEmp(max: 1, intervalMilliseconds: 100) }"}`),
			})
			require.NoError(t, err)

			// The subgraph sends countEmp 0 and 1, then completes the subscription.
			for _, expectedType := range []string{"next", "next", "complete"} {
				var msg testenv.WebSocketMessage
				require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
				require.Equal(t, expectedType, msg.Type)
			}

			requireEndHookCallCount(t, customModule, 1)

			require.NoError(t, conn.Close())
			xEnv.WaitForConnectionCount(0, endSubscriptionTimeout)
			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("SubscriptionOnEnd is called once when a client disconnects from an engine subscription over SSE", func(t *testing.T) {
		t.Parallel()

		customModule := newEndSubscriptionModule(nil)

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{"endSubscriptionModule": customModule},
				&end_subscription.EndSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, disconnect := context.WithCancel(context.Background())
			defer disconnect()

			subscribeOverSSE(t, ctx, xEnv, `subscription { countEmp(max: 1000, intervalMilliseconds: 200) }`)

			xEnv.WaitForSubscriptionCount(1, endSubscriptionTimeout)
			require.Equal(t, int32(0), customModule.HookCallCount.Load())

			disconnect()

			xEnv.WaitForSubscriptionCount(0, endSubscriptionTimeout)
			requireEndHookCallCount(t, customModule, 1)
		})
	})

	t.Run("SubscriptionOnEnd is called once for each of two identical engine subscriptions on one WebSocket connection", func(t *testing.T) {
		t.Parallel()

		customModule := newEndSubscriptionModule(nil)

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{"endSubscriptionModule": customModule},
				&end_subscription.EndSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			for _, id := range []string{"1", "2"} {
				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      id,
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { countEmp(max: 1000, intervalMilliseconds: 200) }"}`),
				})
				require.NoError(t, err)
			}

			xEnv.WaitForSubscriptionCount(2, endSubscriptionTimeout)
			require.Equal(t, int32(0), customModule.HookCallCount.Load())

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, endSubscriptionTimeout)
			requireEndHookCallCount(t, customModule, 1)

			err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "2", Type: "complete"})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(0, endSubscriptionTimeout)
			requireEndHookCallCount(t, customModule, 2)
		})
	})

	t.Run("SubscriptionOnEnd is called once when a SubscriptionOnStart handler rejects an engine subscription", func(t *testing.T) {
		t.Parallel()

		customModule := newEndSubscriptionModule(nil)
		startModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				return &core.StreamHandlerError{Message: "subscription rejected by hook"}
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{
					"endSubscriptionModule":   customModule,
					"startSubscriptionModule": startModule,
				},
				&end_subscription.EndSubscriptionModule{},
				&start_subscription.StartSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { countEmp(max: 1000, intervalMilliseconds: 200) }"}`),
			})
			require.NoError(t, err)

			var msg testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.Equal(t, "next", msg.Type)
			require.Contains(t, string(msg.Payload), "subscription rejected by hook")

			requireEndHookCallCount(t, customModule, 1)
			assert.Equal(t, int32(1), startModule.HookCallCount.Load())

			require.NoError(t, conn.Close())
			xEnv.WaitForConnectionCount(0, endSubscriptionTimeout)
			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("SubscriptionOnEnd is called once when a WebSocket client closes the connection of a NATS subscription", func(t *testing.T) {
		t.Parallel()

		customModule := newEndSubscriptionModule(nil)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{"endSubscriptionModule": customModule},
				&end_subscription.EndSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 1) { id } }"}`),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, endSubscriptionTimeout)
			require.Equal(t, int32(0), customModule.HookCallCount.Load())

			require.NoError(t, conn.Close())

			xEnv.WaitForSubscriptionCount(0, endSubscriptionTimeout)
			requireEndHookCallCount(t, customModule, 1)
		})
	})

	t.Run("SubscriptionOnEnd is called once when a SubscriptionOnCreate handler rejects a NATS subscription over SSE", func(t *testing.T) {
		t.Parallel()

		// The subscription ends during setup, before the engine registers it.

		customModule := newEndSubscriptionModule(nil)
		onCreateModule := &subscription_on_create.SubscriptionOnCreateModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnCreateHandlerContext) error {
				return errors.New("subscription rejected by hook")
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{
					"endSubscriptionModule":      customModule,
					"subscriptionOnCreateModule": onCreateModule,
				},
				&end_subscription.EndSubscriptionModule{},
				&subscription_on_create.SubscriptionOnCreateModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp := subscribeOverSSE(t, context.Background(), xEnv, `subscription { employeeUpdatedMyNats(id: 1) { id } }`)

			// The router closes the response once the subscription has ended.
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			require.Contains(t, string(body), "failed to prepare subscription trigger")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
			assert.Equal(t, int32(1), onCreateModule.HookCallCount.Load())
		})
	})

	t.Run("SubscriptionOnEnd reads the value that SubscriptionOnStart stored for the same engine subscription when two subscriptions share one WebSocket connection", func(t *testing.T) {
		t.Parallel()

		type subscriptionToken struct {
			operationName string
			token         any
		}
		started := make(chan subscriptionToken, 2)
		ended := make(chan subscriptionToken, 2)

		tokens := &atomic.Int32{}
		startModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				token := tokens.Add(1)
				ctx.Set(subscriptionTokenKey, token)
				started <- subscriptionToken{operationName: ctx.Operation().Name(), token: token}
				return nil
			},
		}
		customModule := newEndSubscriptionModule(func(ctx core.SubscriptionOnEndHandlerContext) {
			token, _ := ctx.Get(subscriptionTokenKey)
			ended <- subscriptionToken{operationName: ctx.Operation().Name(), token: token}
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{
					"endSubscriptionModule":   customModule,
					"startSubscriptionModule": startModule,
				},
				&end_subscription.EndSubscriptionModule{},
				&start_subscription.StartSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			operationNames := map[string]string{"1": "First", "2": "Second"}
			startedTokens := map[string]any{}
			for _, id := range []string{"1", "2"} {
				operationName := operationNames[id]
				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      id,
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription ` + operationName + ` { countEmp(max: 1000, intervalMilliseconds: 200) }","operationName":"` + operationName + `"}`),
				})
				require.NoError(t, err)

				testenv.AwaitChannelWithT(t, endSubscriptionTimeout, started, func(t *testing.T, subscription subscriptionToken) {
					require.Equal(t, operationName, subscription.operationName)
					startedTokens[operationName] = subscription.token
				})
			}
			require.NotEqual(t, startedTokens["First"], startedTokens["Second"])

			xEnv.WaitForSubscriptionCount(2, endSubscriptionTimeout)

			// Complete the second subscription first, so the order of the ends differs from the order of the starts.
			for _, id := range []string{"2", "1"} {
				operationName := operationNames[id]
				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: id, Type: "complete"})
				require.NoError(t, err)

				testenv.AwaitChannelWithT(t, endSubscriptionTimeout, ended, func(t *testing.T, subscription subscriptionToken) {
					assert.Equal(t, subscriptionToken{
						operationName: operationName,
						token:         startedTokens[operationName],
					}, subscription)
				})
			}
		})
	})

	t.Run("SubscriptionOnEnd reads the value that SubscriptionOnStart stored for the same NATS subscription over SSE", func(t *testing.T) {
		t.Parallel()

		endedWithToken := make(chan any, 1)

		startModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				ctx.Set(subscriptionTokenKey, "token of the NATS subscription")
				return nil
			},
		}
		customModule := newEndSubscriptionModule(func(ctx core.SubscriptionOnEndHandlerContext) {
			token, _ := ctx.Get(subscriptionTokenKey)
			endedWithToken <- token
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{
					"endSubscriptionModule":   customModule,
					"startSubscriptionModule": startModule,
				},
				&end_subscription.EndSubscriptionModule{},
				&start_subscription.StartSubscriptionModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, disconnect := context.WithCancel(context.Background())
			defer disconnect()

			subscribeOverSSE(t, ctx, xEnv, `subscription { employeeUpdatedMyNats(id: 1) { id } }`)

			xEnv.WaitForSubscriptionCount(1, endSubscriptionTimeout)
			require.Eventually(t, func() bool {
				return startModule.HookCallCount.Load() == 1
			}, endSubscriptionTimeout, 50*time.Millisecond)

			disconnect()

			testenv.AwaitChannelWithT(t, endSubscriptionTimeout, endedWithToken, func(t *testing.T, token any) {
				assert.Equal(t, "token of the NATS subscription", token)
			})
		})
	})

	t.Run("SubscriptionOnEnd finds no stored value when a SubscriptionOnCreate handler rejected the NATS subscription before SubscriptionOnStart was called", func(t *testing.T) {
		t.Parallel()

		type storedToken struct {
			token  any
			exists bool
		}
		endedWithToken := make(chan storedToken, 1)

		startModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				ctx.Set(subscriptionTokenKey, "token of the NATS subscription")
				return nil
			},
		}
		onCreateModule := &subscription_on_create.SubscriptionOnCreateModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnCreateHandlerContext) error {
				return errors.New("subscription rejected by hook")
			},
		}
		customModule := newEndSubscriptionModule(func(ctx core.SubscriptionOnEndHandlerContext) {
			token, exists := ctx.Get(subscriptionTokenKey)
			endedWithToken <- storedToken{token: token, exists: exists}
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{
					"endSubscriptionModule":      customModule,
					"startSubscriptionModule":    startModule,
					"subscriptionOnCreateModule": onCreateModule,
				},
				&end_subscription.EndSubscriptionModule{},
				&start_subscription.StartSubscriptionModule{},
				&subscription_on_create.SubscriptionOnCreateModule{},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp := subscribeOverSSE(t, context.Background(), xEnv, `subscription { employeeUpdatedMyNats(id: 1) { id } }`)

			// The router closes the response once the subscription has ended.
			_, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			testenv.AwaitChannelWithT(t, endSubscriptionTimeout, endedWithToken, func(t *testing.T, stored storedToken) {
				assert.Equal(t, storedToken{token: nil, exists: false}, stored)
			})
			assert.Equal(t, int32(0), startModule.HookCallCount.Load())
		})
	})

	t.Run("A panic in SubscriptionOnEnd is recovered and later subscriptions still work", func(t *testing.T) {
		t.Parallel()

		customModule := newEndSubscriptionModule(func(ctx core.SubscriptionOnEndHandlerContext) {
			panic("intentional panic from SubscriptionOnEnd hook")
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: endSubscriptionRouterOptions(
				map[string]any{"endSubscriptionModule": customModule},
				&end_subscription.EndSubscriptionModule{},
			),
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.ErrorLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			for i, id := range []string{"1", "2"} {
				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      id,
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { countEmp(max: 1, intervalMilliseconds: 100) }"}`),
				})
				require.NoError(t, err)

				for _, expectedType := range []string{"next", "next", "complete"} {
					var msg testenv.WebSocketMessage
					require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
					require.Equal(t, expectedType, msg.Type)
					require.Equal(t, id, msg.ID)
				}

				requireEndHookCallCount(t, customModule, int32(i+1))
			}

			// The module counts the call before it panics, so the recovery log can follow the count.
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessageSnippet("[Recovery from handler panic]").Len() == 2
			}, endSubscriptionTimeout, 50*time.Millisecond)
		})
	})
}
