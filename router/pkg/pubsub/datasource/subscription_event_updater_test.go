package datasource

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
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

func TestSubscriptionEventUpdaterDoneForwardsToDone(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}

	mockUpdater.On("Done").Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{},
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Done()
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

func TestSubscriptionEventUpdater_Update_SkipsNilEvents(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &testSubscriptionEventConfig{
		providerID:   "test-provider",
		providerType: ProviderTypeNats,
		fieldName:    "testField",
	}
	events := []StreamEvent{
		&testEvent{mutableTestEvent("event data 1")},
		nil,
		&testEvent{mutableTestEvent("event data 2")},
	}

	mockUpdater.On("Update", []byte("event data 1")).Return()
	mockUpdater.On("Update", []byte("event data 2")).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{}, // No hooks
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	assert.NotPanics(t, func() {
		updater.Update(events)
	})

	mockUpdater.AssertCalled(t, "Update", []byte("event data 1"))
	mockUpdater.AssertCalled(t, "Update", []byte("event data 2"))
	mockUpdater.AssertNumberOfCalls(t, "Update", 2)
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
