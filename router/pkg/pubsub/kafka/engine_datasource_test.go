package kafka

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestPublishEventConfiguration_MarshalJSONTemplate(t *testing.T) {
	tests := []struct {
		name        string
		config      PublishEventConfiguration
		wantPattern string
	}{
		{
			name: "simple configuration",
			config: PublishEventConfiguration{
				Provider: "test-provider",
				Topic:    "test-topic",
				Event:    Event{Data: json.RawMessage(`{"message":"hello"}`)},
			},
			wantPattern: `{"topic":"test-topic", "event": {"data": {"message":"hello"}, "key": "", "headers": {}}, "providerId":"test-provider"}`,
		},
		{
			name: "with special characters",
			config: PublishEventConfiguration{
				Provider: "test-provider-id",
				Topic:    "topic-with-hyphens",
				Event:    Event{Data: json.RawMessage(`{"message":"special \"quotes\" here"}`)},
			},
			wantPattern: `{"topic":"topic-with-hyphens", "event": {"data": {"message":"special \"quotes\" here"}, "key": "", "headers": {}}, "providerId":"test-provider-id"}`,
		},
		{
			name: "with key",
			config: PublishEventConfiguration{
				Provider: "test-provider-id",
				Topic:    "topic-with-hyphens",
				Event:    Event{Key: []byte("blablabla"), Data: json.RawMessage(`{}`)},
			},
			wantPattern: `{"topic":"topic-with-hyphens", "event": {"data": {}, "key": "blablabla", "headers": {}}, "providerId":"test-provider-id"}`,
		},
		{
			name: "with headers",
			config: PublishEventConfiguration{
				Provider: "test-provider-id",
				Topic:    "topic-with-hyphens",
				Event:    Event{Headers: map[string][]byte{"key": []byte(`blablabla`)}, Data: json.RawMessage(`{}`)},
			},
			wantPattern: `{"topic":"topic-with-hyphens", "event": {"data": {}, "key": "", "headers": {"key":"YmxhYmxhYmxh"}}, "providerId":"test-provider-id"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := tt.config.MarshalJSONTemplate()
			assert.NoError(t, err)
			assert.Equal(t, tt.wantPattern, result)
		})
	}
}

func TestKafkaPublishDataSource_Load(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		mockSetup       func(*MockAdapter)
		expectError     bool
		expectedOutput  string
		expectPublished bool
	}{
		{
			name:  "successful publish",
			input: `{"topic":"test-topic", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishEventConfiguration) bool {
					return event.ProviderID() == "test-provider" &&
						event.Topic == "test-topic" &&
						string(event.Event.Data) == `{"message":"hello"}`
				})).Return(nil)
			},
			expectError:     false,
			expectedOutput:  `{"success": true}`,
			expectPublished: true,
		},
		{
			name:  "publish error",
			input: `{"topic":"test-topic", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Publish", mock.Anything, mock.Anything).Return(errors.New("publish error"))
			},
			expectError:     false, // The Load method doesn't return the publish error directly
			expectedOutput:  `{"success": false}`,
			expectPublished: true,
		},
		{
			name:            "invalid input json",
			input:           `{"invalid json":`,
			mockSetup:       func(m *MockAdapter) {},
			expectError:     true,
			expectPublished: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := NewMockAdapter(t)
			tt.mockSetup(mockAdapter)

			dataSource := &PublishDataSource{
				pubSub: mockAdapter,
			}
			ctx := context.Background()
			input := []byte(tt.input)
			out := &bytes.Buffer{}

			err := dataSource.Load(ctx, input, out)

			if tt.expectError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.expectedOutput, out.String())
			}
		})
	}
}

func TestKafkaPublishDataSource_LoadWithFiles(t *testing.T) {
	t.Run("panic on not implemented", func(t *testing.T) {
		dataSource := &PublishDataSource{
			pubSub: NewMockAdapter(t),
		}

		assert.Panics(t, func() {
			dataSource.LoadWithFiles(context.Background(), nil, nil, &bytes.Buffer{})
		})
	})
}
