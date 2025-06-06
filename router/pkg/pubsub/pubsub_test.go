package pubsub

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

func TestBuild_OK(t *testing.T) {
	ctx := context.Background()
	mockBuilder := datasource.NewMockProviderBuilder[config.NatsEventSource, *nodev1.NatsEventConfiguration](t)
	mockPubSubProvider := datasource.NewMockProvider(t)

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
	dsConfs := []dsConfAndEvents[*nodev1.NatsEventConfiguration]{
		{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetNats(),
		},
	}
	natsEventSources := []config.NatsEventSource{
		{ID: "provider-1"},
	}

	mockPubSubProvider.On("ID").Return("provider-1")

	mockBuilder.On("TypeID").Return("nats")
	mockBuilder.On("BuildProvider", natsEventSources[0]).Return(mockPubSubProvider, nil)

	// ctx, kafkaBuilder, config.Providers.Kafka, kafkaDsConfsWithEvents
	// Execute the function
	providers, dataSources, err := build(ctx, mockBuilder, natsEventSources, dsConfs)

	// Assertions
	assert.NoError(t, err)
	require.Len(t, providers, 1)
	require.Len(t, dataSources, 1)
	assert.True(t, dataSources[0].HasRootNode("Type1", "Field1"))
	assert.False(t, dataSources[0].HasRootNode("Type1", "Field2"))
}

func TestBuild_ProviderError(t *testing.T) {
	ctx := context.Background()
	mockBuilder := datasource.NewMockProviderBuilder[config.NatsEventSource, *nodev1.NatsEventConfiguration](t)

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
	dsConfs := []dsConfAndEvents[*nodev1.NatsEventConfiguration]{
		{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetNats(),
		},
	}
	natsEventSources := []config.NatsEventSource{
		{ID: "provider-1"},
	}

	mockBuilder.On("BuildProvider", natsEventSources[0]).Return(nil, errors.New("provider error"))

	// Execute the function
	providers, dataSources, err := build(ctx, mockBuilder, natsEventSources, dsConfs)

	// Assertions
	assert.Error(t, err)
	require.Len(t, providers, 0)
	require.Len(t, dataSources, 0)
}

func TestBuild_ShouldGetAnErrorIfProviderIsNotDefined(t *testing.T) {
	ctx := context.Background()
	mockBuilder := datasource.NewMockProviderBuilder[config.NatsEventSource, *nodev1.NatsEventConfiguration](t)
	//mockPubSubProvider := datasource.NewMockPubSubProvider(t)

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
		ProviderId: "provider-2",
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
	dsConfs := []dsConfAndEvents[*nodev1.NatsEventConfiguration]{
		{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetNats(),
		},
	}
	natsEventSources := []config.NatsEventSource{
		{ID: "provider-1"},
	}

	mockBuilder.On("TypeID").Return("nats")

	// Execute the function
	providers, dataSources, err := build(ctx, mockBuilder, natsEventSources, dsConfs)

	// Assertions
	assert.Error(t, err)
	assert.IsType(t, &ProviderNotDefinedError{
		ProviderID:     "provider-2",
		ProviderTypeID: "nats",
	}, err)
	require.Len(t, providers, 0)
	require.Len(t, dataSources, 0)
}

func TestBuild_ShouldNotInitializeProviderIfNotUsed(t *testing.T) {
	ctx := context.Background()
	mockBuilder := datasource.NewMockProviderBuilder[config.NatsEventSource, *nodev1.NatsEventConfiguration](t)
	mockPubSubUsedProvider := datasource.NewMockProvider(t)

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
		ProviderId: "provider-2",
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
	dsConfs := []dsConfAndEvents[*nodev1.NatsEventConfiguration]{
		{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetNats(),
		},
	}
	natsEventSources := []config.NatsEventSource{
		{ID: "provider-1"},
		{ID: "provider-2"},
	}

	mockPubSubUsedProvider.On("ID").Return("provider-2")

	mockBuilder.On("TypeID").Return("nats")
	mockBuilder.On("BuildProvider", natsEventSources[1]).Return(mockPubSubUsedProvider, nil)

	// Execute the function
	providers, dataSources, err := build(ctx, mockBuilder, natsEventSources, dsConfs)

	// Assertions
	assert.NoError(t, err)
	require.Len(t, providers, 1)
	require.Len(t, dataSources, 1)
	assert.True(t, dataSources[0].HasRootNode("Type1", "Field1"))
	assert.False(t, dataSources[0].HasRootNode("Type1", "Field2"))
}

func TestBuildProvidersAndDataSources_Nats_OK(t *testing.T) {
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

func TestBuildProvidersAndDataSources_Kafka_OK(t *testing.T) {
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
				Kafka: []*nodev1.KafkaEventConfiguration{
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
			Kafka: []config.KafkaEventSource{
				{ID: "provider-1"},
			},
		},
	}, zap.NewNop(), dsConfs, "host", "addr")

	// Assertions
	assert.NoError(t, err)
	require.Len(t, providers, 1)
	require.Equal(t, providers[0].ID(), "provider-1")
	require.Equal(t, providers[0].TypeID(), "kafka")
	require.Len(t, dataSources, 1)
	assert.True(t, dataSources[0].HasRootNode("Type1", "Field1"))
	assert.False(t, dataSources[0].HasRootNode("Type1", "Field2"))
}

func TestBuildProvidersAndDataSources_Redis_OK(t *testing.T) {
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
				Redis: []*nodev1.RedisEventConfiguration{
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
			Redis: []config.RedisEventSource{
				{ID: "provider-1"},
			},
		},
	}, zap.NewNop(), dsConfs, "host", "addr")

	// Assertions
	assert.NoError(t, err)
	require.Len(t, providers, 1)
	require.Equal(t, providers[0].ID(), "provider-1")
	require.Equal(t, providers[0].TypeID(), "redis")
	require.Len(t, dataSources, 1)
	assert.True(t, dataSources[0].HasRootNode("Type1", "Field1"))
	assert.False(t, dataSources[0].HasRootNode("Type1", "Field2"))
}
