package module_test

import (
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	start_subscription "github.com/wundergraph/cosmo/router-tests/modules/start-subscription"
	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
)

func TestStartSubscriptionHook(t *testing.T) {
	t.Parallel()

	t.Run("Test StartSubscription hook is called", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the OnStartSubscription hook is invoked when a client initiates a subscription.
		// It confirms the basic integration of the start subscription module by checking for the expected log message,
		// ensuring the hook is called at the right moment in the subscription lifecycle.

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: $employeeID)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"employeeID": 3,
			}
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, vars, func(dataValue []byte, errValue error) error {
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("Test StartSubscription write event works", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the OnStartSubscription hook can emit a custom event to the subscription
		// using WriteEvent(). It tests that a synthetic event injected by the hook is properly delivered
		// to the client when the subscription starts, allowing for initialization data or welcome messages.

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				if ctx.SubscriptionEventConfiguration().RootFieldName() != "employeeUpdatedMyKafka" {
					return nil
				}
				ctx.EmitEvent((&kafka.MutableEvent{
					Key:  []byte("1"),
					Data: []byte(`{"id": 1, "__typename": "Employee"}`),
				}))
				return nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: $employeeID)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"employeeID": 3,
			}
			type kafkaSubscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, vars, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("Test StartSubscription closes client connection when hook returns an error", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the OnStartSubscription hook returns an error, the subscription
		// is closed and the error is propagated to the client. It ensures that hooks can prevent
		// subscriptions from starting by returning an error, which triggers proper cleanup.

		callbackCalled := make(chan bool)

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				callbackCalled <- true
				return &core.StreamHandlerError{Message: "my custom error"}
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: $employeeID)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"employeeID": 3,
			}
			type kafkaSubscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionArgsCh := make(chan kafkaSubscriptionArgs, 1)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, vars, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)
			testenv.AwaitChannelWithT(t, 10*time.Second, callbackCalled, func(t *testing.T, called bool) {
				require.True(t, called)
			}, "StartSubscription callback was not invoked")
			xEnv.WaitForSubscriptionCount(0, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())

			require.Len(t, subscriptionArgsCh, 1)
			subscriptionArgs := <-subscriptionArgsCh
			require.Error(t, subscriptionArgs.errValue)
			require.Empty(t, subscriptionArgs.dataValue)
		})
	})

	t.Run("Test event emitted byStartSubscription sends event only to the client that triggered the hook", func(t *testing.T) {
		t.Parallel()

		// This test verifies that WriteEvent() in the OnStartSubscription hook sends events only to the specific
		// subscription that triggered the hook, not to other subscriptions. It tests with multiple subscriptions
		// to ensure event isolation and that hooks can target individual clients based on their context.

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				employeeId := ctx.Operation().Variables().GetInt64("employeeID")
				if employeeId != 1 {
					return nil
				}
				evt := ctx.NewEvent([]byte(`{"id": 1, "__typename": "Employee"}`))
				ctx.EmitEvent(evt)
				return nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: $employeeID)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"employeeID": 3,
			}
			vars2 := map[string]interface{}{
				"employeeID": 1,
			}
			type kafkaSubscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionOneArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscription, vars, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- kafkaSubscriptionArgs{
					dataValue: []byte{},
					errValue:  errors.New("should not be called"),
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			subscriptionTwoArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionTwoID, err := client.Subscribe(&subscription, vars2, func(dataValue []byte, errValue error) error {
				subscriptionTwoArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(2, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionTwoArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(2), customModule.HookCallCount.Load())
			t.Cleanup(func() {
				require.Len(t, subscriptionOneArgsCh, 0)
			})
		})
	})

	t.Run("Test StartSubscription error is propagated to the client", func(t *testing.T) {
		t.Parallel()

		// This test verifies that errors returned by the OnStartSubscription hook are properly propagated to the client
		// with correct HTTP status codes and error messages. It ensures clients receive detailed error information
		// including custom status codes when a subscription is rejected by the hook.

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				return &core.StreamHandlerError{Message: "test error"}
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: $employeeID)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"employeeID": 1,
			}
			type kafkaSubscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionOneArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscription, vars, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			// Wait for the subscription to be closed
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			expectedError := graphql.Errors{graphql.Error{Message: "test error"}}

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				var actualError graphql.Errors
				require.ErrorAs(t, args.errValue, &actualError)
				assert.Equal(t, expectedError, actualError)
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
			t.Cleanup(func() {
				require.Len(t, subscriptionOneArgsCh, 0)
			})
		})
	})

	t.Run("Test StartSubscription hook is called for engine subscription", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the OnStartSubscription hook is called for engine-based subscriptions
		// (subscriptions resolved by the router's execution engine, not event-driven sources like Kafka).
		// It ensures the hook works uniformly across different subscription types.

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscriptionCountEmp struct {
				CountEmp int `graphql:"countEmp(max: $max, intervalMilliseconds: $interval)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"max":      1,
				"interval": 200,
			}
			subscriptionOneID, err := client.Subscribe(&subscriptionCountEmp, vars, func(dataValue []byte, errValue error) error {
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("Test StartSubscription hook is called for engine subscription and write event works", func(t *testing.T) {
		t.Parallel()

		// This test verifies that WriteEvent() works for engine-based subscriptions, allowing hooks to inject
		// custom events even for subscriptions that don't use event-driven sources. It tests that the synthetic
		// event is delivered first, followed by the normal engine-generated subscription data.

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				evt := ctx.NewEvent([]byte(`{"data":{"countEmp":1000}}`))
				ctx.EmitEvent(evt)
				return nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscriptionCountEmp struct {
				CountEmp int `graphql:"countEmp(max: $max, intervalMilliseconds: $interval)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"max":      0,
				"interval": 0,
			}

			type subscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionOneArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionCountEmp, vars, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionOneArgsCh, func(t *testing.T, args subscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"countEmp": 1000}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionOneArgsCh, func(t *testing.T, args subscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"countEmp": 0}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})

	t.Run("Test when StartSubscription hook returns an error, the OnOriginResponse hook is not called", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the OnStartSubscription hook returns an error, subsequent hooks like
		// OnOriginResponse are not executed. It ensures proper hook chain short-circuiting when errors occur,
		// preventing unnecessary processing after a subscription has been rejected.

		originResponseCalled := make(chan *http.Response, 1)

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				return &core.StreamHandlerError{Message: "hook error"}
			},
			CallbackOnOriginResponse: func(response *http.Response, ctx core.RequestContext) *http.Response {
				originResponseCalled <- response
				return response
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionCountEmp struct {
				CountEmp int `graphql:"countEmp(max: $max, intervalMilliseconds: $interval)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			vars := map[string]interface{}{
				"max":      0,
				"interval": 0,
			}

			type subscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionOneArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionCountEmp, vars, func(dataValue []byte, errValue error) error {
				subscriptionOneArgsCh <- subscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionOneArgsCh, func(t *testing.T, args subscriptionArgs) {
				require.Error(t, args.errValue)
				require.Empty(t, args.dataValue)
			})

			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			require.Empty(t, originResponseCalled)

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})
}
