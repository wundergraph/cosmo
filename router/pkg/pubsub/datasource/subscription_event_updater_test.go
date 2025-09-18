package datasource

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

// Test helper type for subscription event configuration
type testSubscriptionEventConfig struct {
	providerID   string
	providerType ProviderType
	fieldName    string
}

func (c *testSubscriptionEventConfig) ProviderID() string {
	return c.providerID
}

func (c *testSubscriptionEventConfig) ProviderType() ProviderType {
	return c.providerType
}

func (c *testSubscriptionEventConfig) RootFieldName() string {
	return c.fieldName
}

type receivedHooksArgs struct {
	events []StreamEvent
	cfg    SubscriptionEventConfiguration
}

func TestSubscriptionEventUpdater_Update_NoHooks(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data 1")},
		&testEvent{data: []byte("test data 2")},
	}

	// Expect calls to Update for each event
	mockUpdater.On("Update", []byte("test data 1")).Return()
	mockUpdater.On("Update", []byte("test data 2")).Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{}, // No hooks
	}

	err := updater.Update(events)

	assert.NoError(t, err)
}

func TestSubscriptionEventUpdater_Update_WithHooks_Success(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original data")},
	}
	modifiedEvents := []StreamEvent{
		&testEvent{data: []byte("modified data")},
	}

	// Create wrapper function for the mock
	receivedArgs := make(chan receivedHooksArgs, 1)
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs <- receivedHooksArgs{events: events, cfg: cfg}
		return modifiedEvents, nil
	}

	// Expect call to Update with modified data
	mockUpdater.On("Update", []byte("modified data")).Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{testHook},
		},
	}

	err := updater.Update(originalEvents)

	select {
	case receivedArgs := <-receivedArgs:
		assert.Equal(t, originalEvents, receivedArgs.events)
		assert.Equal(t, config, receivedArgs.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	assert.NoError(t, err)
}

func TestSubscriptionEventUpdater_Update_WithHooks_Error(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}
	hookError := errors.New("hook processing error")

	// Define hook that returns an error
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return nil, hookError
	}

	// Should not call Update on eventUpdater since hook fails
	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{testHook},
		},
	}

	err := updater.Update(events)

	// With the new behavior, errors are logged and nil is returned
	assert.NoError(t, err)
	// Assert that Update was not called on the eventUpdater
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithMultipleHooks_Success(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}

	// Chain of hooks that modify the data
	receivedArgs1 := make(chan receivedHooksArgs, 1)
	hook1 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs1 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("modified by hook1")}}, nil
	}

	receivedArgs2 := make(chan receivedHooksArgs, 1)
	hook2 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs2 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("modified by hook2")}}, nil
	}

	// Expect call to Update with data modified by hook2 (last hook)
	mockUpdater.On("Update", []byte("modified by hook2")).Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{hook1, hook2},
		},
	}

	err := updater.Update(originalEvents)

	select {
	case receivedArgs1 := <-receivedArgs1:
		assert.Equal(t, originalEvents, receivedArgs1.events)
		assert.Equal(t, config, receivedArgs1.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	select {
	case receivedArgs2 := <-receivedArgs2:
		assert.Equal(t, []StreamEvent{&testEvent{data: []byte("modified by hook1")}}, receivedArgs2.events)
		assert.Equal(t, config, receivedArgs2.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	assert.NoError(t, err)
}

func TestSubscriptionEventUpdater_Complete(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	mockUpdater.On("Complete").Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{},
	}

	updater.Complete()
}

func TestSubscriptionEventUpdater_Close(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	closeKind := resolve.SubscriptionCloseKindNormal

	mockUpdater.On("Close", closeKind).Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{},
	}

	updater.Close(closeKind)
}

func TestSubscriptionEventUpdater_SetHooks(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return events, nil
	}

	hooks := Hooks{
		OnReceiveEvents: []OnReceiveEventsFn{testHook},
	}

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{},
	}

	updater.SetHooks(hooks)

	assert.Equal(t, hooks, updater.hooks)
}

