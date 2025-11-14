package datasource

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// testEventBuilder is a reusable event builder for tests
func testEventBuilder(data []byte) MutableStreamEvent {
	return mutableTestEvent(data)
}

func TestSubscriptionEventUpdater_Update_NoHooks(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{mutableTestEvent("test data 1")},
		&testEvent{mutableTestEvent("test data 2")},
	}

	// Expect calls to Update for each event
	mockUpdater.On("Update", []byte("test data 1")).Return()
	mockUpdater.On("Update", []byte("test data 2")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{}, // No hooks
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

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
		&testEvent{mutableTestEvent("original data")},
	}
	modifiedEvents := []StreamEvent{
		&testEvent{mutableTestEvent("modified data")},
		nil, // this should simply be ignored
	}

	// Create wrapper function for the mock
	receivedArgs := make(chan receivedHooksArgs, 1)
	testHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs <- receivedHooksArgs{events: events, cfg: cfg}
		return modifiedEvents, nil
	}

	// Expect call to UpdateSubscription with modified data
	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("UpdateSubscription", subId, []byte("modified data")).Return()
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{testHook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

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
		&testEvent{mutableTestEvent("test data")},
	}
	hookError := errors.New("hook processing error")

	// Define hook that returns an error
	testHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return nil, hookError
	}

	// Expect call to UpdateSubscription with modified data
	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})
	mockUpdater.On("CloseSubscription", resolve.SubscriptionCloseKindNormal, subId).Return()

	// Should not call Update or UpdateSubscription on eventUpdater since hook fails
	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{testHook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

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
		&testEvent{mutableTestEvent("original")},
	}

	// Chain of hooks that modify the data
	receivedArgs1 := make(chan receivedHooksArgs, 1)
	hook1 := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs1 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{mutableTestEvent("modified by hook1")}}, nil
	}

	receivedArgs2 := make(chan receivedHooksArgs, 1)
	hook2 := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs2 <- receivedHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{mutableTestEvent("modified by hook2")}}, nil
	}

	// Expect call to UpdateSubscription with modified data
	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("UpdateSubscription", subId, []byte("modified by hook2")).Return()
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{hook1, hook2},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

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
		assert.Equal(t, []StreamEvent{&testEvent{mutableTestEvent("modified by hook1")}}, receivedArgs2.events)
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

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

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

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Close(closeKind)
}

func TestSubscriptionEventUpdater_SetHooks(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	testHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return events, nil
	}

	hooks := Hooks{
		OnReceiveEvents: OnReceiveEventsHooks{
			Handlers: []OnReceiveEventsFn{testHook},
		},
	}

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.SetHooks(hooks)

	// Type assert to access internal fields for testing
	concreteUpdater, ok := updater.(*subscriptionEventUpdater)
	require.True(t, ok)
	assert.Equal(t, hooks, concreteUpdater.hooks)
}

func TestNewSubscriptionEventUpdater(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	testHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return events, nil
	}

	hooks := Hooks{
		OnReceiveEvents: OnReceiveEventsHooks{
			Handlers: []OnReceiveEventsFn{testHook},
		},
	}

	updater := NewSubscriptionEventUpdater(config, hooks, mockUpdater, zap.NewNop(), testEventBuilder)

	assert.NotNil(t, updater)

	// Type assertion to access private fields for testing
	var concreteUpdater *subscriptionEventUpdater
	assert.IsType(t, concreteUpdater, updater)
	concreteUpdater = updater.(*subscriptionEventUpdater)
	assert.Equal(t, config, concreteUpdater.subscriptionEventConfiguration)
	assert.Equal(t, hooks, concreteUpdater.hooks)
	assert.Equal(t, mockUpdater, concreteUpdater.eventUpdater)
}

func TestSubscriptionEventUpdater_Update_PassthroughWithNoHooks(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{mutableTestEvent("event data 1")},
		&testEvent{mutableTestEvent("event data 2")},
		&testEvent{mutableTestEvent("event data 3")},
	}

	// With no hooks, Update should call the underlying eventUpdater.Update for each event
	mockUpdater.On("Update", []byte("event data 1")).Return()
	mockUpdater.On("Update", []byte("event data 2")).Return()
	mockUpdater.On("Update", []byte("event data 3")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{}, // No hooks
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(events)

	// Verify all events were passed through without modification
	mockUpdater.AssertCalled(t, "Update", []byte("event data 1"))
	mockUpdater.AssertCalled(t, "Update", []byte("event data 2"))
	mockUpdater.AssertCalled(t, "Update", []byte("event data 3"))
	mockUpdater.AssertNumberOfCalls(t, "Update", 3)
}

