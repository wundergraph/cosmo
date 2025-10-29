package datasource

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.uber.org/zap"
)

// Test helper types
type testEvent struct {
	data []byte
}

func (e *testEvent) GetData() []byte {
	return e.data
}

func (e *testEvent) Clone() StreamEvent {
	return &testEvent{
		data: bytes.Clone(e.data),
	}
}

type testSubscriptionConfig struct {
	providerID   string
	providerType ProviderType
	fieldName    string
}

func (c *testSubscriptionConfig) ProviderID() string {
	return c.providerID
}

func (c *testSubscriptionConfig) ProviderType() ProviderType {
	return c.providerType
}

func (c *testSubscriptionConfig) RootFieldName() string {
	return c.fieldName
}

type testPublishConfig struct {
	providerID   string
	providerType ProviderType
	fieldName    string
}

func (c *testPublishConfig) ProviderID() string {
	return c.providerID
}

func (c *testPublishConfig) ProviderType() ProviderType {
	return c.providerType
}

func (c *testPublishConfig) RootFieldName() string {
	return c.fieldName
}

// testPubSubEventBuilder is a reusable event builder for tests
func testPubSubEventBuilder(data []byte) StreamEvent {
	return &testEvent{data: data}
}

func TestProvider_Startup_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	mockAdapter.On("Startup", mock.Anything).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.NoError(t, err)
}

func TestProvider_Startup_Error(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	mockAdapter.On("Startup", mock.Anything).Return(errors.New("connect error"))

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.Error(t, err)
}

func TestProvider_Shutdown_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	mockAdapter.On("Shutdown", mock.Anything).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.NoError(t, err)
}

func TestProvider_Shutdown_Error(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	mockAdapter.On("Shutdown", mock.Anything).Return(errors.New("close error"))

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.Error(t, err)
}

func TestProvider_Subscribe_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	mockUpdater := NewMockSubscriptionEventUpdater(t)
	config := &testSubscriptionConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	mockAdapter.On("Subscribe", mock.Anything, config, mockUpdater).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Subscribe(context.Background(), config, mockUpdater)

	assert.NoError(t, err)
}

func TestProvider_Subscribe_Error(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	mockUpdater := NewMockSubscriptionEventUpdater(t)
	config := &testSubscriptionConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	expectedError := errors.New("subscription error")

	mockAdapter.On("Subscribe", mock.Anything, config, mockUpdater).Return(expectedError)

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Subscribe(context.Background(), config, mockUpdater)

	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
}

func TestProvider_Publish_NoHooks_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data 1")},
		&testEvent{data: []byte("test data 2")},
	}

	mockAdapter.On("Publish", mock.Anything, config, events).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
		hooks:   Hooks{}, // No hooks
	}
	err := provider.Publish(context.Background(), config, events)

	assert.NoError(t, err)
}

func TestProvider_Publish_NoHooks_Error(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}
	expectedError := errors.New("publish error")

	mockAdapter.On("Publish", mock.Anything, config, events).Return(expectedError)

	provider := PubSubProvider{
		Adapter: mockAdapter,
		hooks:   Hooks{}, // No hooks
	}
	err := provider.Publish(context.Background(), config, events)

	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
}

func TestProvider_Publish_WithHooks_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original data")},
	}
	modifiedEvents := []StreamEvent{
		&testEvent{data: []byte("modified data")},
	}

	// Define hook that modifies events
	testHook := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return modifiedEvents, nil
	}

	mockAdapter.On("Publish", mock.Anything, config, modifiedEvents).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
		hooks: Hooks{
			OnPublishEvents: []OnPublishEventsFn{testHook},
		},
		eventBuilder: testPubSubEventBuilder,
	}
	err := provider.Publish(context.Background(), config, originalEvents)

	assert.NoError(t, err)
}

func TestProvider_Publish_WithHooks_HookError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}
	hookError := errors.New("hook processing error")

	// Define hook that returns an error
	testHook := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return nil, hookError
	}

	mockAdapter.On("Publish", mock.Anything, config, []StreamEvent(nil)).Return(nil)

	// Should call Publish on adapter also if hook fails
	provider := PubSubProvider{
		Adapter: mockAdapter,
		hooks: Hooks{
			OnPublishEvents: []OnPublishEventsFn{testHook},
		},
		Logger:       zap.NewNop(),
		eventBuilder: testPubSubEventBuilder,
	}
	err := provider.Publish(context.Background(), config, events)

	assert.Error(t, err)
	assert.Equal(t, hookError, err)
}

