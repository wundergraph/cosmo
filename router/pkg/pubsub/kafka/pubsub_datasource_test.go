package kafka

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// MockAdapter mocks the required functionality from the Adapter for testing
type MockAdapter struct {
	mock.Mock
}

// Ensure MockAdapter implements KafkaAdapterInterface
var _ AdapterInterface = (*MockAdapter)(nil)

func (m *MockAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	args := m.Called(ctx, event, updater)
	return args.Error(0)
}

func (m *MockAdapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func TestKafkaPubSubDataSource(t *testing.T) {
	// Create event configuration with required fields
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	kafkaCfg := &nodev1.KafkaEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Topics:                   []string{"test-topic"},
	}

	// Create the data source to test with a real adapter
	adapter := &Adapter{}
	pubsub := &PubSubDataSource{
		EventConfiguration: kafkaCfg,
		KafkaAdapter:       adapter,
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

	kafkaCfg := &nodev1.KafkaEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Topics:                   []string{"test-topic"},
	}

	// Create mock adapter
	mockAdapter := new(MockAdapter)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Topic == "test-topic"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: kafkaCfg,
		KafkaAdapter:       mockAdapter,
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

// TestKafkaPubSubDataSourceMultiTopicSubscription tests only the subscription functionality
// for multiple topics. The publish and resolve datasource tests are skipped since they
// do not support multiple topics.
func TestKafkaPubSubDataSourceMultiTopicSubscription(t *testing.T) {
	// Create event configuration with multiple topics
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH, // Must be PUBLISH as it's the only supported type
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	kafkaCfg := &nodev1.KafkaEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Topics:                   []string{"test-topic-1", "test-topic-2"},
	}

	// Create mock adapter
	mockAdapter := new(MockAdapter)

	// Set up expectations for subscribe with both topics
	mockAdapter.On("Subscribe", mock.Anything, mock.MatchedBy(func(event SubscriptionEventConfiguration) bool {
		return event.ProviderID == "test-provider" &&
			len(event.Topics) == 2 &&
			event.Topics[0] == "test-topic-1" &&
			event.Topics[1] == "test-topic-2"
	}), mock.Anything).Return(nil)

	// Create the data source to test with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: kafkaCfg,
		KafkaAdapter:       mockAdapter,
	}

	// Test GetEngineEventConfiguration
	testConfig := pubsub.GetEngineEventConfiguration()
	require.NotNil(t, testConfig, "Expected non-nil EngineEventConfiguration")

	// Test GetResolveDataSourceSubscription
	subscription, err := pubsub.GetResolveDataSourceSubscription()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscription")
	require.NotNil(t, subscription, "Expected non-nil SubscriptionDataSource")

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubsub.GetResolveDataSourceSubscriptionInput()
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

// bytesBuffer is a helper that implements io.Writer to capture output
type bytesBuffer []byte

func (b *bytesBuffer) Write(p []byte) (n int, err error) {
	*b = append(*b, p...)
	return len(p), nil
}
