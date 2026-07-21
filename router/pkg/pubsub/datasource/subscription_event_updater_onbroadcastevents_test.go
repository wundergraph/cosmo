package datasource

// These tests are a reflection of tests in subscription_event_updater_onreceiveevents_test.go,
// adjusted for the OnBroadcastEvents hook.

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

type receivedBroadcastHooksArgs struct {
	events []StreamEvent
	cfg    SubscriptionEventConfiguration
}

func TestSubscriptionEventUpdater_Update_WithOnBroadcastEventsHooks_Success(t *testing.T) {
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
	}

	// Create wrapper function for the mock
	receivedArgs := make(chan receivedBroadcastHooksArgs, 1)
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs <- receivedBroadcastHooksArgs{events: events, cfg: cfg}
		return modifiedEvents, nil
	}

	// Expect call to Update with modified data since there are no OnReceiveEvents hooks
	mockUpdater.On("Update", []byte("modified data")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{testHook},
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

	mockUpdater.AssertCalled(t, "Update", []byte("modified data"))
	mockUpdater.AssertNumberOfCalls(t, "Update", 1)
}

func TestSubscriptionEventUpdater_Update_WithOnBroadcastEventsHooks_Error(t *testing.T) {
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
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return nil, hookError
	}

	// Should not call Update or Subscriptions on eventUpdater since the batch is dropped
	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{testHook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(events)

	// Assert that the whole batch was dropped
	mockUpdater.AssertNotCalled(t, "Update")
	mockUpdater.AssertNotCalled(t, "Subscriptions")
	mockUpdater.AssertNotCalled(t, "UpdateSubscription")
	mockUpdater.AssertNotCalled(t, "CloseSubscription")
}

func TestSubscriptionEventUpdater_Update_WithMultipleOnBroadcastEventsHooks_Success(t *testing.T) {
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
	receivedArgs1 := make(chan receivedBroadcastHooksArgs, 1)
	hook1 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs1 <- receivedBroadcastHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{mutableTestEvent("modified by hook1")}}, nil
	}

	receivedArgs2 := make(chan receivedBroadcastHooksArgs, 1)
	hook2 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedArgs2 <- receivedBroadcastHooksArgs{events: events, cfg: cfg}
		return []StreamEvent{&testEvent{mutableTestEvent("modified by hook2")}}, nil
	}

	mockUpdater.On("Update", []byte("modified by hook2")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{hook1, hook2},
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

	mockUpdater.AssertNumberOfCalls(t, "Update", 1)
}

