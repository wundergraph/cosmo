package events_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// These messages are emitted by the router when events.skip_unavailable_providers is
// enabled. They must stay distinct so operators can tell an undefined provider (a
// configuration mistake) from a provider whose broker is unreachable (an availability
// problem that recovers on its own).
const (
	providerNotDefinedLogMsg   = "Event provider referenced by the execution config is not defined; skipping affected data sources, the corresponding fields will be unavailable"
	providerCouldNotConnectMsg = "EDFS provider could not be started at startup; the router will keep running and the fields backed by this provider are temporarily unavailable. An unreachable broker reconnects and recovers automatically without a restart; see the error for the cause"
)

const natsBrokerAddr = "127.0.0.1:4222"

func TestNatsSkipUnavailableProviders(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	// router start but one or more provider needed is not defined.
	t.Run("router starts when a NATS provider is not defined and the flag is enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			// EnableNats is false: no broker is started and no providers are configured, so
			// the NATS data sources reference an undefined provider.
			EnableNats: false,
			// The skipped field returns an error response; don't let the retry client spin.
			NoRetryClient: true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				cfg.Providers.Nats = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The router started: a non-EDFS query is served normally.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			// The undefined provider is reported with the "not defined" message and not the
			// "could not connect" message.
			notDefined := xEnv.Observer().FilterMessage(providerNotDefinedLogMsg)
			require.NotZero(t, notDefined.Len())
			require.NotZero(t, notDefined.FilterField(zap.String("provider_type", "nats")).Len())
			require.Zero(t, xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).Len())

			// The field backed by the undefined provider is unavailable: its data source was
			// skipped, so the query cannot be resolved.
			errRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employeeFromEvent(id: 3) { id } }`,
			})
			require.NoError(t, err)
			require.Contains(t, errRes.Body, "errors")
			require.NotContains(t, errRes.Body, `"employeeFromEvent":{`)
		})
	})

	// router start but one or more provider are not reachable.
	t.Run("router starts when a NATS broker is unreachable and the flag is enabled", func(t *testing.T) {
		t.Parallel()

		// The proxy stays unreachable for the whole test, simulating a broker that is down.
		proxy := testenv.NewToggleableProxy(t, natsBrokerAddr)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointNatsProvidersAt(cfg, "nats://"+proxy.Addr())
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The router started despite the unreachable broker and serves normal traffic.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, `"id":1`)

			// The unreachable broker is reported with the "could not connect" message and
			// not the "not defined" message.
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "nats")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)
			require.Zero(t, xEnv.Observer().FilterMessage(providerNotDefinedLogMsg).Len())
		})
	})

	// if the provider is not reachable but became reachable, should start working without
	// router restarting.
	t.Run("NATS provider recovers without a restart once the broker becomes reachable", func(t *testing.T) {
		t.Parallel()

		proxy := testenv.NewToggleableProxy(t, natsBrokerAddr)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.SkipUnavailableProviders = true
				pointNatsProvidersAt(cfg, "nats://"+proxy.Addr())
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The broker was unreachable at startup.
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage(providerCouldNotConnectMsg).
					FilterField(zap.String("provider_type", "nats")).Len() > 0
			}, EventWaitTimeout, 100*time.Millisecond)

			// A responder on the real broker answers the EDFS request field.
			sub, err := xEnv.NatsConnectionDefault.Subscribe(xEnv.GetPubSubName("getEmployee.3"), func(msg *nats.Msg) {
				_ = msg.Respond([]byte(`{"id": 3, "__typename": "Employee"}`))
			})
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())
			t.Cleanup(func() { _ = sub.Unsubscribe() })

			// The broker becomes reachable.
			proxy.SetReachable(true)

			// Without restarting the router, the EDFS field starts working again as the NATS
			// client reconnects in the background.
			require.Eventually(t, func() bool {
				res, reqErr := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { employeeFromEvent(id: 3) { id } }`,
				})
				return reqErr == nil && strings.Contains(res.Body, `"employeeFromEvent":{"id":3}`)
			}, EventWaitTimeout, 500*time.Millisecond)
		})
	})

	// strict mode (flag disabled) must still abort startup when a broker is unreachable.
	t.Run("router fails to start when a NATS broker is unreachable and the flag is disabled", func(t *testing.T) {
		t.Parallel()

		listener := testenv.NewWaitingListener(t, time.Second*10)
		listener.Start()
		defer listener.Close()

		err := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               false,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				// flag intentionally left disabled
				pointNatsProvidersAt(cfg, "nats://127.0.0.1:"+strconv.Itoa(listener.Port()))
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "router should not start when a broker is unreachable in strict mode")
		})
		require.Error(t, err)
	})
}

// pointNatsProvidersAt rewrites every configured NATS provider URL to addr.
func pointNatsProvidersAt(cfg *config.EventsConfiguration, url string) {
	if len(cfg.Providers.Nats) == 0 {
		// EnableNats populated the demo providers; if a test cleared them, recreate them.
		for _, sourceName := range testenv.DemoNatsProviders {
			cfg.Providers.Nats = append(cfg.Providers.Nats, config.NatsEventSource{ID: sourceName})
		}
	}
	for i := range cfg.Providers.Nats {
		cfg.Providers.Nats[i].URL = url
	}
}
