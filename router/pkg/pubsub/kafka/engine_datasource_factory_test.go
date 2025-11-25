package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/pubsubtest"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
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
	mockAdapter := datasource.NewMockProvider(t)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event *PublishEventConfiguration) bool {
		return event.ProviderID() == "test-provider" && event.Topic == "test-topic"
	}), mock.MatchedBy(func(events []datasource.StreamEvent) bool {
		return len(events) == 1 && strings.EqualFold(string(events[0].GetData()), `{"test":"data"}`)
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
	data, err := ds.Load(context.Background(), nil, []byte(input))
	require.NoError(t, err)
	require.Equal(t, `{"success": true}`, string(data))
}

// TestEngineDataSourceFactory_GetResolveDataSource_WrongType tests the EngineDataSourceFactory with a mocked adapter
func TestEngineDataSourceFactory_GetResolveDataSource_WrongType(t *testing.T) {
	// Create mock adapter
	mockAdapter := datasource.NewMockProvider(t)

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

func TestKafkaEngineDataSourceFactory_UniqueRequestID(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectError   bool
		expectedError error
	}{
		{
			name:        "valid input",
			input:       `{"topics":["topic1", "topic2"], "providerId":"test-provider"}`,
			expectError: false,
		},
		{
			name:          "missing topics",
			input:         `{"providerId":"test-provider"}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
		{
			name:          "missing providerId",
			input:         `{"topics":["topic1", "topic2"]}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			factory := &EngineDataSourceFactory{
				KafkaAdapter: datasource.NewMockProvider(t),
			}
			source, err := factory.ResolveDataSourceSubscription()
			require.NoError(t, err)
			ctx := &resolve.Context{}
			input := []byte(tt.input)
			xxh := xxhash.New()

			err = source.UniqueRequestID(ctx, input, xxh)

			if tt.expectError {
				require.Error(t, err)
				if tt.expectedError != nil {
					// For jsonparser errors, just check if the error message contains the expected text
					assert.Contains(t, err.Error(), tt.expectedError.Error())
				}
			} else {
				require.NoError(t, err)
				// Check that the hash has been updated
				assert.NotEqual(t, 0, xxh.Sum64())
			}
		})
	}
}
