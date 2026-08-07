package events_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const redisBrokerAddr = "127.0.0.1:6379"

func TestRedisSkipUnavailableProviders(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	// router start but one or more provider needed is not defined.
	t.Run("router starts when a Redis provider is not defined and the flag is enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              false,
			NoRetryClient:            true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				cfg.Providers.Redis = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			notDefined := xEnv.Observer().FilterMessage(providerNotDefinedLogMsg)
			require.NotZero(t, notDefined.Len())
			require.NotZero(t, notDefined.FilterField(zap.String("provider_type", "redis")).Len())
			require.Zero(t, xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).Len())

			// The mutation backed by the undefined provider is unavailable.
			errRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "x"}) { success } }`,
			})
			require.NoError(t, err)
			require.Contains(t, errRes.Body, "errors")
			require.NotContains(t, errRes.Body, `"updateEmployeeMyRedis":{"success":true}`)
		})
	})

	// router start but one or more provider are not reachable.
	t.Run("router starts when a Redis broker is unreachable and the flag is enabled", func(t *testing.T) {
		t.Parallel()

		proxy := testenv.NewToggleableProxy(t, redisBrokerAddr)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointRedisProvidersAt(cfg, "redis://"+proxy.Addr())
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "redis")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)
			require.Zero(t, xEnv.Observer().FilterMessage(providerNotDefinedLogMsg).Len())
		})
	})

	// if the provider is not reachable but became reachable, should start working without
	// router restarting.
	t.Run("Redis provider recovers without a restart once the broker becomes reachable", func(t *testing.T) {
		t.Parallel()

		proxy := testenv.NewToggleableProxy(t, redisBrokerAddr)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointRedisProvidersAt(cfg, "redis://"+proxy.Addr())
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The broker was unreachable at startup.
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "redis")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)

			// The subscription is established while the broker is still down; go-redis
			// reconnects on its own once it becomes reachable.
			var subscriptionOne struct {
				employeeUpdates struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdates"`
			}

			client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

			subscriptionArgsCh := make(chan subscriptionArgs)
			_, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)

			// Buffered so the goroutine never blocks delivering Run()'s result, even if the
			// drain below times out before reading it.
			runCh := make(chan error, 1)
			go func() {
				runCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// The broker becomes reachable.
			proxy.SetReachable(true)

			// Without restarting the router, the subscription starts receiving messages.
			xEnv.RedisPublishUntilReceived(`employeeUpdatedMyRedis`, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			// Close the client and verify Run() returned cleanly.
			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, runCh, func(t *testing.T, runErr error) {
				require.NoError(t, runErr)
			}, "unable to close client before timeout")
		})
	})

	// strict mode (flag disabled) must still abort startup when a broker is unreachable.
	t.Run("router fails to start when a Redis broker is unreachable and the flag is disabled", func(t *testing.T) {
		t.Parallel()

		listener := testenv.NewWaitingListener(t, time.Second*10)
		listener.Start()
		defer listener.Close()

		err := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              false,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				pointRedisProvidersAt(cfg, "redis://127.0.0.1:"+strconv.Itoa(listener.Port()))
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "router should not start when a broker is unreachable in strict mode")
		})
		require.Error(t, err)
	})
}

// pointRedisProvidersAt rewrites every configured Redis provider to use url.
func pointRedisProvidersAt(cfg *config.EventsConfiguration, url string) {
	if len(cfg.Providers.Redis) == 0 {
		for _, sourceName := range testenv.DemoRedisProviders {
			cfg.Providers.Redis = append(cfg.Providers.Redis, config.RedisEventSource{ID: sourceName})
		}
	}
	for i := range cfg.Providers.Redis {
		cfg.Providers.Redis[i].URLs = []string{url}
	}
}
