package events_test

import (
	"strings"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const kafkaBrokerAddr = "127.0.0.1:9092"

func TestKafkaSkipUnavailableProviders(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	// router start but one or more provider needed is not defined.
	t.Run("router starts when a Kafka provider is not defined and the flag is enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              false,
			NoRetryClient:            true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				cfg.Providers.Kafka = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			notDefined := xEnv.Observer().FilterMessage(providerNotDefinedLogMsg)
			require.NotZero(t, notDefined.Len())
			require.NotZero(t, notDefined.FilterField(zap.String("provider_type", "kafka")).Len())
			require.Zero(t, xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).Len())

			// The mutation backed by the undefined provider is unavailable.
			errRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "x"}) { success } }`,
			})
			require.NoError(t, err)
			require.Contains(t, errRes.Body, "errors")
			require.NotContains(t, errRes.Body, `"updateEmployeeMyKafka":{"success":true}`)
		})
	})

	// router start but one or more provider are not reachable.
	t.Run("router starts when a Kafka broker is unreachable and the flag is enabled", func(t *testing.T) {
		t.Parallel()

		proxy := testenv.NewToggleableProxy(t, kafkaBrokerAddr)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointKafkaProvidersAt(cfg, []string{proxy.Addr()})
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "kafka")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)
			require.Zero(t, xEnv.Observer().FilterMessage(providerNotDefinedLogMsg).Len())
		})
	})

	// if the provider is not reachable but became reachable, should start working without
	// router restarting.
	t.Run("Kafka provider recovers without a restart once the broker becomes reachable", func(t *testing.T) {
		t.Parallel()

		proxy := testenv.NewToggleableProxy(t, kafkaBrokerAddr)
		topics := []string{"employeeUpdated"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointKafkaProvidersAt(cfg, []string{proxy.Addr()})
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			// The broker was unreachable at startup.
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "kafka")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)

			// The subscription is established while the broker is still down; kgo connects
			// lazily and reconnects on its own once it becomes reachable.
			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())
			t.Cleanup(func() { _ = client.Close() })

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
			_, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{dataValue: dataValue, errValue: errValue}
				return nil
			})
			require.NoError(t, err)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// The broker becomes reachable.
			proxy.SetReachable(true)

			// Without restarting the router, the subscription starts receiving messages.
			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})
		})
	})

	// The startup connectivity probe checks the producer (writeClient); this asserts that the
	// producer itself recovers and can publish once the broker becomes reachable, without a
	// router restart. (The subscription test above exercises a separate consumer client.)
	t.Run("Kafka producer recovers without a restart once the broker becomes reachable", func(t *testing.T) {
		t.Parallel()

		proxy := testenv.NewToggleableProxy(t, kafkaBrokerAddr)
		topics := []string{"employeeUpdated"}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointKafkaProvidersAt(cfg, []string{proxy.Addr()})
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)

			// The broker was unreachable at startup (the producer failed the connectivity probe).
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "kafka")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)

			// The broker becomes reachable.
			proxy.SetReachable(true)

			// Without restarting the router, a publish mutation (which uses the producer that
			// failed the startup probe) succeeds again.
			require.Eventually(t, func() bool {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "recovered"}) { success } }`,
				})
				return err == nil && strings.Contains(res.Body, `"updateEmployeeMyKafka":{"success":true}`)
			}, EventWaitTimeout, 500*time.Millisecond)
		})
	})

	// Unlike NATS and Redis, the Kafka client connects lazily, so in strict mode (flag
	// disabled) the router still starts when the broker is unreachable: connectivity is only
	// probed under skip_unavailable_providers, which is where the distinct error is logged.
	t.Run("router starts with an unreachable Kafka broker in strict mode because Kafka connects lazily", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              false,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				// flag intentionally left disabled; the address is closed so a probe (if any)
				// would fail, but kgo connects lazily so the router still starts.
				pointKafkaProvidersAt(cfg, []string{"127.0.0.1:1"})
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			// No connectivity probe runs in strict mode, so no "could not connect" log.
			require.Zero(t, xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).Len())
		})
	})
}

// pointKafkaProvidersAt rewrites every configured Kafka provider to use brokers.
//
// Note on the proxy with Kafka: kgo uses the seed broker only to bootstrap cluster
// metadata, then connects directly to each broker's advertised listener (localhost:9092
// here). So while the proxy is unreachable, metadata bootstrap fails and the router cannot
// connect (this is what the unreachable/recovery tests rely on); once the proxy is made
// reachable, the metadata bootstrap succeeds and steady-state produce/fetch traffic flows
// directly to the advertised address. The proxy therefore models a broker that is
// unreachable at startup and then becomes reachable, which is exactly the scenario under
// test. It does not model an outage of an already-bootstrapped data connection.
func pointKafkaProvidersAt(cfg *config.EventsConfiguration, brokers []string) {
	if len(cfg.Providers.Kafka) == 0 {
		for _, sourceName := range testenv.DemoKafkaProviders {
			cfg.Providers.Kafka = append(cfg.Providers.Kafka, config.KafkaEventSource{ID: sourceName})
		}
	}
	for i := range cfg.Providers.Kafka {
		cfg.Providers.Kafka[i].Brokers = brokers
	}
}
