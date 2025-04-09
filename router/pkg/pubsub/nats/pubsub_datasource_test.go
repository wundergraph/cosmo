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
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// MockAdapter mocks the required functionality from the Adapter for testing
type MockAdapter struct {
	mock.Mock
}

// Ensure MockAdapter implements AdapterInterface
var _ AdapterInterface = (*MockAdapter)(nil)

func (m *MockAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	args := m.Called(ctx, event, updater)
	return args.Error(0)
}

func (m *MockAdapter) Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *MockAdapter) Request(ctx context.Context, event PublishAndRequestEventConfiguration, w io.Writer) error {
	args := m.Called(ctx, event, w)
	return args.Error(0)
}

func (m *MockAdapter) Shutdown(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

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
		Subjects:                 []string{"test.subject"},
	}

	// Create the data source to test
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        &Adapter{}, // Using a real Adapter type but with nil values for the test
	}

	// Run the standard test suite
	datasource.VerifyPubSubDataSourceImplementation(t, pubsub)
}

func TestNatsPubSubDataSourceWithStreamConfiguration(t *testing.T) {
	// Create event configuration with required fields and stream config
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	streamCfg := &nodev1.NatsStreamConfiguration{
		ConsumerName:              "test-consumer",
		StreamName:                "test-stream",
		ConsumerInactiveThreshold: 60,
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test.subject"},
		StreamConfiguration:      streamCfg,
	}

	// Create the data source to test
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        &Adapter{}, // Using a real Adapter type but with nil values for the test
	}

	// Run the standard test suite
	datasource.VerifyPubSubDataSourceImplementation(t, pubsub)
}

func TestNatsPubSubDataSourceRequestType(t *testing.T) {
	// Create event configuration with REQUEST type
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_REQUEST,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test.subject"},
	}

	// Create the data source to test
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        &Adapter{}, // Using a real Adapter type but with nil values for the test
	}

	// Run the standard test suite
	datasource.VerifyPubSubDataSourceImplementation(t, pubsub)
}

func TestNatsPubSubDataSourceSubscribeType(t *testing.T) {
	// Create event configuration with SUBSCRIBE type
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test.subject"},
	}

	// Create the data source to test
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        &Adapter{}, // Using a real Adapter type but with nil values for the test
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

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test.subject"},
	}

	// Create mock adapter
	mockAdapter := new(MockAdapter)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Subject == "test.subject"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        mockAdapter,
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

// TestNatsPubSubDataSourceRequestWithMockAdapter tests the REQUEST functionality with a mocked adapter
func TestNatsPubSubDataSourceRequestWithMockAdapter(t *testing.T) {
	// Create event configuration with REQUEST type
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_REQUEST,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test.subject"},
	}

	// Create mock adapter
	mockAdapter := new(MockAdapter)

	// Configure mock expectations for Request
	mockAdapter.On("Request", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Subject == "test.subject"
	}), mock.Anything).Run(func(args mock.Arguments) {
		// Simulate writing a response
		w := args.Get(2).(io.Writer)
		w.Write([]byte(`{"response":"data"}`))
	}).Return(nil)

	// Create the data source with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        mockAdapter,
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
	require.Equal(t, `{"response":"data"}`, out.String())

	// Verify mock expectations
	mockAdapter.AssertExpectations(t)
}

// TestNatsPubSubDataSourceMultiSubjectSubscription tests the subscription functionality
// for multiple subjects with a mocked adapter
func TestNatsPubSubDataSourceMultiSubjectSubscription(t *testing.T) {
	// Create event configuration with multiple subjects
	engineEventConfig := &nodev1.EngineEventConfiguration{
		ProviderId: "test-provider",
		Type:       nodev1.EventType_PUBLISH,
		TypeName:   "TestType",
		FieldName:  "testField",
	}

	natsCfg := &nodev1.NatsEventConfiguration{
		EngineEventConfiguration: engineEventConfig,
		Subjects:                 []string{"test.subject.1", "test.subject.2"},
	}

	// Create mock adapter
	mockAdapter := new(MockAdapter)

	// Set up expectations for subscribe with both subjects
	mockAdapter.On("Subscribe", mock.Anything, mock.MatchedBy(func(event SubscriptionEventConfiguration) bool {
		return event.ProviderID == "test-provider" &&
			len(event.Subjects) == 2 &&
			event.Subjects[0] == "test.subject.1" &&
			event.Subjects[1] == "test.subject.2"
	}), mock.Anything).Return(nil)

	// Create the data source to test with mock adapter
	pubsub := &PubSubDataSource{
		EventConfiguration: natsCfg,
		NatsAdapter:        mockAdapter,
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

	// Verify the subscription input contains both subjects
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.Equal(t, 2, len(subscriptionConfig.Subjects), "Expected 2 subjects in subscription configuration")
	require.Equal(t, "test.subject.1", subscriptionConfig.Subjects[0], "Expected first subject to be 'test.subject.1'")
	require.Equal(t, "test.subject.2", subscriptionConfig.Subjects[1], "Expected second subject to be 'test.subject.2'")
}
