package sqs

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// MockAdapter is a mock implementation of the Adapter interface
type MockAdapter struct {
	mock.Mock
}

func (m *MockAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	args := m.Called(ctx, event, updater)
	return args.Error(0)
}

func (m *MockAdapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *MockAdapter) Startup(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockAdapter) Shutdown(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func TestPublishEventConfiguration_MarshalJSONTemplate(t *testing.T) {
	event := PublishEventConfiguration{
		ProviderID: "test-provider",
		QueueURL:   "test-queue",
		Data:       json.RawMessage(`{"key": "value"}`),
	}

	result := event.MarshalJSONTemplate()
	expected := `{"queueUrl":"test-queue", "data": {"key": "value"}, "providerId":"test-provider"}`

	assert.Equal(t, expected, result)
}

func TestPublishDataSource_Load_Success(t *testing.T) {
	mockAdapter := &MockAdapter{}
	publishDataSource := &PublishDataSource{pubSub: mockAdapter}

	publishConfig := PublishEventConfiguration{
		ProviderID: "test-provider",
		QueueURL:   "test-queue",
		Data:       json.RawMessage(`{"message":"hello"}`),
	}

	input, err := json.Marshal(publishConfig)
	assert.NoError(t, err)

	mockAdapter.On("Publish", mock.Anything, publishConfig).Return(nil)

	var out bytes.Buffer
	err = publishDataSource.Load(context.Background(), input, &out)

	assert.NoError(t, err)
	assert.Equal(t, `{"success": true}`, out.String())
	mockAdapter.AssertExpectations(t)
}

func TestPublishDataSource_Load_Error(t *testing.T) {
	mockAdapter := &MockAdapter{}
	publishDataSource := &PublishDataSource{pubSub: mockAdapter}

	publishConfig := PublishEventConfiguration{
		ProviderID: "test-provider",
		QueueURL:   "test-queue",
		Data:       json.RawMessage(`{"message":"hello"}`),
	}

	input, err := json.Marshal(publishConfig)
	assert.NoError(t, err)

	mockAdapter.On("Publish", mock.Anything, publishConfig).Return(assert.AnError)

	var out bytes.Buffer
	err = publishDataSource.Load(context.Background(), input, &out)

	assert.Error(t, err)
	assert.Equal(t, `{"success": false}`, out.String())
	mockAdapter.AssertExpectations(t)
}

func TestSubscriptionDataSource_Start(t *testing.T) {
	mockAdapter := &MockAdapter{}
	subscriptionDataSource := &SubscriptionDataSource{pubSub: mockAdapter}

	subscriptionConfig := SubscriptionEventConfiguration{
		ProviderID: "test-provider",
		QueueURLs:  []string{"queue1", "queue2"},
	}

	input, err := json.Marshal(subscriptionConfig)
	assert.NoError(t, err)

	mockUpdater := datasource.NewMockSubscriptionUpdater(t)
	mockAdapter.On("Subscribe", mock.Anything, subscriptionConfig, mockUpdater).Return(nil)

	// Create a resolve.Context with a standard context
	goCtx := context.Background()
	resolveCtx := &resolve.Context{}
	resolveCtx = resolveCtx.WithContext(goCtx)

	err = subscriptionDataSource.Start(resolveCtx, input, mockUpdater)

	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}