func TestProvider_Publish_WithHooks_AdapterError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original data")},
	}
	processedEvents := []StreamEvent{
		&testEvent{data: []byte("processed data")},
	}
	adapterError := errors.New("adapter publish error")

	// Define hook that processes events successfully
	testHook := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return processedEvents, nil
	}

	mockAdapter.On("Publish", mock.Anything, config, processedEvents).Return(adapterError)

	provider := PubSubProvider{
		Adapter: mockAdapter,
		hooks: Hooks{
			OnPublishEvents: []OnPublishEventsFn{testHook},
		},
		eventBuilder: testPubSubEventBuilder,
	}
	err := provider.Publish(context.Background(), config, originalEvents)

	assert.Error(t, err)
	assert.Equal(t, adapterError, err)
}

func TestProvider_Publish_WithMultipleHooks_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}

	// Chain of hooks that modify the data
	hook1 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("modified by hook1")}}, nil
	}
	hook2 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("modified by hook2")}}, nil
	}

	mockAdapter.On("Publish", mock.Anything, config, mock.MatchedBy(func(events []StreamEvent) bool {
		return len(events) == 1 && string(events[0].GetData()) == "modified by hook2"
	})).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
		hooks: Hooks{
			OnPublishEvents: []OnPublishEventsFn{hook1, hook2},
		},
		eventBuilder: testPubSubEventBuilder,
	}
	err := provider.Publish(context.Background(), config, originalEvents)

	assert.NoError(t, err)
}

func TestProvider_SetHooks(t *testing.T) {
	provider := &PubSubProvider{}

	testHook := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return events, nil
	}

	hooks := Hooks{
		OnPublishEvents: []OnPublishEventsFn{testHook},
	}

	provider.SetHooks(hooks)

	assert.Equal(t, hooks, provider.hooks)
}

func TestNewPubSubProvider(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	logger := zap.NewNop()
	id := "test-provider-id"
	typeID := "test-type-id"

	provider := NewPubSubProvider(id, typeID, mockAdapter, logger, testPubSubEventBuilder)

	assert.NotNil(t, provider)
	assert.Equal(t, id, provider.ID())
	assert.Equal(t, typeID, provider.TypeID())
	assert.Equal(t, mockAdapter, provider.Adapter)
	assert.Equal(t, logger, provider.Logger)
	assert.Empty(t, provider.hooks.OnPublishEvents)
}

func TestApplyPublishEventHooks_NoHooks(t *testing.T) {
	ctx := context.Background()
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}

	result, err := applyPublishEventHooks(ctx, config, originalEvents, testPubSubEventBuilder, []OnPublishEventsFn{})

	assert.NoError(t, err)
	assert.Equal(t, originalEvents, result)
}

func TestApplyPublishEventHooks_SingleHook_Success(t *testing.T) {
	ctx := context.Background()
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}
	modifiedEvents := []StreamEvent{
		&testEvent{data: []byte("modified")},
	}

	hook := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return modifiedEvents, nil
	}

	result, err := applyPublishEventHooks(ctx, config, originalEvents, testPubSubEventBuilder, []OnPublishEventsFn{hook})

	assert.NoError(t, err)
	assert.Equal(t, modifiedEvents, result)
}

func TestApplyPublishEventHooks_SingleHook_Error(t *testing.T) {
	ctx := context.Background()
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}
	hookError := errors.New("hook processing failed")

	hook := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return nil, hookError
	}

	result, err := applyPublishEventHooks(ctx, config, originalEvents, testPubSubEventBuilder, []OnPublishEventsFn{hook})

	assert.Error(t, err)
	assert.Equal(t, hookError, err)
	assert.Nil(t, result)
}

func TestApplyPublishEventHooks_MultipleHooks_Success(t *testing.T) {
	ctx := context.Background()
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}

	hook1 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("step1")}}, nil
	}
	hook2 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("step2")}}, nil
	}
	hook3 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("final")}}, nil
	}

	result, err := applyPublishEventHooks(ctx, config, originalEvents, testPubSubEventBuilder, []OnPublishEventsFn{hook1, hook2, hook3})

	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "final", string(result[0].GetData()))
}

func TestApplyPublishEventHooks_MultipleHooks_MiddleHookError(t *testing.T) {
	ctx := context.Background()
	config := &testPublishConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeKafka,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}
	middleHookError := errors.New("middle hook failed")

	hook1 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("step1")}}, nil
	}
	hook2 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return nil, middleHookError
	}
	hook3 := func(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{data: []byte("final")}}, nil
	}

	result, err := applyPublishEventHooks(ctx, config, originalEvents, testPubSubEventBuilder, []OnPublishEventsFn{hook1, hook2, hook3})

	assert.Error(t, err)
	assert.Equal(t, middleHookError, err)
	assert.Nil(t, result)
}
