package module_test

import (
	"errors"
	"net/http"
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

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{},
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

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test StartSubscription write event works", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{
					Callback: func(ctx core.SubscriptionOnStartHookContext) error {
						ctx.WriteEvent(&kafka.Event{
							Key:  []byte("1"),
							Data: []byte(`{"id": 1, "__typename": "Employee"}`),
						})
						return nil
					},
				},
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

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test StartSubscription with close to true", func(t *testing.T) {
		t.Parallel()

		callbackCalled := make(chan bool)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{
					Callback: func(ctx core.SubscriptionOnStartHookContext) error {
						callbackCalled <- true
						return core.NewStreamHookError(nil, "subscription closed", http.StatusOK, "", true)
					},
				},
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
			<-callbackCalled
			xEnv.WaitForSubscriptionCount(0, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			require.Len(t, subscriptionArgsCh, 0)
		})
	})

	t.Run("Test StartSubscription write event sends event only to the subscription", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{
					Callback: func(ctx core.SubscriptionOnStartHookContext) error {
						employeeId := ctx.RequestContext().Operation().Variables().GetInt64("employeeID")
						if employeeId != 1 {
							return nil
						}
						ctx.WriteEvent(&kafka.Event{
							Data: []byte(`{"id": 1, "__typename": "Employee"}`),
						})
						return nil
					},
				},
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

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 2)
			t.Cleanup(func() {
				require.Len(t, subscriptionOneArgsCh, 0)
			})
		})
	})

	t.Run("Test StartSubscription error is propagated to the client", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{
					Callback: func(ctx core.SubscriptionOnStartHookContext) error {
						return core.NewStreamHookError(errors.New("test error"), "test error", http.StatusLoopDetected, http.StatusText(http.StatusLoopDetected), false)
					},
				},
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

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionOneArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				var graphqlErrs graphql.Errors
				require.ErrorAs(t, args.errValue, &graphqlErrs)
				statusCode, ok := graphqlErrs[0].Extensions["statusCode"].(float64)
				require.True(t, ok, "statusCode is not a float64")
				require.Equal(t, http.StatusLoopDetected, int(statusCode))
				require.Equal(t, http.StatusText(http.StatusLoopDetected), graphqlErrs[0].Extensions["code"])
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)
			t.Cleanup(func() {
				require.Len(t, subscriptionOneArgsCh, 0)
			})
		})
	})

	t.Run("Test StartSubscription hook is called for engine subscription", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{},
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

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test StartSubscription hook is called for engine subscription and write event works", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{
					Callback: func(ctx core.SubscriptionOnStartHookContext) error {
						ctx.WriteEvent(&core.EngineEvent{
							Data: []byte(`{"data":{"countEmp":1000}}`),
						})
						return nil
					},
				},
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

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})
}