func TestSubscriptionEventUpdater_Update_WithMultipleOnBroadcastEventsHooks_Error(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{mutableTestEvent("original data")},
	}
	hookError := errors.New("first hook error")

	var hook1Called, hook2Called, hook3Called atomic.Bool

	// Hook 1: Returns an error
	hook1 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		hook1Called.Store(true)
		return events, hookError
	}

	// Hook 2: Should not be called since hook1 returned an error
	hook2 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		hook2Called.Store(true)
		return []StreamEvent{&testEvent{mutableTestEvent("modified by hook2")}}, nil
	}

	// Hook 3: Should not be called since hook1 returned an error
	hook3 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		hook3Called.Store(true)
		return []StreamEvent{&testEvent{mutableTestEvent("modified by hook3")}}, nil
	}

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{hook1, hook2, hook3},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(originalEvents)

	// Verify hook1 was called
	assert.Eventually(t, func() bool {
		return hook1Called.Load()
	}, 1*time.Second, 10*time.Millisecond, "hook1 should have been called")

	// Verify hook2 was NOT called
	assert.Never(t, func() bool {
		return hook2Called.Load()
	}, 100*time.Millisecond, 10*time.Millisecond, "hook2 should not have been called after hook1 returned an error")

	// Verify hook3 was NOT called
	assert.Never(t, func() bool {
		return hook3Called.Load()
	}, 100*time.Millisecond, 10*time.Millisecond, "hook3 should not have been called after hook1 returned an error")

	// Since the batch is dropped on error, Update should never be called
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithSingleOnBroadcastEventsHookModification(t *testing.T) {
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
	hook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "modified: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	mockUpdater.On("Update", []byte("modified: original data 1")).Return()
	mockUpdater.On("Update", []byte("modified: original data 2")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{hook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(originalEvents)

	// Verify modified events were sent to Update, not the original events
	mockUpdater.AssertCalled(t, "Update", []byte("modified: original data 1"))
	mockUpdater.AssertCalled(t, "Update", []byte("modified: original data 2"))
	mockUpdater.AssertNumberOfCalls(t, "Update", 2)
}

func TestSubscriptionEventUpdater_Update_WithSingleOnBroadcastEventsHookError_DropsBatch(t *testing.T) {
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
	hook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		// Return the events but also return an error
		return events, hookError
	}

	updater := NewSubscriptionEventUpdater(config, Hooks{
		OnBroadcastEvents: OnBroadcastEventsHooks{
			Handlers: []OnBroadcastEventsFn{hook},
		},
	}, mockUpdater, zap.NewNop(), testEventBuilder)

	updater.Update(events)

	// Verify the whole batch was dropped despite the returned events
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithMultipleOnBroadcastEventsHooksChaining(t *testing.T) {
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
	receivedArgs1 := make(chan receivedBroadcastHooksArgs, 1)
	hook1 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		mu.Lock()
		hookCallOrder = append(hookCallOrder, 1)
		mu.Unlock()
		receivedArgs1 <- receivedBroadcastHooksArgs{events: events, cfg: cfg}
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "step1: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	// Hook 2: Adds "step2: " prefix
	receivedArgs2 := make(chan receivedBroadcastHooksArgs, 1)
	hook2 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		mu.Lock()
		hookCallOrder = append(hookCallOrder, 2)
		mu.Unlock()
		receivedArgs2 <- receivedBroadcastHooksArgs{events: events, cfg: cfg}
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "step2: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	// Hook 3: Adds "step3: " prefix
	receivedArgs3 := make(chan receivedBroadcastHooksArgs, 1)
	hook3 := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		mu.Lock()
		hookCallOrder = append(hookCallOrder, 3)
		mu.Unlock()
		receivedArgs3 <- receivedBroadcastHooksArgs{events: events, cfg: cfg}
		modifiedEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			modifiedData := "step3: " + string(event.GetData())
			modifiedEvents[i] = &testEvent{mutableTestEvent(modifiedData)}
		}
		return modifiedEvents, nil
	}

	// Final modified data should have all three transformations applied
	mockUpdater.On("Update", []byte("step3: step2: step1: original")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{hook1, hook2, hook3},
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

	// Verify final modified events were sent to Update
	mockUpdater.AssertCalled(t, "Update", []byte("step3: step2: step1: original"))
	mockUpdater.AssertNumberOfCalls(t, "Update", 1)
}

func TestSubscriptionEventUpdater_Update_WithOnBroadcastEventsHookError_DropsBatch(t *testing.T) {
	testCases := []struct {
		name      string
		hookError error
	}{
		{
			name:      "generic error",
			hookError: errors.New("batch should be dropped"),
		},
		{
			name:      "other error",
			hookError: errors.New("batch should still be dropped"),
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

			testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
				return events, tc.hookError
			}

			updater := NewSubscriptionEventUpdater(
				config,
				Hooks{
					OnBroadcastEvents: OnBroadcastEventsHooks{
						Handlers: []OnBroadcastEventsFn{testHook},
					},
				},
				mockUpdater,
				zap.NewNop(),
				testEventBuilder,
			)

			updater.Update(events)

			mockUpdater.AssertNotCalled(t, "Update")
		})
	}
}

func TestSubscriptionEventUpdater_OnBroadcastEvents_PanicRecovery(t *testing.T) {
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
			testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
				panic(tt.panicValue)
			}

			updater := NewSubscriptionEventUpdater(
				config,
				Hooks{
					OnBroadcastEvents: OnBroadcastEventsHooks{
						Handlers: []OnBroadcastEventsFn{testHook},
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
			}, 1*time.Second, time.Millisecond, "expected panic recovery log")

			// Assert that the batch was dropped due to panic
			mockUpdater.AssertNotCalled(t, "Update")

			// Assert that panic was logged with correct details
			logs := logObserver.FilterMessage("[Recovery from handler panic]").All()
			assert.Len(t, logs, 1)
			assert.Equal(t, zap.ErrorLevel, logs[0].Level)
			assert.Equal(t, "OnBroadcastEvents", logs[0].ContextMap()["handler_name"])
			assert.NotNil(t, logs[0].ContextMap()["error"])
		})
	}
}

