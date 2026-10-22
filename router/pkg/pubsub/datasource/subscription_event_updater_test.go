package datasource

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"

	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
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

func (c *testSubscriptionEventConfig) DeliveryGuaranteeMode() DeliveryGuaranteeMode {
	return DeliveryGuaranteeModeOff
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
	mockUpdater.On("Update", []byte("test data 1"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()
	mockUpdater.On("Update", []byte("test data 2"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()

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
	mockUpdater.On("Update", []byte("event data 1"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()
	mockUpdater.On("Update", []byte("event data 2"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()
	mockUpdater.On("Update", []byte("event data 3"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()

	updater := NewSubscriptionEventUpdater(
		config,
		Hooks{}, // No hooks
		mockUpdater,
		zap.NewNop(),
		testEventBuilder,
	)

	updater.Update(events)

	// Verify all events were passed through without modification
	mockUpdater.AssertCalled(t, "Update", []byte("event data 1"), (*resolve.SubscriptionUpdateMetadata)(nil))
	mockUpdater.AssertCalled(t, "Update", []byte("event data 2"), (*resolve.SubscriptionUpdateMetadata)(nil))
	mockUpdater.AssertCalled(t, "Update", []byte("event data 3"), (*resolve.SubscriptionUpdateMetadata)(nil))
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

	mockUpdater.On("Update", []byte("event data 1"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()
	mockUpdater.On("Update", []byte("event data 2"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()

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

	mockUpdater.AssertCalled(t, "Update", []byte("event data 1"), (*resolve.SubscriptionUpdateMetadata)(nil))
	mockUpdater.AssertCalled(t, "Update", []byte("event data 2"), (*resolve.SubscriptionUpdateMetadata)(nil))
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

// positionedTestEvent is an event that carries its position in the broker.
type positionedTestEvent struct {
	testEvent
	position *streamsv1.Cursor
}

func (e *positionedTestEvent) CursorPosition() *streamsv1.Cursor {
	return e.position
}

type testIdentityContextKey struct{}

func TestSubscriptionEventUpdater_Update_IssuesCursorPerSubscriber(t *testing.T) {
	// Two subscribers with different identities share a trigger. Each gets its own cursor,
	// which verifies only for its own identity. Events without a position carry no cursor.
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &cursorTestConfig{guaranteeTestConfig: guaranteeTestConfig{Mode: DeliveryGuaranteeModeCursor}, topics: []string{"employeeUpdated"}}

	alice := ClientIdentity{Authenticated: true, Authenticator: "jwks", Subject: "alice"}
	bob := ClientIdentity{Authenticated: true, Authenticator: "jwks", Subject: "bob"}
	aliceID := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	bobID := resolve.SubscriptionIdentifier{ConnectionID: 2, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.WithValue(context.Background(), testIdentityContextKey{}, alice): aliceID,
		context.WithValue(context.Background(), testIdentityContextKey{}, bob):   bobID,
	})

	cursors := make(chan struct {
		subID resolve.SubscriptionIdentifier
		md    *resolve.SubscriptionUpdateMetadata
	}, 4)
	mockUpdater.On("UpdateSubscription", mock.Anything, []byte("positioned"), mock.Anything).Run(func(args mock.Arguments) {
		cursors <- struct {
			subID resolve.SubscriptionIdentifier
			md    *resolve.SubscriptionUpdateMetadata
		}{args.Get(0).(resolve.SubscriptionIdentifier), args.Get(2).(*resolve.SubscriptionUpdateMetadata)}
	}).Return()
	mockUpdater.On("UpdateSubscription", mock.Anything, []byte("unpositioned"), (*resolve.SubscriptionUpdateMetadata)(nil)).Return()

	codec, err := NewCursorCodec([]CursorKey{{ID: 1, Secret: testCursorSecret1}})
	require.NoError(t, err)
	bindingCalls := atomic.Int32{}
	subscriberBinding := func(ctx context.Context) (ClientIdentity, error) {
		bindingCalls.Add(1)
		return ctx.Value(testIdentityContextKey{}).(ClientIdentity), nil
	}

	updater := newSubscriptionEventUpdater(config, Hooks{}, mockUpdater, zap.NewNop(), testEventBuilder)
	updater.enableCursors(Cursors{Codec: codec, SubscriberBinding: subscriberBinding})

	for range 2 {
		updater.Update([]StreamEvent{
			&positionedTestEvent{testEvent: testEvent{mutableTestEvent("positioned")}, position: positionCursor()},
			&testEvent{mutableTestEvent("unpositioned")},
		})
	}
	close(cursors)

	requestData, err := cursorRequestData(config)
	require.NoError(t, err)

	issued := map[resolve.SubscriptionIdentifier][]string{}
	for c := range cursors {
		require.NotNil(t, c.md)
		issued[c.subID] = append(issued[c.subID], c.md.Cursor)
	}
	require.Len(t, issued[aliceID], 2)
	require.Len(t, issued[bobID], 2)
	require.NotEqual(t, issued[aliceID][0], issued[bobID][0])

	_, err = codec.Verify(issued[aliceID][0], requestData, alice)
	require.NoError(t, err)
	_, err = codec.Verify(issued[aliceID][0], requestData, bob)
	requireCursorErrorCode(t, err, DeliveryGuaranteeErrorCodeCursorClientMismatch)

	_, err = codec.Verify(issued[bobID][0], requestData, bob)
	require.NoError(t, err)
	_, err = codec.Verify(issued[bobID][0], requestData, alice)
	requireCursorErrorCode(t, err, DeliveryGuaranteeErrorCodeCursorClientMismatch)

	// The binding is resolved once per subscriber, not once per event.
	require.Equal(t, int32(2), bindingCalls.Load())
}

func TestSubscriptionEventUpdater_Update_ClosesSubscriptionWhenCursorCantBeIssued(t *testing.T) {
	// Sending an event without its cursor would silently downgrade the guarantee.
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &cursorTestConfig{guaranteeTestConfig: guaranteeTestConfig{Mode: DeliveryGuaranteeModeCursor}}

	subID := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	mockUpdater.On("Subscriptions").Return(map[context.Context]resolve.SubscriptionIdentifier{
		context.Background(): subID,
	})
	mockUpdater.On("CloseSubscription", subID).Return()

	codec, err := NewCursorCodec([]CursorKey{{ID: 1, Secret: testCursorSecret1}})
	require.NoError(t, err)
	subscriberBinding := func(context.Context) (ClientIdentity, error) {
		return ClientIdentity{}, errors.New("binding failed")
	}

	updater := newSubscriptionEventUpdater(config, Hooks{}, mockUpdater, zap.NewNop(), testEventBuilder)
	updater.enableCursors(Cursors{Codec: codec, SubscriberBinding: subscriberBinding})

	updater.Update([]StreamEvent{
		&positionedTestEvent{testEvent: testEvent{mutableTestEvent("positioned")}, position: positionCursor()},
	})

	mockUpdater.AssertNotCalled(t, "UpdateSubscription", mock.Anything, mock.Anything, mock.Anything)
	mockUpdater.AssertCalled(t, "CloseSubscription", subID)
}

func TestSubscriptionEventUpdater_PrunesCursorBindingsOfLeftSubscribers(t *testing.T) {
	mockUpdater := NewMockSubscriptionUpdater(t)
	config := &cursorTestConfig{guaranteeTestConfig: guaranteeTestConfig{Mode: DeliveryGuaranteeModeCursor}}

	stayed := resolve.SubscriptionIdentifier{ConnectionID: 1, SubscriptionID: 1}
	left := resolve.SubscriptionIdentifier{ConnectionID: 2, SubscriptionID: 1}

	codec, err := NewCursorCodec([]CursorKey{{ID: 1, Secret: testCursorSecret1}})
	require.NoError(t, err)
	updater := newSubscriptionEventUpdater(config, Hooks{}, mockUpdater, zap.NewNop(), testEventBuilder)
	updater.enableCursors(Cursors{Codec: codec, SubscriberBinding: func(context.Context) (ClientIdentity, error) {
		return ClientIdentity{}, nil
	}})
	updater.cursorBindings[stayed] = cursorBinding{}
	updater.cursorBindings[left] = cursorBinding{}

	updater.pruneCursorBindings(map[context.Context]resolve.SubscriptionIdentifier{context.Background(): stayed})

	require.Contains(t, updater.cursorBindings, stayed)
	require.NotContains(t, updater.cursorBindings, left)
}