func TestNewSubscriptionEventUpdater(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return events, nil
	}

	hooks := Hooks{
		OnReceiveEvents: []OnReceiveEventsFn{testHook},
	}

	updater := NewSubscriptionEventUpdater(ctx, config, hooks, mockUpdater, zap.NewNop())

	assert.NotNil(t, updater)

	// Type assertion to access private fields for testing
	var concreteUpdater *subscriptionEventUpdater
	assert.IsType(t, concreteUpdater, updater)
	concreteUpdater = updater.(*subscriptionEventUpdater)
	assert.Equal(t, ctx, concreteUpdater.ctx)
	assert.Equal(t, config, concreteUpdater.subscriptionEventConfiguration)
	assert.Equal(t, hooks, concreteUpdater.hooks)
	assert.Equal(t, mockUpdater, concreteUpdater.eventUpdater)
}

func TestApplyStreamEventHooks_NoHooks(t *testing.T) {
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}

	result, err := applyStreamEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{})

	assert.NoError(t, err)
	assert.Equal(t, originalEvents, result)
}

func TestApplyStreamEventHooks_SingleHook_Success(t *testing.T) {
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}
	modifiedEvents := []StreamEvent{
		&testEvent{data: []byte("modified")},
	}

	hook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return modifiedEvents, nil
	}

	result, err := applyStreamEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook})

	assert.NoError(t, err)
	assert.Equal(t, modifiedEvents, result)
}

func TestApplyStreamEventHooks_SingleHook_Error(t *testing.T) {
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}
	hookError := errors.New("hook processing failed")

	hook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return nil, hookError
	}

	result, err := applyStreamEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook})

	assert.Error(t, err)
	assert.Equal(t, hookError, err)
	assert.Nil(t, result)
}

func TestApplyStreamEventHooks_MultipleHooks_Success(t *testing.T) {
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}

	receivedArgs1 := make(chan receivedHooksArgs, 1)
	hook1 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs1 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("step1")}}, nil
	}
	receivedArgs2 := make(chan receivedHooksArgs, 1)
	hook2 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs2 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("step2")}}, nil
	}
	receivedArgs3 := make(chan receivedHooksArgs, 1)
	hook3 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs3 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("final")}}, nil
	}

	result, err := applyStreamEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook1, hook2, hook3})

	select {
	case receivedArgs1 := <-receivedArgs1:
		assert.Equal(t, originalEvents, receivedArgs1.events)
		assert.Equal(t, config, receivedArgs1.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	select {
	case receivedArgs2 := <-receivedArgs2:
		assert.Equal(t, []StreamEvent{&testEvent{data: []byte("step1")}}, receivedArgs2.events)
		assert.Equal(t, config, receivedArgs2.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	select {
	case receivedArgs3 := <-receivedArgs3:
		assert.Equal(t, []StreamEvent{&testEvent{data: []byte("step2")}}, receivedArgs3.events)
		assert.Equal(t, config, receivedArgs3.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "final", string(result[0].GetData()))
}

func TestApplyStreamEventHooks_MultipleHooks_MiddleHookError(t *testing.T) {
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("original")},
	}
	middleHookError := errors.New("middle hook failed")

	receivedArgs1 := make(chan receivedHooksArgs, 1)
	hook1 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs1 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("step1")}}, nil
	}
	receivedArgs2 := make(chan receivedHooksArgs, 1)
	hook2 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs2 <- receivedHooksArgs{events: events, cfg: cfg}
		return nil, middleHookError
	}
	receivedArgs3 := make(chan receivedHooksArgs, 1)
	hook3 := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs3 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{data: []byte("final")}}, nil
	}

	result, err := applyStreamEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook1, hook2, hook3})

	assert.Error(t, err)
	assert.Equal(t, middleHookError, err)
	assert.Nil(t, result)

	select {
	case receivedArgs1 := <-receivedArgs1:
		assert.Equal(t, originalEvents, receivedArgs1.events)
		assert.Equal(t, config, receivedArgs1.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	select {
	case receivedArgs2 := <-receivedArgs2:
		assert.Equal(t, []StreamEvent{&testEvent{data: []byte("step1")}}, receivedArgs2.events)
		assert.Equal(t, config, receivedArgs2.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	assert.Empty(t, receivedArgs3)
}

// Test the updateEvents method indirectly through Update method
func TestSubscriptionEventUpdater_UpdateEvents_EmptyEvents(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{} // Empty events

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{}, // No hooks
	}

	err := updater.Update(events)

	assert.NoError(t, err)
	// No calls to Update should be made for empty events
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Close_WithDifferentCloseKinds(t *testing.T) {
	testCases := []struct {
		name      string
		closeKind resolve.SubscriptionCloseKind
	}{
		{"Normal", resolve.SubscriptionCloseKindNormal},
		{"DownstreamServiceError", resolve.SubscriptionCloseKindDownstreamServiceError},
		{"GoingAway", resolve.SubscriptionCloseKindGoingAway},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockUpdater := NewMockSubscriptionUpdater(t)
			ctx := context.Background()
			config := &testSubscriptionEventConfig{
				providerID:   "test-provider",
				providerType: ProviderTypeNats,
				fieldName:    "testField",
			}

			mockUpdater.On("Close", tc.closeKind).Return()

			updater := &subscriptionEventUpdater{
				eventUpdater:                   mockUpdater,
				ctx:                            ctx,
				subscriptionEventConfiguration: config,
				hooks:                          Hooks{},
			}

			updater.Close(tc.closeKind)
		})
	}
}

func TestSubscriptionEventUpdater_Update_WithStreamHookError_CloseSubscription(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}

	// Create a mock StreamHookError with CloseSubscription=true
	mockHookError := &mockStreamHookError{
		closeSubscription: true,
		message:           "subscription should close",
	}

	// Define hook that returns a StreamHookError with CloseSubscription=true
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return events, mockHookError
	}

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{testHook},
		},
	}

	mockUpdater.On("Update", []byte("test data")).Return()
	err := updater.Update(events)

	// Should return the error when CloseSubscription is true
	assert.Error(t, err)
	assert.Equal(t, mockHookError, err)
}