func TestSubscriptionEventUpdater_Update_OnBroadcastEventsHookTimeout_DropsBatch(t *testing.T) {
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

	blockCh := make(chan struct{})

	// Hook that blocks until the updater's timeout has been exceeded
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		<-blockCh
		return events, nil
	}
	defer close(blockCh)

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{testHook},
				Timeout:  10 * time.Millisecond,
			},
		},
		mockUpdater,
		logger,
		testEventBuilder,
	)

	updater.Update(events)

	// The batch should be dropped since the hook did not complete in time
	mockUpdater.AssertNotCalled(t, "Update")

	// Assert the timeout (not some other reason) is what caused the drop
	assert.Eventually(t, func() bool {
		logs := logObserver.FilterMessageSnippet("OnBroadcastEvents handler timeout exceeded").All()
		return len(logs) == 1
	}, 1*time.Second, 10*time.Millisecond, "expected timeout warning log")

	logs := logObserver.FilterMessageSnippet("OnBroadcastEvents handler timeout exceeded").All()
	assert.Len(t, logs, 1)
	assert.Equal(t, zap.WarnLevel, logs[0].Level)
}

func TestSubscriptionEventUpdater_Update_WithOnBroadcastEventsHooks_EmptyResult_NoEventsSent(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{mutableTestEvent("test data")},
	}

	// Hook succeeds but filters out all events
	testHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return []StreamEvent{}, nil
	}

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{testHook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(events)

	// Nothing to send since the hook returned no events
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithOnBroadcastEventsHooks_SuccessHandoffToOnReceiveEvents(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	originalEvents := []StreamEvent{
		&testEvent{mutableTestEvent("original data")},
	}

	broadcastHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return []StreamEvent{&testEvent{mutableTestEvent("modified by broadcast hook")}}, nil
	}

	// The OnReceiveEvents hook should receive the events produced by the OnBroadcastEvents hook,
	// not the original events.
	receivedByReceiveHook := make(chan []StreamEvent, 1)
	receiveHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receivedByReceiveHook <- events
		return events, nil
	}

	subId := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("UpdateSubscription", subId, []byte("modified by broadcast hook")).Return()
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subId,
	})

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{broadcastHook},
			},
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{receiveHook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(originalEvents)

	select {
	case events := <-receivedByReceiveHook:
		assert.Equal(t, []StreamEvent{&testEvent{mutableTestEvent("modified by broadcast hook")}}, events)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for OnReceiveEvents hook to be called")
	}

	mockUpdater.AssertCalled(t, "UpdateSubscription", subId, []byte("modified by broadcast hook"))
	mockUpdater.AssertNotCalled(t, "Update")
}

func TestSubscriptionEventUpdater_Update_WithOnBroadcastEventsHooks_ErrorDropsBeforeOnReceiveEventsFanOut(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{mutableTestEvent("test data")},
	}
	hookError := errors.New("broadcast hook processing error")

	broadcastHook := func(ctx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		return nil, hookError
	}

	var receiveHookCalled atomic.Bool
	receiveHook := func(subCtx context.Context, updaterCtx context.Context, cfg SubscriptionEventConfiguration, eventBuilder EventBuilderFn, events []StreamEvent) ([]StreamEvent, error) {
		receiveHookCalled.Store(true)
		return events, nil
	}

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{
			OnBroadcastEvents: OnBroadcastEventsHooks{
				Handlers: []OnBroadcastEventsFn{broadcastHook},
			},
			OnReceiveEvents: OnReceiveEventsHooks{
				Handlers: []OnReceiveEventsFn{receiveHook},
			},
		},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(events)

	// The batch is dropped before subscriptions are even looked up, so the
	// OnReceiveEvents hook must never run and no subscription-related calls happen.
	assert.Never(t, func() bool {
		return receiveHookCalled.Load()
	}, 100*time.Millisecond, 10*time.Millisecond, "OnReceiveEvents hook should not have been called after OnBroadcastEvents returned an error")

	mockUpdater.AssertNotCalled(t, "Subscriptions")
	mockUpdater.AssertNotCalled(t, "UpdateSubscription")
	mockUpdater.AssertNotCalled(t, "CloseSubscription")
	mockUpdater.AssertNotCalled(t, "Update")
}