func TestSubscriptionEventUpdater_Update_WithSingleHookModification(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{mutableTestEvent("original data 1")},
		&testEvent{mutableTestEvent("original data 2")},
	}

	// Hook that modifies events by adding a prefix
	hook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "modified: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})

	// With hooks, UpdateSubscription should be called with modified data
	mockUpdater.On("UpdateSubscription", subId, []byte("modified: original data 1")).Return()
	mockUpdater.On("UpdateSubscription", subId, []byte("modified: original data 2")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{hook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(originalEvents)

	// Verify modified events were sent to UpdateSubscription, not the original events
	mockUpdater.AssertCalled(t, "UpdateSubscription", subId, []byte("modified: original data 1"))
	mockUpdater.AssertCalled(t, "UpdateSubscription", subId, []byte("modified: original data 2"))
	mockUpdater.AssertNumberOfCalls(t, "UpdateSubscription", 2)
	// Update should NOT be called when hooks are present
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithSingleHookError_ClosesSubscription(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{mutableTestEvent("test data")},
	}
	hookError := errors.New("hook processing failed")

	// Hook that returns an error
	hook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		// Return the events but also return an error
		return events, hookError
	}

	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})
	// Events are still sent even when hook returns error
	mockUpdater.On("UpdateSubscription", subId, []byte("test data")).Return()
	// Subscription should be closed due to the error
	mockUpdater.On("CloseSubscription", resolve.SubscriptionCloseKindNormal, subId).Return()

	updater := NewSubscriptionEventUpdater(config, Hooks{
		OnReceiveEvents: OnReceiveEventsHooks{
			Handlers: []OnReceiveEventsFn{hook},
		},
	}, mockUpdater, zap.NewNop(), testEventBuilder)

	updater.Update(events)

	// Verify events were still sent despite the error
	mockUpdater.AssertCalled(t, "UpdateSubscription", subId, []byte("test data"))
	// Verify subscription was closed due to the error
	mockUpdater.AssertCalled(t, "CloseSubscription", resolve.SubscriptionCloseKindNormal, subId)
	// Update should NOT be called when hooks are present
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithMultipleHooksChaining(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{mutableTestEvent("original")},
	}

	// Track what each hook receives and when it's called
	hookCallOrder := make([]int, 0, 3)
	var mu sync.Mutex

	// Hook 1: Adds "step1: " prefix
	receivedArgs1 := make(chan receivedHooksArgs, 1)
	hook1 := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		mu.Lock()
		hookCallOrder = append(hookCallOrder, 1)
		mu.Unlock()
		receivedArgs1 <- receivedHooksArgs{events: events, cfg: cfg}
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "step1: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	// Hook 2: Adds "step2: " prefix
	receivedArgs2 := make(chan receivedHooksArgs, 1)
	hook2 := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		mu.Lock()
		hookCallOrder = append(hookCallOrder, 2)
		mu.Unlock()
		receivedArgs2 <- receivedHooksArgs{events: events, cfg: cfg}
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "step2: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	// Hook 3: Adds "step3: " prefix
	receivedArgs3 := make(chan receivedHooksArgs, 1)
	hook3 := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		mu.Lock()
		hookCallOrder = append(hookCallOrder, 3)
		mu.Unlock()
		receivedArgs3 <- receivedHooksArgs{events: events, cfg: cfg}
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "step3: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})
	// Final modified data should have all three transformations applied
	mockUpdater.On("UpdateSubscription", subId, []byte("step3: step2: step1: original")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{hook1, hook2, hook3},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(originalEvents)

	// Verify hook 1 received original events
	select {
	case args1 := <-receivedArgs1:
		assert.Equal(t, originalEvents, args1.events, "Hook 1 should receive original events")
		assert.Equal(t, config, args1.cfg)
		assert.Len(t, args1.events, 1)
		assert.Equal(t, "original", string(args1.events[0].GetData()))
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for hook 1")
	}

	// Verify hook 2 received events modified by hook 1
	select {
	case args2 := <-receivedArgs2:
		assert.Equal(t, config, args2.cfg)
		assert.Len(t, args2.events, 1)
		assert.Equal(t, "step1: original", string(args2.events[0].GetData()), "Hook 2 should receive output from hook 1")
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for hook 2")
	}

	// Verify hook 3 received events modified by hook 2
	select {
	case args3 := <-receivedArgs3:
		assert.Equal(t, config, args3.cfg)
		assert.Len(t, args3.events, 1)
		assert.Equal(t, "step2: step1: original", string(args3.events[0].GetData()), "Hook 3 should receive output from hook 2")
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for hook 3")
	}

	// Verify hooks were called in correct order
	mu.Lock()
	assert.Equal(t, []int{1, 2, 3}, hookCallOrder, "Hooks should be called in order")
	mu.Unlock()

	// Verify final modified events were sent to UpdateSubscription
	mockUpdater.AssertCalled(t, "UpdateSubscription", subId, []byte("step3: step2: step1: original"))
	mockUpdater.AssertNumberOfCalls(t, "UpdateSubscription", 1)
	mockUpdater.AssertNotCalled(t, "Update")
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

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{}, // No hooks
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

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

			updater := NewSubscriptionEventUpdater(
				config,
				Hooks{},
				mockUpdater,
				zap.NewNop(),
				testEventBuilder,
			)

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
				&testEvent{mutableTestEvent("test data")},
			}

			testHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
				return events, tc.hookError
			}

			updater := NewSubscriptionEventUpdater(
				config,
				Hooks{
					OnReceiveEvents: OnReceiveEventsHooks{
						Handlers: []OnReceiveEventsFn{testHook},
					},
				},
				mockUpdater,
				zap.NewNop(),
				testEventBuilder,
			)

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

