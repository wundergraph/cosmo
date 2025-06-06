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

func TestKafkaPubSubDataSource(t *testing.T) {
	// Create the data source to test with a real adapter
	adapter := &ProviderAdapter{}
	pubsub := &PubSubDataSource{
		KafkaAdapter: adapter,
		fieldName:    "testField",
		eventType:    EventTypePublish,
		topics:       []string{"test-topic"},
		providerId:   "test-provider",
	}

	// Run the standard test suite
	pubsubtest.VerifyPubSubDataSourceImplementation(t, pubsub)
}

// TestPubSubDataSourceWithMockAdapter tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSourceWithMockAdapter(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Topic == "test-topic"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
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

// TestPubSubDataSource_GetResolveDataSource_WrongType tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSource_GetResolveDataSource_WrongType(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
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

// TestPubSubDataSource_GetResolveDataSourceInput_MultipleTopics tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSource_GetResolveDataSourceInput_MultipleTopics(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
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

// TestPubSubDataSource_GetResolveDataSourceInput_NoTopics tests the PubSubDataSource with a mocked adapter
func TestPubSubDataSource_GetResolveDataSourceInput_NoTopics(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
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

// TestKafkaPubSubDataSourceMultiTopicSubscription tests only the subscription functionality
// for multiple topics. The publish and resolve datasource tests are skipped since they
// do not support multiple topics.
func TestKafkaPubSubDataSourceMultiTopicSubscription(t *testing.T) {
	// Create the data source to test with mock adapter
	pubsub := &PubSubDataSource{
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
