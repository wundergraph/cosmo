package core

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	pubsub_datasource "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// Regression test: the instance data passed via ExecutorBuildOptions must reach the NATS provider.
// Previously it was dropped, so every router replica got the same hostname/listen address and thereby
// the same JetStream durable consumer name, which split events across replicas.
func TestBuildPlannerConfigurationPassesInstanceDataToNatsProvider(t *testing.T) {
	t.Parallel()

	const providerID = "my-nats"

	b := &ExecutorConfigurationBuilder{
		logger:                    zap.NewNop(),
		transportOptions:          &TransportOptions{SubgraphTransportOptions: NewSubgraphTransportOptions(config.TrafficShapingRules{})},
		subscriptionClientOptions: &SubscriptionClientOptions{},
	}

	opts := &ExecutorBuildOptions{
		EngineConfig: &nodev1.EngineConfiguration{
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Id:   "nats-ds",
					Kind: nodev1.DataSourceKind_PUBSUB,
					CustomEvents: &nodev1.DataSourceCustomEvents{
						Nats: []*nodev1.NatsEventConfiguration{
							{
								EngineEventConfiguration: &nodev1.EngineEventConfiguration{
									ProviderId: providerID,
									Type:       nodev1.EventType_SUBSCRIBE,
									TypeName:   "Subscription",
									FieldName:  "employeeUpdated",
								},
								Subjects: []string{"employeeUpdated"},
							},
						},
					},
				},
			},
		},
		RouterEngineConfig: &RouterEngineConfiguration{
			Events: config.EventsConfiguration{
				Providers: config.EventProviders{
					Nats: []config.NatsEventSource{{ID: providerID, URL: "nats://localhost:4222"}},
				},
			},
		},
		InstanceData: InstanceData{
			HostName:      "test-host",
			ListenAddress: "localhost:3002",
		},
	}

	_, providers, err := b.buildPlannerConfiguration(t.Context(), opts)
	require.NoError(t, err)
	require.Len(t, providers, 1)

	provider, ok := providers[0].(*pubsub_datasource.PubSubProvider)
	require.True(t, ok, "expected *PubSubProvider, got %T", providers[0])

	// The adapter's fields are unexported and live in another package, so read them via reflection.
	adapter := reflect.ValueOf(provider.Adapter).Elem()
	require.Equal(t, "test-host", adapter.FieldByName("hostName").String())
	require.Equal(t, "localhost:3002", adapter.FieldByName("routerListenAddr").String())
}