func TestSubscriptionEventUpdater_OnReceiveEvents_PanicRecovery(t *testing.T) {
	panicErr := errors.New("panic error")

	tests := []struct {
		name       string
		panicValue any
	}{
		{
			name:       "error type",
			panicValue: panicErr,
		},
		{
			name:       "string type",
			panicValue: "panic string message",
		},
		{
			name:       "other type",
			panicValue: 42,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			core, logObserver := observer.New(zap.InfoLevel)
			logger := zap.New(core)

			mockUpdater := NewMockSubscriptionUpdater(t)
			config := &testSubscriptionEventConfig{
				providerID:   "test-provider",
				providerType: ProviderTypeNats,
				fieldName:    "testField",
			}
			events := []StreamEvent{
				&testEvent{mutableTestEvent("test data")},
			}

			// Create hook that panics
			testHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
				panic(tt.panicValue)
			}

			subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
			mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
				context.Background(): subId,
			})
			mockUpdater.On("CloseSubscription", resolve.SubscriptionCloseKindDownstreamServiceError, subId).Return()

			updater := NewSubscriptionEventUpdater(
				config,
				Hooks{
					OnReceiveEvents: OnReceiveEventsHooks{
						Handlers: []OnReceiveEventsFn{testHook},
					},
				},
				mockUpdater,
				logger,
				testEventBuilder,
			)

			updater.Update(events)

			// Wait for async processing to complete and assert panic was logged
			assert.Eventually(t, func() bool {
				logs := logObserver.FilterMessage("[Recovery from handler panic]").All()
				return len(logs) == 1
			}, 10*time.Millisecond, time.Millisecond, "expected panic recovery log")

			// Assert that subscription was closed due to panic
			mockUpdater.AssertCalled(t, "CloseSubscription", resolve.SubscriptionCloseKindDownstreamServiceError, subId)
			mockUpdater.AssertNotCalled(t, "UpdateSubscription")

			// Assert that panic was logged with correct details
			logs := logObserver.FilterMessage("[Recovery from handler panic]").All()
			assert.Len(t, logs, 1)
			assert.Equal(t, zap.ErrorLevel, logs[0].Level)
			assert.Equal(t, int64(1), logs[0].ContextMap()["subscription_id"])
			assert.NotNil(t, logs[0].ContextMap()["error"])
		})
	}
}
