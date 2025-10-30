package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// testSubscriptionEventConfiguration implements SubscriptionEventConfiguration for testing
type testSubscriptionEventConfiguration struct {
	Topic   string `json:"topic"`
	Subject string `json:"subject"`
}

func (t testSubscriptionEventConfiguration) ProviderID() string {
	return "test-provider"
}

func (t testSubscriptionEventConfiguration) ProviderType() ProviderType {
	return ProviderTypeNats
}

func (t testSubscriptionEventConfiguration) RootFieldName() string {
	return "testSubscription"
}

// testSubscriptionDataSourceEventBuilder is a reusable event builder for tests
func testSubscriptionDataSourceEventBuilder(data []byte) MutableStreamEvent {
	return mutableTestEvent(data)
}

func TestPubSubSubscriptionDataSource_SubscriptionEventConfiguration_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	result, err := dataSource.SubscriptionEventConfiguration(input)
	assert.NoError(t, err)
	assert.NotNil(t, result)

	typedResult, ok := result.(testSubscriptionEventConfiguration)
	assert.True(t, ok)
	assert.Equal(t, "test-topic", typedResult.Topic)
	assert.Equal(t, "test-subject", typedResult.Subject)
}

func TestPubSubSubscriptionDataSource_SubscriptionEventConfiguration_InvalidJSON(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	invalidInput := []byte(`{"invalid": json}`)
	result, err := dataSource.SubscriptionEventConfiguration(invalidInput)
	assert.Error(t, err)
	assert.Equal(t, testSubscriptionEventConfiguration{}, result)
}

func TestPubSubSubscriptionDataSource_UniqueRequestID_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	ctx := &resolve.Context{}
	input := []byte(`{"test": "data"}`)
	xxh := xxhash.New()

	err := dataSource.UniqueRequestID(ctx, input, xxh)
	assert.NoError(t, err)
}

func TestPubSubSubscriptionDataSource_UniqueRequestID_Error(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	expectedError := errors.New("unique ID generation error")
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return expectedError
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	ctx := &resolve.Context{}
	input := []byte(`{"test": "data"}`)
	xxh := xxhash.New()

	err := dataSource.UniqueRequestID(ctx, input, xxh)
	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
}

func TestPubSubSubscriptionDataSource_Start_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := resolve.NewContext(context.Background())
	mockUpdater := NewMockSubscriptionUpdater(t)

	mockAdapter.On("Subscribe", ctx.Context(), testConfig, mock.AnythingOfType("*datasource.subscriptionEventUpdater")).Return(nil)

	err = dataSource.Start(ctx, input, mockUpdater)
	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestPubSubSubscriptionDataSource_Start_NoConfiguration(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	invalidInput := []byte(`{"invalid": json}`)
	ctx := resolve.NewContext(context.Background())
	mockUpdater := NewMockSubscriptionUpdater(t)

	err := dataSource.Start(ctx, invalidInput, mockUpdater)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid character 'j' looking for beginning of value")
}

func TestPubSubSubscriptionDataSource_Start_SubscribeError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := resolve.NewContext(context.Background())
	mockUpdater := NewMockSubscriptionUpdater(t)
	expectedError := errors.New("subscription error")

	mockAdapter.On("Subscribe", ctx.Context(), testConfig, mock.AnythingOfType("*datasource.subscriptionEventUpdater")).Return(expectedError)

	err = dataSource.Start(ctx, input, mockUpdater)
	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
	mockAdapter.AssertExpectations(t)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := resolve.StartupHookContext{
		Context: context.Background(),
		Updater: func(data []byte) {},
	}

	err = dataSource.SubscriptionOnStart(ctx, input)
	assert.NoError(t, err)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_WithHooks(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Add subscription start hooks
	hook1Called := false
	hook2Called := false
	hook1EventBuilderExists := false
	hook2EventBuilderExists := false

	hook1 := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		hook1Called = true
		if eventBuilder != nil {
			hook1EventBuilderExists = true
		}
		return nil
	}

	hook2 := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		hook2Called = true
		if eventBuilder != nil {
			hook2EventBuilderExists = true
		}
		return nil
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: []SubscriptionOnStartFn{hook1, hook2},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := resolve.StartupHookContext{
		Context: context.Background(),
		Updater: func(data []byte) {},
	}

	err = dataSource.SubscriptionOnStart(ctx, input)
	assert.NoError(t, err)
	assert.True(t, hook1Called)
	assert.True(t, hook2Called)
	assert.True(t, hook1EventBuilderExists)
	assert.True(t, hook2EventBuilderExists)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_HookReturnsClose(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Add hook that returns close=true
	hook := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return nil
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: []SubscriptionOnStartFn{hook},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := resolve.StartupHookContext{
		Context: context.Background(),
		Updater: func(data []byte) {},
	}

	errSubStart := dataSource.SubscriptionOnStart(ctx, input)
	assert.NoError(t, errSubStart)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_HookReturnsError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	expectedError := errors.New("hook error")
	// Add hook that returns an error
	hook := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return expectedError
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: []SubscriptionOnStartFn{hook},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := resolve.StartupHookContext{
		Context: context.Background(),
		Updater: func(data []byte) {},
	}

	err = dataSource.SubscriptionOnStart(ctx, input)
	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
}

func TestPubSubSubscriptionDataSource_SetSubscriptionOnStartFns(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Initially should have no hooks
	assert.Len(t, dataSource.hooks.SubscriptionOnStart, 0)

	// Add hooks
	hook1 := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return nil
	}
	hook2 := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return nil
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: []SubscriptionOnStartFn{hook1},
	})
	assert.Len(t, dataSource.hooks.SubscriptionOnStart, 1)

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: []SubscriptionOnStartFn{hook2},
	})
	assert.Len(t, dataSource.hooks.SubscriptionOnStart, 1)
}

func TestNewPubSubSubscriptionDataSource(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	assert.NotNil(t, dataSource)
	assert.Equal(t, mockAdapter, dataSource.pubSub)
	assert.NotNil(t, dataSource.uniqueRequestID)
	assert.Empty(t, dataSource.hooks.SubscriptionOnStart)
}

func TestPubSubSubscriptionDataSource_InterfaceCompliance(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Test that it implements SubscriptionDataSource interface
	var _ SubscriptionDataSource = dataSource

	// Test that it implements HookableSubscriptionDataSource interface
	var _ resolve.HookableSubscriptionDataSource = dataSource
}
