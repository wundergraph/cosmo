package pubsub

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

func TestBuildProvidersAndDataSources_OK(t *testing.T) {
	ctx := context.Background()

	dsMeta := &plan.DataSourceMetadata{
		RootNodes: []plan.TypeField{
			{
				TypeName:   "Type1",
				FieldNames: []string{"Field1", "Field2"},
			},
		},
	}

	// Mock input data
	event := &nodev1.EngineEventConfiguration{
		ProviderId: "provider-1",
		TypeName:   "Type1",
		FieldName:  "Field1",
		Type:       nodev1.EventType_PUBLISH,
	}
	dsConf := DataSourceConfigurationWithMetadata{
		Configuration: &nodev1.DataSourceConfiguration{
			Id: "test-id",
			CustomEvents: &nodev1.DataSourceCustomEvents{
				Nats: []*nodev1.NatsEventConfiguration{
					{
						EngineEventConfiguration: event,
					},
				},
			},
		},
		Metadata: dsMeta,
	}
	dsConfs := []DataSourceConfigurationWithMetadata{dsConf}

	// Execute the function
	providers, dataSources, err := BuildProvidersAndDataSources(ctx, config.EventsConfiguration{
		Providers: config.EventProviders{
			Nats: []config.NatsEventSource{
				{ID: "provider-1"},
			},
		},
	}, zap.NewNop(), dsConfs, "host", "addr")

	// Assertions
	assert.NoError(t, err)
	require.Len(t, providers, 1)
	require.Equal(t, providers[0].ID(), "provider-1")
	require.Equal(t, providers[0].TypeID(), "nats")
	require.Len(t, dataSources, 1)
	assert.True(t, dataSources[0].HasRootNode("Type1", "Field1"))
	assert.False(t, dataSources[0].HasRootNode("Type1", "Field2"))
}
