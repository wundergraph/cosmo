package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// testSubscriptionEventConfiguration implements SubscriptionEventConfiguration for testing
type testSubscriptionEventConfiguration struct {
	Topic   string `json:"topic"`
	Subject string `json:"subject"`
}

// incompatibleSubscriptionEventConfiguration implements SubscriptionEventConfiguration
// but is type-incompatible with testSubscriptionEventConfiguration.
type incompatibleSubscriptionEventConfiguration struct{}

func (i incompatibleSubscriptionEventConfiguration) ProviderID() string { return "incompatible" }
func (i incompatibleSubscriptionEventConfiguration) ProviderType() ProviderType {
	return ProviderTypeNats
}
func (i incompatibleSubscriptionEventConfiguration) RootFieldName() string { return "incompatible" }

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
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
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
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	invalidInput := []byte(`{"invalid": json}`)
	result, err := dataSource.SubscriptionEventConfiguration(invalidInput)
	assert.Error(t, err)
	assert.Equal(t, testSubscriptionEventConfiguration{}, result)
}

func TestPubSubSubscriptionDataSource_Start_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
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

	err = dataSource.Start(ctx, nil, input, mockUpdater)
	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestPubSubSubscriptionDataSource_Start_NoConfiguration(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	invalidInput := []byte(`{"invalid": json}`)
	ctx := resolve.NewContext(context.Background())
	mockUpdater := NewMockSubscriptionUpdater(t)

	err := dataSource.Start(ctx, nil, invalidInput, mockUpdater)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid character 'j' looking for beginning of value")
}

func TestPubSubSubscriptionDataSource_Start_SubscribeError(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
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

	err = dataSource.Start(ctx, nil, input, mockUpdater)
	assert.Error(t, err)
	assert.Equal(t, expectedError, err)
	mockAdapter.AssertExpectations(t)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_Success(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
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
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
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
		SubscriptionOnStart: SubscriptionOnStartHooks{
			Handlers: []SubscriptionOnStartFn{hook1, hook2},
		},
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
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Add hook that returns close=true
	hook := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return nil
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: SubscriptionOnStartHooks{
			Handlers: []SubscriptionOnStartFn{hook},
		},
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
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	expectedError := errors.New("hook error")
	// Add hook that returns an error
	hook := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return expectedError
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: SubscriptionOnStartHooks{
			Handlers: []SubscriptionOnStartFn{hook},
		},
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
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Initially should have no hooks
	assert.Len(t, dataSource.hooks.SubscriptionOnStart.Handlers, 0)

	// Add hooks
	hook1 := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return nil
	}
	hook2 := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		return nil
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: SubscriptionOnStartHooks{
			Handlers: []SubscriptionOnStartFn{hook1},
		},
	})
	assert.Len(t, dataSource.hooks.SubscriptionOnStart.Handlers, 1)

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: SubscriptionOnStartHooks{
			Handlers: []SubscriptionOnStartFn{hook2},
		},
	})
	assert.Len(t, dataSource.hooks.SubscriptionOnStart.Handlers, 1)
}

func TestNewPubSubSubscriptionDataSource(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	assert.NotNil(t, dataSource)
	assert.Equal(t, mockAdapter, dataSource.pubSub)
	assert.NotNil(t, dataSource.triggerHashInput)
	assert.Empty(t, dataSource.hooks.SubscriptionOnStart.Handlers)
}

