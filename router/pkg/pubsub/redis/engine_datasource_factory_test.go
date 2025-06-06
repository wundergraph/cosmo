package redis

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/pubsubtest"
)

func TestRedisEngineDataSourceFactory(t *testing.T) {
	// Create the data source to test with a real adapter
	adapter := &ProviderAdapter{}
	pubsub := &EngineDataSourceFactory{
		EventConfiguration: &nodev1.RedisEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				FieldName:  "testField",
				TypeName:   "TestType",
				Type:       nodev1.EventType_PUBLISH,
				ProviderId: "test-provider",
			},
			Channels: []string{"test-channel"},
		},
		RedisAdapter: adapter,
	}

	// Run the standard test suite
	pubsubtest.VerifyEngineDataSourceFactoryImplementation(t, pubsub)
}

// TestEngineDataSourceFactoryWithMockAdapter tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactoryWithMockAdapter(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Channel == "test-channel"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		EventConfiguration: &nodev1.RedisEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				FieldName:  "testField",
				TypeName:   "TestType",
				Type:       nodev1.EventType_PUBLISH,
				ProviderId: "test-provider",
			},
			Channels: []string{"test-channel"},
		},
		RedisAdapter: mockAdapter,
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
}

// TestEngineDataSourceFactory_GetResolveDataSource_WrongType tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactory_GetResolveDataSource_WrongType(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		EventConfiguration: &nodev1.RedisEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				FieldName:  "testField",
				TypeName:   "TestType",
				Type:       nodev1.EventType_SUBSCRIBE,
				ProviderId: "test-provider",
			},
			Channels: []string{"test-channel"},
		},
		RedisAdapter: mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.Error(t, err)
	require.Nil(t, ds)
}

// TestEngineDataSourceFactory_GetResolveDataSourceInput_MultipleChannels tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactory_GetResolveDataSourceInput_MultipleChannels(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		EventConfiguration: &nodev1.RedisEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				FieldName:  "testField",
				TypeName:   "TestType",
				Type:       nodev1.EventType_PUBLISH,
				ProviderId: "test-provider",
			},
			Channels: []string{"test-channel-1", "test-channel-2"},
		},
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

// TestEngineDataSourceFactory_GetResolveDataSourceInput_NoChannels tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactory_GetResolveDataSourceInput_NoChannels(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		EventConfiguration: &nodev1.RedisEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				FieldName:  "testField",
				TypeName:   "TestType",
				Type:       nodev1.EventType_PUBLISH,
				ProviderId: "test-provider",
			},
			Channels: []string{},
		},
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

// TestRedisEngineDataSourceFactoryMultiChannelSubscription tests only the subscription functionality
// for multiple channels. The publish and resolve datasource tests are skipped since they
// do not support multiple channels.
func TestRedisEngineDataSourceFactoryMultiChannelSubscription(t *testing.T) {
	// Create the data source to test with mock adapter
	pubsub := &EngineDataSourceFactory{
		EventConfiguration: &nodev1.RedisEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				FieldName:  "testField",
				TypeName:   "TestType",
				Type:       nodev1.EventType_PUBLISH,
				ProviderId: "test-provider",
			},
			Channels: []string{"test-channel-1", "test-channel-2"},
		},
	}

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubsub.ResolveDataSourceSubscriptionInput()
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
