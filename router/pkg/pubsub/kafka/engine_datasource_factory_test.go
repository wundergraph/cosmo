package kafka

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/pubsubtest"
)

func TestKafkaEngineDataSourceFactory(t *testing.T) {
	// Create the data source to test with a real adapter
	adapter := &ProviderAdapter{}
	pubsub := &EngineDataSourceFactory{
		KafkaAdapter: adapter,
		fieldName:    "testField",
		eventType:    EventTypePublish,
		topics:       []string{"test-topic"},
		providerId:   "test-provider",
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
		return event.ProviderID == "test-provider" && event.Topic == "test-topic"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		KafkaAdapter: mockAdapter,
		fieldName:    "testField",
		eventType:    EventTypePublish,
		topics:       []string{"test-topic"},
		providerId:   "test-provider",
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
		KafkaAdapter: mockAdapter,
		fieldName:    "testField",
		eventType:    EventTypeSubscribe,
		topics:       []string{"test-topic"},
		providerId:   "test-provider",
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.Error(t, err)
	require.Nil(t, ds)
}

// TestEngineDataSourceFactory_GetResolveDataSourceInput_MultipleTopics tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactory_GetResolveDataSourceInput_MultipleTopics(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		fieldName:  "testField",
		eventType:  EventTypePublish,
		topics:     []string{"test-topic-1", "test-topic-2"},
		providerId: "test-provider",
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

// TestEngineDataSourceFactory_GetResolveDataSourceInput_NoTopics tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactory_GetResolveDataSourceInput_NoTopics(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		fieldName:  "testField",
		eventType:  EventTypePublish,
		topics:     []string{},
		providerId: "test-provider",
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

// TestKafkaEngineDataSourceFactoryMultiTopicSubscription tests only the subscription functionality
// for multiple topics. The publish and resolve datasource tests are skipped since they
// do not support multiple topics.
func TestKafkaEngineDataSourceFactoryMultiTopicSubscription(t *testing.T) {
	// Create the data source to test with mock adapter
	pubsub := &EngineDataSourceFactory{
		fieldName:  "testField",
		eventType:  EventTypePublish,
		topics:     []string{"test-topic-1", "test-topic-2"},
		providerId: "test-provider",
	}

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubsub.ResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	require.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Verify the subscription input contains both topics
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.Equal(t, 2, len(subscriptionConfig.Topics), "Expected 2 topics in subscription configuration")
	require.Equal(t, "test-topic-1", subscriptionConfig.Topics[0], "Expected first topic to be 'test-topic-1'")
	require.Equal(t, "test-topic-2", subscriptionConfig.Topics[1], "Expected second topic to be 'test-topic-2'")
}
