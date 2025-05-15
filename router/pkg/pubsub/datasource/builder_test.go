package datasource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestBuildProvidersAndDataSources_OK(t *testing.T) {
	ctx := context.Background()
	mockBuilder := new(MockPubSubProviderBuilder)

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
	var generalEvents []EngineEventConfiguration
	for _, e := range dsConfs[0].Configuration.CustomEvents.Nats {
		generalEvents = append(generalEvents, e)
	}

	mockBuilder.On("EngineEventConfigurations", dsConf.Configuration).Return(generalEvents)
	mockBuilder.On("Providers", []string{"provider-1"}).Return([]PubSubProvider{&MockPubSubProvider{}}, nil)
	mockBuilder.On("DataSource", generalEvents[0]).Return(PubSubDataSource(&MockPubSubDataSource{}), nil)

	// Execute the function
	providers, dataSources, err := BuildProvidersAndDataSources(ctx, mockBuilder, dsConfs)

	// Assertions
	mockBuilder.AssertExpectations(t)
	assert.NoError(t, err)
	require.Len(t, providers, 1)
	require.Len(t, dataSources, 1)
	assert.True(t, dataSources[0].HasRootNode("Type1", "Field1"))
	assert.False(t, dataSources[0].HasRootNode("Type1", "Field2"))
}

func TestBuildProvidersAndDataSources_ProviderError(t *testing.T) {
	ctx := context.Background()
	mockBuilder := new(MockPubSubProviderBuilder)

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
	var generalEvents []EngineEventConfiguration
	for _, e := range dsConfs[0].Configuration.CustomEvents.Nats {
		generalEvents = append(generalEvents, e)
	}

	mockBuilder.On("EngineEventConfigurations", dsConf.Configuration).Return(generalEvents)
	mockBuilder.On("Providers", []string{"provider-1"}).Return(nil, errors.New("provider error"))

	// Execute the function
	providers, dataSources, err := BuildProvidersAndDataSources(ctx, mockBuilder, dsConfs)

	// Assertions
	mockBuilder.AssertExpectations(t)
	assert.Error(t, err)
	require.Len(t, providers, 0)
	require.Len(t, dataSources, 0)
}

func TestBuildProvidersAndDataSources_DataSourceError(t *testing.T) {
	ctx := context.Background()
	mockBuilder := new(MockPubSubProviderBuilder)

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
	var generalEvents []EngineEventConfiguration
	for _, e := range dsConfs[0].Configuration.CustomEvents.Nats {
		generalEvents = append(generalEvents, e)
	}

	mockBuilder.On("EngineEventConfigurations", dsConf.Configuration).Return(generalEvents)
	mockBuilder.On("Providers", []string{"provider-1"}).Return([]PubSubProvider{&MockPubSubProvider{}}, nil)
	mockBuilder.On("DataSource", generalEvents[0]).Return(nil, errors.New("data source error"))

	// Execute the function
	providers, dataSources, err := BuildProvidersAndDataSources(ctx, mockBuilder, dsConfs)

	// Assertions
	mockBuilder.AssertExpectations(t)
	assert.Error(t, err)
	require.Len(t, providers, 0)
	require.Len(t, dataSources, 0)
}

type MockPubSubProviderBuilder struct {
	mock.Mock
}

func (m *MockPubSubProviderBuilder) EngineEventConfigurations(config *nodev1.DataSourceConfiguration) []EngineEventConfiguration {
	args := m.Called(config)
	arg := args.Get(0)
	if arg == nil {
		return nil
	}
	return arg.([]EngineEventConfiguration)
}

func (m *MockPubSubProviderBuilder) Providers(providerIds []string) ([]PubSubProvider, error) {
	args := m.Called(providerIds)
	arg := args.Get(0)
	if arg == nil {
		return nil, args.Error(1)
	}
	return arg.([]PubSubProvider), args.Error(1)
}

func (m *MockPubSubProviderBuilder) DataSource(event EngineEventConfiguration) (PubSubDataSource, error) {
	args := m.Called(event)
	arg := args.Get(0)
	if arg == nil {
		return nil, args.Error(1)
	}
	return arg.(PubSubDataSource), args.Error(1)
}

func (m *MockPubSubProviderBuilder) TypeID() string {
	return "mockType"
}

type MockPubSubDataSource struct {
	mock.Mock
}

func (m *MockPubSubDataSource) ResolveDataSource() (resolve.DataSource, error) {
	args := m.Called()
	return args.Get(0).(resolve.DataSource), args.Error(1)
}

func (m *MockPubSubDataSource) ResolveDataSourceInput(event []byte) (string, error) {
	args := m.Called(event)
	return args.String(0), args.Error(1)
}

func (m *MockPubSubDataSource) EngineEventConfiguration() *nodev1.EngineEventConfiguration {
	args := m.Called()
	return args.Get(0).(*nodev1.EngineEventConfiguration)
}

func (m *MockPubSubDataSource) ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	args := m.Called()
	return args.Get(0).(resolve.SubscriptionDataSource), args.Error(1)
}

func (m *MockPubSubDataSource) ResolveDataSourceSubscriptionInput() (string, error) {
	args := m.Called()
	return args.String(0), args.Error(1)
}

func (m *MockPubSubDataSource) TransformEventData(extractFn ArgumentTemplateCallback) error {
	args := m.Called(extractFn)
	return args.Error(0)
}

// MockPubSubProvider is a mock implementation of the PubSubProvider interface
type MockPubSubProvider struct {
	mock.Mock
}

func (m *MockPubSubProvider) ID() string {
	args := m.Called()
	return args.String(0)
}

func (m *MockPubSubProvider) TypeID() string {
	args := m.Called()
	return args.String(0)
}

func (m *MockPubSubProvider) Startup(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockPubSubProvider) Shutdown(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}