func TestPubSubSubscriptionDataSource_InterfaceCompliance(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	// Test that it implements SubscriptionDataSource interface
	var _ SubscriptionDataSource = dataSource

	// Test that it implements HookablePubsubDatasource interface
	var _ resolve.HookablePubsubDatasource = dataSource
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_InvalidEventConfigInput(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	hookCalled := false
	hook := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
		hookCalled = true
		return nil
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnStart: SubscriptionOnStartHooks{
			Handlers: []SubscriptionOnStartFn{hook},
		},
	})

	invalidInput := []byte(`{"invalid": json}`)

	ctx := resolve.StartupHookContext{
		Context: context.Background(),
		Updater: func(data []byte) {},
	}

	err := dataSource.SubscriptionOnStart(ctx, invalidInput)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid character 'j' looking for beginning of value")
	assert.False(t, hookCalled)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_NoHooks(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	require.NoError(t, err)

	result, err := dataSource.SubscriptionOnCreate(context.Background(), input)
	assert.NoError(t, err)
	assert.Equal(t, input, result)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_WithHooks(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	hook1Called := false
	hook2Called := false

	hook1 := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		hook1Called = true
		return config
	}

	hook2 := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		hook2Called = true
		return config
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook1, hook2},
		},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	require.NoError(t, err)

	result, err := dataSource.SubscriptionOnCreate(context.Background(), input)
	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.True(t, hook1Called)
	assert.True(t, hook2Called)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_HookModifiesConfig(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	hook := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		typedConfig := config.(testSubscriptionEventConfiguration)
		typedConfig.Topic = "modified-topic"
		return typedConfig
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook},
		},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "original-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	require.NoError(t, err)

	result, err := dataSource.SubscriptionOnCreate(context.Background(), input)
	require.NoError(t, err)
	require.NotNil(t, result)

	var resultConfig testSubscriptionEventConfiguration
	err = json.Unmarshal(result, &resultConfig)
	require.NoError(t, err)
	assert.Equal(t, "modified-topic", resultConfig.Topic)
	assert.Equal(t, "test-subject", resultConfig.Subject)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_HooksChained(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	var hook1ReceivedTopic, hook2ReceivedTopic string

	hook1 := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		typedConfig := config.(testSubscriptionEventConfiguration)
		hook1ReceivedTopic = typedConfig.Topic
		typedConfig.Topic = "hook1-topic"
		return typedConfig
	}

	hook2 := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		typedConfig := config.(testSubscriptionEventConfiguration)
		hook2ReceivedTopic = typedConfig.Topic
		typedConfig.Topic = "hook2-topic"
		return typedConfig
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook1, hook2},
		},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "original-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	require.NoError(t, err)

	result, err := dataSource.SubscriptionOnCreate(context.Background(), input)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "original-topic", hook1ReceivedTopic)
	assert.Equal(t, "hook1-topic", hook2ReceivedTopic)

	var resultConfig testSubscriptionEventConfiguration
	err = json.Unmarshal(result, &resultConfig)
	require.NoError(t, err)
	assert.Equal(t, "hook2-topic", resultConfig.Topic)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_HookReturnsWrongType(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	hook := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		return incompatibleSubscriptionEventConfiguration{}
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook},
		},
	})

	testConfig := testSubscriptionEventConfiguration{
		Topic:   "test-topic",
		Subject: "test-subject",
	}
	input, err := json.Marshal(testConfig)
	require.NoError(t, err)

	result, err := dataSource.SubscriptionOnCreate(context.Background(), input)
	assert.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "invalid subscription configuration returned by SubscriptionOnCreate hook")
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_InvalidEventConfigInput(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	hookCalled := false
	hook := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		hookCalled = true
		return config
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook},
		},
	})

	result, err := dataSource.SubscriptionOnCreate(context.Background(), []byte(`{"invalid": json}`))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid character 'j' looking for beginning of value")
	assert.Nil(t, result)
	assert.False(t, hookCalled)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnCreate_PanicRecovery(t *testing.T) {
	panicErr := errors.New("panic error")

	tests := []struct {
		name            string
		panicValue      any
		expectedErr     error
		expectedErrText string
	}{
		{
			name:        "error type",
			panicValue:  panicErr,
			expectedErr: panicErr,
		},
		{
			name:            "string type",
			panicValue:      "panic string message",
			expectedErrText: "panic string message",
		},
		{
			name:            "other type",
			panicValue:      42,
			expectedErrText: "42",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := NewMockProvider(t)
			uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
				return nil
			}

			dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

			hook := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
				panic(tt.panicValue)
			}

			dataSource.SetHooks(Hooks{
				SubscriptionOnCreate: SubscriptionOnCreateHooks{
					Handlers: []SubscriptionOnCreateFn{hook},
				},
			})

			testConfig := testSubscriptionEventConfiguration{
				Topic:   "test-topic",
				Subject: "test-subject",
			}
			input, err := json.Marshal(testConfig)
			require.NoError(t, err)

			result, err := dataSource.SubscriptionOnCreate(context.Background(), input)

			assert.Error(t, err)
			assert.Nil(t, result)
			if tt.expectedErr != nil {
				assert.Equal(t, tt.expectedErr, err)
			}
			if tt.expectedErrText != "" {
				assert.Contains(t, err.Error(), tt.expectedErrText)
			}
		})
	}
}

func TestPubSubSubscriptionDataSource_SetSubscriptionOnCreateFns(t *testing.T) {
	mockAdapter := NewMockProvider(t)
	uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
		return nil
	}

	dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

	assert.Len(t, dataSource.hooks.SubscriptionOnCreate.Handlers, 0)

	hook1 := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		return config
	}
	hook2 := func(ctx context.Context, config SubscriptionEventConfiguration) SubscriptionEventConfiguration {
		return config
	}

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook1},
		},
	})
	assert.Len(t, dataSource.hooks.SubscriptionOnCreate.Handlers, 1)

	dataSource.SetHooks(Hooks{
		SubscriptionOnCreate: SubscriptionOnCreateHooks{
			Handlers: []SubscriptionOnCreateFn{hook2},
		},
	})
	assert.Len(t, dataSource.hooks.SubscriptionOnCreate.Handlers, 1)
}

func TestPubSubSubscriptionDataSource_SubscriptionOnStart_PanicRecovery(t *testing.T) {
	panicErr := errors.New("panic error")

	tests := []struct {
		name            string
		panicValue      any
		expectedErr     error
		expectedErrText string
	}{
		{
			name:        "error type",
			panicValue:  panicErr,
			expectedErr: panicErr,
		},
		{
			name:            "string type",
			panicValue:      "panic string message",
			expectedErrText: "panic string message",
		},
		{
			name:            "other type",
			panicValue:      42,
			expectedErrText: "42",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := NewMockProvider(t)
			uniqueRequestIDFn := func(input []byte, xxh *xxhash.Digest) error {
				return nil
			}

			dataSource := NewPubSubSubscriptionDataSource[testSubscriptionEventConfiguration](mockAdapter, uniqueRequestIDFn, zap.NewNop(), testSubscriptionDataSourceEventBuilder)

			// Add hook that panics
			hook := func(ctx resolve.StartupHookContext, config SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error {
				panic(tt.panicValue)
			}

			dataSource.SetHooks(Hooks{
				SubscriptionOnStart: SubscriptionOnStartHooks{
					Handlers: []SubscriptionOnStartFn{hook},
				},
			})

			testConfig := testSubscriptionEventConfiguration{
				Topic:   "test-topic",
				Subject: "test-subject",
			}
			input, err := json.Marshal(testConfig)
			assert.NoError(t, err)

			hookCtx := resolve.StartupHookContext{
				Context: context.Background(),
				Updater: func(data []byte) {},
			}

			err = dataSource.SubscriptionOnStart(hookCtx, input)

			assert.Error(t, err)
			if tt.expectedErr != nil {
				assert.Equal(t, tt.expectedErr, err)
			}
			if tt.expectedErrText != "" {
				assert.Contains(t, err.Error(), tt.expectedErrText)
			}
		})
	}
}
