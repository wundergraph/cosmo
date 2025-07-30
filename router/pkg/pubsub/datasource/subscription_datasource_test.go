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

func TestPubSubSubscriptionDataSource_SubscriptionEventConfiguration_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	result := dataSource.SubscriptionEventConfiguration(input)
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

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	invalidInput := []byte(`{"invalid": json}`)
	result := dataSource.SubscriptionEventConfiguration(invalidInput)
	assert.Nil(t, result)
}

func TestPubSubSubscriptionDataSource_UniqueRequestID_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

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

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

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

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

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

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	invalidInput := []byte(`{"invalid": json}`)
	ctx := resolve.NewContext(context.Background())
	mockUpdater := NewMockSubscriptionUpdater(t)

	err := dataSource.Start(ctx, invalidInput, mockUpdater)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no subscription configuration found")
}

func TestPubSubSubscriptionDataSource_Start_SubscribeError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

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

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := &resolve.Context{}

	close, err := dataSource.SubscriptionOnStart(ctx, input)
	assert.NoError(t, err)
	assert.False(t, close)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_WithHooks(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	// Add subscription start hooks
	hook1Called := false
	hook2Called := false

	hook1 := func(ctx *resolve.Context, config SubscriptionEventConfiguration) (bool, error) {
		hook1Called = true
		return false, nil
	}

	hook2 := func(ctx *resolve.Context, config SubscriptionEventConfiguration) (bool, error) {
		hook2Called = true
		return false, nil
	}

	dataSource.SetSubscriptionOnStartFns(hook1, hook2)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := &resolve.Context{}

	close, err := dataSource.SubscriptionOnStart(ctx, input)
	assert.NoError(t, err)
	assert.False(t, close)
	assert.True(t, hook1Called)
	assert.True(t, hook2Called)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_HookReturnsClose(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	// Add hook that returns close=true
	hook := func(ctx *resolve.Context, config SubscriptionEventConfiguration) (bool, error) {
		return true, nil
	}

	dataSource.SetSubscriptionOnStartFns(hook)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := &resolve.Context{}

	close, err := dataSource.SubscriptionOnStart(ctx, input)
	assert.NoError(t, err)
	assert.True(t, close)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_HookReturnsError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	expectedError := errors.New("hook error")
	// Add hook that returns an error
	hook := func(ctx *resolve.Context, config SubscriptionEventConfiguration) (bool, error) {
		return false, expectedError
	}

	dataSource.SetSubscriptionOnStartFns(hook)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	assert.NoError(t, err)

	ctx := &resolve.Context{}

	close, err := dataSource.SubscriptionOnStart(ctx, input)
	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
	assert.False(t, close)
}

func TestPubSubSubscriptionDataSource_SetSubscriptionOnStartFns(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	// Initially should have no hooks
	assert.Len(t, dataSource.subscriptionOnStartFns, 0)

	// Add hooks
	hook1 := func(ctx *resolve.Context, config SubscriptionEventConfiguration) (bool, error) {
		return false, nil
	}
	hook2 := func(ctx *resolve.Context, config SubscriptionEventConfiguration) (bool, error) {
		return false, nil
	}

	dataSource.SetSubscriptionOnStartFns(hook1)
	assert.Len(t, dataSource.subscriptionOnStartFns, 1)

	dataSource.SetSubscriptionOnStartFns(hook2)
	assert.Len(t, dataSource.subscriptionOnStartFns, 2)
}

func TestNewPubSubSubscriptionDataSource(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	assert.NotNil(t, dataSource)
	assert.Equal(t, mockAdapter, dataSource.pubSub)
	assert.NotNil(t, dataSource.uniqueRequestID)
	assert.Empty(t, dataSource.subscriptionOnStartFns)
}

func TestPubSubSubscriptionDataSource_InterfaceCompliance(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn)

	// Test that it implements SubscriptionDataSource interface
	var _ SubscriptionDataSource = dataSource

	// Test that it implements HookableSubscriptionDataSource interface
	var _ resolve.HookableSubscriptionDataSource = dataSource
}