func TestSubscriptionEventUpdater_Update_WithStreamHookError_NoCloseSubscription(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}

	// Create a mock StreamHookError with CloseSubscription=false
	mockHookError := &mockStreamHookError{
		closeSubscription: false,
		message:           "subscription should not close",
	}

	// Define hook that returns a StreamHookError with CloseSubscription=false
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return events, mockHookError
	}

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		ctx:                            ctx,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{testHook},
		},
	}

	mockUpdater.On("Update", []byte("test data")).Return()
	err := updater.Update(events)

	// Should return nil when CloseSubscription is false (error is logged)
	assert.NoError(t, err)
	// Assert that Update was not called on the eventUpdater
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithHooks_Error_LoggerWritesError(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}
	hookError := errors.New("hook processing error")

	// Define hook that returns an error
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
		return nil, hookError
	}

	zCore, logObserver := observer.New(zap.InfoLevel)
	logger := zap.New(zCore)

	// Test with a real zap logger to verify error logging behavior
	// The logger.Error() call should be executed when an error occurs
	updater := NewSubscriptionEventUpdater(ctx, config, Hooks{
		OnReceiveEvents: []OnReceiveEventsFn{testHook},
	}, mockUpdater, logger)

	err := updater.Update(events)

	// Should return nil when error is logged
	assert.NoError(t, err)
	// Assert that Update was not called on the eventUpdater
	mockUpdater.AssertNotCalled(t, "Update")

	msgs := logObserver.FilterMessageSnippet("An error occurred while processing stream events hooks").TakeAll()
	assert.Equal(t, 1, len(msgs))
}

// mockStreamHookError implements the CloseSubscription() method for testing
type mockStreamHookError struct {
	closeSubscription bool
	message           string
}

func (e *mockStreamHookError) Error() string {
	return e.message
}

func (e *mockStreamHookError) CloseSubscription() bool {
	return e.closeSubscription
}
