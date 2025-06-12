package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/pubsubtest"
)

func TestNatsEngineDataSourceFactory(t *testing.T) {
	// Create the data source to test with a real adapter
	adapter := &ProviderAdapter{}
	pubsub := &EngineDataSourceFactory{
		providerId:  "test-provider",
		eventType:   EventTypePublish,
		subjects:    []string{"test-subject"},
		fieldName:   "testField",
		NatsAdapter: adapter,
	}

	// Run the standard test suite
	pubsubtest.VerifyEngineDataSourceFactoryImplementation(t, pubsub)
}

func TestEngineDataSourceFactoryWithMockAdapter(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Configure mock expectations for Publish
	mockAdapter.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Subject == "test-subject"
	})).Return(nil)

	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		providerId:  "test-provider",
		eventType:   EventTypePublish,
		subjects:    []string{"test-subject"},
		fieldName:   "testField",
		NatsAdapter: mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.NoError(t, err)

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.NoError(t, err)

	// Call Load on the data source
	out := &bytes.Buffer{}
	err = ds.Load(context.Background(), []byte(input), out)
	require.NoError(t, err)
	require.Equal(t, `{"success": true}`, out.String())
}

func TestEngineDataSourceFactory_GetResolveDataSource_WrongType(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		providerId:  "test-provider",
		eventType:   EventTypeSubscribe,
		subjects:    []string{"test-subject"},
		fieldName:   "testField",
		NatsAdapter: mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.Error(t, err)
	require.Nil(t, ds)
}

func TestEngineDataSourceFactory_GetResolveDataSourceInput_MultipleSubjects(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		providerId: "test-provider",
		eventType:  EventTypePublish,
		subjects:   []string{"test-subject-1", "test-subject-2"},
		fieldName:  "testField",
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

func TestEngineDataSourceFactory_GetResolveDataSourceInput_NoSubjects(t *testing.T) {
	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		providerId: "test-provider",
		eventType:  EventTypePublish,
		subjects:   []string{},
		fieldName:  "testField",
	}

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.Error(t, err)
	require.Empty(t, input)
}

func TestNatsEngineDataSourceFactoryMultiSubjectSubscription(t *testing.T) {
	// Create the data source to test with mock adapter
	pubsub := &EngineDataSourceFactory{
		providerId: "test-provider",
		eventType:  EventTypePublish,
		subjects:   []string{"test-subject-1", "test-subject-2"},
		fieldName:  "testField",
	}

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubsub.ResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	require.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Verify the subscription input contains both subjects
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.Equal(t, 2, len(subscriptionConfig.Subjects), "Expected 2 subjects in subscription configuration")
	require.Equal(t, "test-subject-1", subscriptionConfig.Subjects[0], "Expected first subject to be 'test-subject-1'")
	require.Equal(t, "test-subject-2", subscriptionConfig.Subjects[1], "Expected second subject to be 'test-subject-2'")
}

func TestNatsEngineDataSourceFactoryWithStreamConfiguration(t *testing.T) {
	// Create the data source to test
	pubsub := &EngineDataSourceFactory{
		providerId:                "test-provider",
		eventType:                 EventTypePublish,
		subjects:                  []string{"test-subject"},
		fieldName:                 "testField",
		withStreamConfiguration:   true,
		consumerName:              "test-consumer",
		streamName:                "test-stream",
		consumerInactiveThreshold: 30,
	}

	// Test GetResolveDataSourceSubscriptionInput with stream configuration
	subscriptionInput, err := pubsub.ResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	require.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Verify the subscription input contains stream configuration
	var subscriptionConfig SubscriptionEventConfiguration
	err = json.Unmarshal([]byte(subscriptionInput), &subscriptionConfig)
	require.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
	require.NotNil(t, subscriptionConfig.StreamConfiguration, "Expected non-nil stream configuration")
	require.Equal(t, "test-consumer", subscriptionConfig.StreamConfiguration.Consumer, "Expected consumer to be 'test-consumer'")
	require.Equal(t, "test-stream", subscriptionConfig.StreamConfiguration.StreamName, "Expected stream name to be 'test-stream'")
	require.Equal(t, int32(30), subscriptionConfig.StreamConfiguration.ConsumerInactiveThreshold, "Expected consumer inactive threshold to be 30")
}

func TestEngineDataSourceFactory_RequestDataSource(t *testing.T) {
	// Create mock adapter
	mockAdapter := NewMockAdapter(t)

	// Configure mock expectations for Request
	mockAdapter.On("Request", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
		return event.ProviderID == "test-provider" && event.Subject == "test-subject"
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		w := args.Get(2).(io.Writer)
		w.Write([]byte(`{"response": "test"}`))
	})

	// Create the data source with mock adapter
	pubsub := &EngineDataSourceFactory{
		providerId:  "test-provider",
		eventType:   EventTypeRequest,
		subjects:    []string{"test-subject"},
		fieldName:   "testField",
		NatsAdapter: mockAdapter,
	}

	// Get the data source
	ds, err := pubsub.ResolveDataSource()
	require.NoError(t, err)
	require.NotNil(t, ds)

	// Get the input
	input, err := pubsub.ResolveDataSourceInput([]byte(`{"test":"data"}`))
	require.NoError(t, err)

	// Call Load on the data source
	out := &bytes.Buffer{}
	err = ds.Load(context.Background(), []byte(input), out)
	require.NoError(t, err)
	require.Equal(t, `{"response": "test"}`, out.String())
}

func TestTransformEventConfig(t *testing.T) {
	t.Run("publish event", func(t *testing.T) {
		cfg := &EngineDataSourceFactory{
			providerId: "test-provider",
			eventType:  EventTypePublish,
			subjects:   []string{"original.subject"},
			fieldName:  "testField",
		}

		// Simple transform function that adds "transformed." prefix
		transformFn := func(s string) (string, error) {
			return "transformed." + s, nil
		}

		err := cfg.TransformEventData(transformFn)
		require.NoError(t, err)
		require.Equal(t, []string{"transformed.original.subject"}, cfg.subjects)
	})

	t.Run("subscribe event", func(t *testing.T) {
		cfg := &EngineDataSourceFactory{
			providerId: "test-provider",
			eventType:  EventTypeSubscribe,
			subjects:   []string{"original.subject1", "original.subject2"},
			fieldName:  "testField",
		}

		// Simple transform function that adds "transformed." prefix
		transformFn := func(s string) (string, error) {
			return "transformed." + s, nil
		}

		err := cfg.TransformEventData(transformFn)
		require.NoError(t, err)
		// Since the function sorts the subjects
		require.Equal(t, []string{"transformed.original.subject1", "transformed.original.subject2"}, cfg.subjects)
	})

	t.Run("invalid subject", func(t *testing.T) {
		cfg := &EngineDataSourceFactory{
			providerId: "test-provider",
			eventType:  EventTypePublish,
			subjects:   []string{"invalid subject with spaces"},
			fieldName:  "testField",
		}

		transformFn := func(s string) (string, error) {
			return s, nil
		}

		err := cfg.TransformEventData(transformFn)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid subject")
	})
}
