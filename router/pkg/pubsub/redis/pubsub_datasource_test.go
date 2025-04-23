package redis

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

func TestRedisPubSubDataSource(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	redisCfg := &nodev1.RedisEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Channels:                 []string{"test-channel"},
	}

	// Create the data source to test with a real adapter
	adapter := &Adapter{}
	pubsub := &PubSubDataSource{
		EventConfiguration: redisCfg,
		RedisAdapter:       adapter,
	}

	// Run the standard test suite
	datasource.VerifyPubSubDataSourceImplementation(t, pubsub)
}

// TestPubSubDataSourceWithMockAdapter tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSourceWithMockAdapter(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	redisCfg := &nodev1.RedisEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Channels:                 []string{"test-channel"},
	}

	// Create mock adapter
	mockAdapter := new(mockAdapter)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Channel == "test-channel"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: redisCfg,
		RedisAdapter:       mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.GetResolveDataSource()
	require.NoError(t, err)

	// Get the input
	input, err := pubsub.GetResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.NoError(t, err)

	// Call Load on the data source
	out := &bytes.Buffer{}
	err = ds.Load(context.Background(), []byte(input), out)
	require.NoError(t, err)
	require.Equal(t, `{"success": true}`, out.String())

	// Verify mock expectations
	mockAdapter.AssertExpectations(t)
}

// TestPubSubDataSource_GetResolveDataSource_WrongType tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSource_GetResolveDataSource_WrongType(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_SUBSCRIBE,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	redisCfg := &nodev1.RedisEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Channels:                 []string{"test-channel"},
	}

	// Create mock adapter
	mockAdapter := new(mockAdapter)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: redisCfg,
		RedisAdapter:       mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.GetResolveDataSource()
	require.Error(t, err)
	require.Nil(t, ds)
}

// TestPubSubDataSource_GetResolveDataSourceInput_MultipleChannels tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSource_GetResolveDataSourceInput_MultipleChannels(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	redisCfg := &nodev1.RedisEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Channels:                 []string{"test-channel-1", "test-channel-2"},
	}

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: redisCfg,
	}

	// Get the input
	input, err := pubsub.GetResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

// TestPubSubDataSource_GetResolveDataSourceInput_NoChannels tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSource_GetResolveDataSourceInput_NoChannels(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	redisCfg := &nodev1.RedisEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Channels:                 []string{},
	}

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: redisCfg,
	}

	// Get the input
	input, err := pubsub.GetResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

// TestRedisPubSubDataSourceMultiChannelSubscription tests only the subscription functionality
// for multiple channels. The publish and resolve datasource tests are skipped since they
// do not support multiple channels.
func TestRedisPubSubDataSourceMultiChannelSubscription(t *testing.T) {
	// Create event configuration with multiple channels
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH, // Must be PUBLISH as it's the only supported type
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	redisCfg := &nodev1.RedisEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Channels:                 []string{"test-channel-1", "test-channel-2"},
	}

	// Create the data source to test with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: redisCfg,
	}

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubsub.GetResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	require.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Verify the subscription input contains both channels
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.Equal(t, 2, len(subscriptionConfig.Channels), "Expected 2 channels in subscription configuration")
	require.Equal(t, "test-channel-1", subscriptionConfig.Channels[0], "Expected first channel to be 'test-channel-1'")
	require.Equal(t, "test-channel-2", subscriptionConfig.Channels[1], "Expected second channel to be 'test-channel-2'")
}
