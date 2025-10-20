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
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{}, // No hooks
	}

	updater.Update(events)
}

func TestSubscriptionEventUpdater_UpdateSubscription_WithHooks_Success(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
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

	// Expect call to UpdateSubscription with modified data
	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("UpdateSubscription", subId, []byte("modified data")).Return()
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{testHook},
		},
	}

	updater.Update(originalEvents)

	select {
	case receivedArgs := <-receivedArgs:
		assert.Equal(t, originalEvents, receivedArgs.events)
		assert.Equal(t, config, receivedArgs.cfg)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for events")
	}
}

func TestSubscriptionEventUpdater_UpdateSubscriptions_WithHooks_Error(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
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

	// Expect call to UpdateSubscription with modified data
	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})
	mockUpdater.On("CloseSubscription", resolve.SubscriptionCloseKindNormal, subId).Return()

	// Should not call Update or UpdateSubscription on eventUpdater since hook fails
	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{testHook},
		},
	}

	updater.Update(events)

	// Assert that Update and UpdateSubscription were not called on the eventUpdater
	mockUpdater.AssertNotCalled(t, "Update")
	mockUpdater.AssertNotCalled(t, "UpdateSubscription")
	mockUpdater.AssertCalled(t, "CloseSubscription", resolve.SubscriptionCloseKindNormal, subId)
}

func TestSubscriptionEventUpdater_Update_WithMultipleHooks_Success(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
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

	// Expect call to UpdateSubscription with modified data
	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("UpdateSubscription", subId, []byte("modified by hook2")).Return()
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		subscriptionEventConfiguration: config,
		hooks: Hooks{
			OnReceiveEvents: []OnReceiveEventsFn{hook1, hook2},
		},
	}

	updater.Update(originalEvents)

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
}

func TestSubscriptionEventUpdater_Complete(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	mockUpdater.On("Complete").Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{},
	}

	updater.Complete()
}

func TestSubscriptionEventUpdater_Close(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	closeKind := resolve.SubscriptionCloseKindNormal

	mockUpdater.On("Close", closeKind).Return()

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{},
	}

	updater.Close(closeKind)
}

func TestSubscriptionEventUpdater_SetHooks(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
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
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{},
	}

	updater.SetHooks(hooks)

	assert.Equal(t, hooks, updater.hooks)
}

func TestNewSubscriptionEventUpdater(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
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

	updater := NewSubscriptionEventUpdater(config, hooks, mockUpdater, zap.NewNop())

	assert.NotNil(t, updater)

	// Type assertion to access private fields for testing
	var concreteUpdater *subscriptionEventUpdater
	assert.IsType(t, concreteUpdater, updater)
	concreteUpdater = updater.(*subscriptionEventUpdater)
	assert.Equal(t, config, concreteUpdater.subscriptionEventConfiguration)
	assert.Equal(t, hooks, concreteUpdater.hooks)
	assert.Equal(t, mockUpdater, concreteUpdater.eventUpdater)
}

func TestApplyReceiveEventHooks_NoHooks(t *testing.T) {
	ctx := context.Background()
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{data: []byte("test data")},
	}

	result, err := applyReceiveEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{})

	assert.NoError(t, err)
	assert.Equal(t, originalEvents, result)
}

func TestApplyReceiveEventHooks_SingleHook_Success(t *testing.T) {
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

	result, err := applyReceiveEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook})

	assert.NoError(t, err)
	assert.Equal(t, modifiedEvents, result)
}

func TestApplyReceiveEventHooks_SingleHook_Error(t *testing.T) {
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

	result, err := applyReceiveEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook})

	assert.Error(t, err)
	assert.Equal(t, hookError, err)
	assert.Nil(t, result)
}

func TestApplyReceiveEventHooks_MultipleHooks_Success(t *testing.T) {
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

	result, err := applyReceiveEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook1, hook2, hook3})

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

func TestApplyReceiveEventHooks_MultipleHooks_MiddleHookError(t *testing.T) {
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

	result, err := applyReceiveEventHooks(ctx, config, originalEvents, []OnReceiveEventsFn{hook1, hook2, hook3})

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
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{} // Empty events

	updater := &subscriptionEventUpdater{
		eventUpdater:                   mockUpdater,
		subscriptionEventConfiguration: config,
		hooks:                          Hooks{}, // No hooks
	}

	updater.Update(events)

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
			config := &testSubscriptionEventConfig{
				providerID:   "test-provider",
				providerType: ProviderTypeNats,
				fieldName:    "testField",
			}

			mockUpdater.On("Close", tc.closeKind).Return()

			updater := &subscriptionEventUpdater{
				eventUpdater:                   mockUpdater,
				subscriptionEventConfiguration: config,
				hooks:                          Hooks{},
			}

			updater.Close(tc.closeKind)
		})
	}
}

func TestSubscriptionEventUpdater_UpdateSubscription_WithHookError_ClosesSubscription(t *testing.T) {
	testCases := []struct {
		name      string
		hookError error
	}{
		{
			name:      "generic error",
			hookError: errors.New("subscription should close"),
		},
		{
			name:      "error implementing CloseSubscription false",
			hookError: errors.New("subscription should still close"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockUpdater := NewMockSubscriptionUpdater(t)
			config := &testSubscriptionEventConfig{
				providerID:   "test-provider",
				providerType: ProviderTypeNats,
				fieldName:    "testField",
			}
			events := []StreamEvent{
				&testEvent{data: []byte("test data")},
			}

			testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent) ([]StreamEvent, error) {
				return events, tc.hookError
			}

			updater := &subscriptionEventUpdater{
				eventUpdater:                   mockUpdater,
				subscriptionEventConfiguration: config,
				hooks: Hooks{
					OnReceiveEvents: []OnReceiveEventsFn{testHook},
				},
			}

			subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
			mockUpdater.On("UpdateSubscription", subId, []byte("test data")).Return()
			mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
				context.Background(): subId,
			})
			mockUpdater.On("CloseSubscription", resolve.SubscriptionCloseKindNormal, subId).Return()

			updater.Update(events)

			mockUpdater.AssertCalled(t, "CloseSubscription", resolve.SubscriptionCloseKindNormal, subId)
		})
	}
}

func TestSubscriptionEventUpdater_UpdateSubscription_WithHooks_Error_LoggerWritesError(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
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
	updater := NewSubscriptionEventUpdater(config, Hooks{
		OnReceiveEvents: []OnReceiveEventsFn{testHook},
	}, mockUpdater, logger)

	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})
	mockUpdater.On("CloseSubscription", resolve.SubscriptionCloseKindNormal, subId).Return()

	updater.Update(events)

	// Assert that Update was not called on the eventUpdater
	mockUpdater.AssertNotCalled(t, "UpdateSubscription")
	mockUpdater.AssertCalled(t, "CloseSubscription", resolve.SubscriptionCloseKindNormal, subId)

	// log error messages for hooks are written async, we need to wait for them to be written
	time.Sleep(10 * time.Millisecond)

	msgs := logObserver.FilterMessageSnippet("some handlers have thrown an error").TakeAll()
	assert.Equal(t, 1, len(msgs))
}
