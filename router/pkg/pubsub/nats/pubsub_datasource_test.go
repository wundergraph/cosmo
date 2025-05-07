package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

func TestNatsPubSubDataSource(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject"},
	}

	// Create the data source to test with a real adapter
	adapter := &Adapter{}
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        adapter,
	}

	// Run the standard test suite
	datasource.VerifyPubSubDataSourceImplementation(t, pubsub)
}

func TestPubSubDataSourceWithMockAdapter(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject"},
	}

	// Create mock adapter
	mockAdapter := new(mockAdapter)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Subject == "test-subject"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.NoError(t, err)

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.NoError(t, err)

	// Call Load on the data source
	out := &bytes.Buffer{}
	err = ds.Load(context.Background(), []byte(input), out)
	require.NoError(t, err)
	require.Equal(t, `{"success": true}`, out.String())

	// Verify mock expectations
	mockAdapter.AssertExpectations(t)
}

func TestPubSubDataSource_GetResolveDataSource_WrongType(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_SUBSCRIBE, // This is not supported
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject"},
	}

	// Create mock adapter
	mockAdapter := new(mockAdapter)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.Error(t, err)
	require.Nil(t, ds)
}

func TestPubSubDataSource_GetResolveDataSourceInput_MultipleSubjects(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject-1", "test-subject-2"},
	}

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

func TestPubSubDataSource_GetResolveDataSourceInput_NoSubjects(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{},
	}

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

func TestNatsPubSubDataSourceMultiSubjectSubscription(t *testing.T) {
	// Create event configuration with multiple subjects
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH, // Must be PUBLISH as it's the only supported type
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject-1", "test-subject-2"},
	}

	// Create the data source to test with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
	}

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubsub.ResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	require.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Verify the subscription input contains both subjects
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.Equal(t, 2, len(subscriptionConfig.Subjects), "Expected 2 subjects in subscription configuration")
	require.Equal(t, "test-subject-1", subscriptionConfig.Subjects[0], "Expected first subject to be 'test-subject-1'")
	require.Equal(t, "test-subject-2", subscriptionConfig.Subjects[1], "Expected second subject to be 'test-subject-2'")
}

func TestNatsPubSubDataSourceWithStreamConfiguration(t *testing.T) {
	// Create event configuration with stream configuration
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject"},
		StreamConfiguration: &nodev1.NatsStreamConfiguration{
			StreamName:                "test-stream",
			ConsumerName:              "test-consumer",
			ConsumerInactiveThreshold: 30,
		},
	}

	// Create the data source to test
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
	}

	// Test GetResolveDataSourceSubscriptionInput with stream configuration
	subscriptionInput, err := pubsub.ResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	require.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Verify the subscription input contains stream configuration
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.NotNil(t, subscriptionConfig.StreamConfiguration, "Expected non-nil stream configuration")
	require.Equal(t, "test-consumer", subscriptionConfig.StreamConfiguration.Consumer, "Expected consumer to be 'test-consumer'")
	require.Equal(t, "test-stream", subscriptionConfig.StreamConfiguration.StreamName, "Expected stream name to be 'test-stream'")
	require.Equal(t, int32(30), subscriptionConfig.StreamConfiguration.ConsumerInactiveThreshold, "Expected consumer inactive threshold to be 30")
}

func TestPubSubDataSource_RequestDataSource(t *testing.T) {
	// Create event configuration with REQUEST type
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_REQUEST,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test-subject"},
	}

	// Create mock adapter
	mockAdapter := new(mockAdapter)

	// Configure mock expectations for Request
	mockAdapter.On("Request", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Subject == "test-subject"
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		w := args.Get(2).(io.Writer)
		w.Write([]byte(`{"response": "test"}`))
	})

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.NoError(t, err)
	require.NotNil(t, ds)

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.NoError(t, err)

	// Call Load on the data source
	out := &bytes.Buffer{}
	err = ds.Load(context.Background(), []byte(input), out)
	require.NoError(t, err)
	require.Equal(t, `{"response": "test"}`, out.String())

	// Verify mock expectations
	mockAdapter.AssertExpectations(t)
}
