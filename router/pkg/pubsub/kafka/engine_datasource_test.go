package kafka

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
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
				ProviderID: "test-provider",
				Topic:      "test-topic",
				Data:       json.RawMessage(`{"message":"hello"}`),
			},
			wantPattern: `{"topic":"test-topic", "data": {"message":"hello"}, "providerId":"test-provider"}`,
		},
		{
			name: "with special characters",
			config: PublishEventConfiguration{
				ProviderID: "test-provider-id",
				Topic:      "topic-with-hyphens",
				Data:       json.RawMessage(`{"message":"special \"quotes\" here"}`),
			},
			wantPattern: `{"topic":"topic-with-hyphens", "data": {"message":"special \"quotes\" here"}, "providerId":"test-provider-id"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.MarshalJSONTemplate()
			assert.Equal(t, tt.wantPattern, result)
		})
	}
}

func TestSubscriptionSource_UniqueRequestID(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectError   bool
		expectedError error
	}{
		{
			name:        "valid input",
			input:       `{"topics":["topic1", "topic2"], "providerId":"test-provider"}`,
			expectError: false,
		},
		{
			name:          "missing topics",
			input:         `{"providerId":"test-provider"}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
		{
			name:          "missing providerId",
			input:         `{"topics":["topic1", "topic2"]}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source := &SubscriptionDataSource{
				pubSub: NewMockAdapter(t),
			}
			ctx := &resolve.Context{}
			input := []byte(tt.input)
			xxh := xxhash.New()

			err := source.UniqueRequestID(ctx, input, xxh)

			if tt.expectError {
				require.Error(t, err)
				if tt.expectedError != nil {
					// For jsonparser errors, just check if the error message contains the expected text
					assert.Contains(t, err.Error(), tt.expectedError.Error())
				}
			} else {
				require.NoError(t, err)
				// Check that the hash has been updated
				assert.NotEqual(t, 0, xxh.Sum64())
			}
		})
	}
}

func TestSubscriptionSource_Start(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		mockSetup   func(*MockAdapter, *datasource.MockSubscriptionUpdater)
		expectError bool
	}{
		{
			name:  "successful subscription",
			input: `{"topics":["topic1", "topic2"], "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter, updater *datasource.MockSubscriptionUpdater) {
				m.On("Subscribe", mock.Anything, SubscriptionEventConfiguration{
					ProviderID: "test-provider",
					Topics:     []string{"topic1", "topic2"},
				}, mock.Anything).Return(nil)
			},
			expectError: false,
		},
		{
			name:  "adapter returns error",
			input: `{"topics":["topic1"], "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter, updater *datasource.MockSubscriptionUpdater) {
				m.On("Subscribe", mock.Anything, SubscriptionEventConfiguration{
					ProviderID: "test-provider",
					Topics:     []string{"topic1"},
				}, mock.Anything).Return(errors.New("subscription error"))
			},
			expectError: true,
		},
		{
			name:        "invalid input json",
			input:       `{"invalid json":`,
			mockSetup:   func(m *MockAdapter, updater *datasource.MockSubscriptionUpdater) {},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := NewMockAdapter(t)
			updater := datasource.NewMockSubscriptionUpdater(t)
			tt.mockSetup(mockAdapter, updater)

			source := &SubscriptionDataSource{
				pubSub: mockAdapter,
			}

			// Set up go context
			goCtx := context.Background()

			// Create a resolve.Context with the standard context
			resolveCtx := &resolve.Context{}
			resolveCtx = resolveCtx.WithContext(goCtx)

			input := []byte(tt.input)
			err := source.Start(resolveCtx, input, updater)

			if tt.expectError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
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
			input: `{"topic":"test-topic", "data":{"message":"hello"}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishEventConfiguration) bool {
					return event.ProviderID == "test-provider" &&
						event.Topic == "test-topic" &&
						string(event.Data) == `{"message":"hello"}`
				})).Return(nil)
			},
			expectError:     false,
			expectedOutput:  `{"success": true}`,
			expectPublished: true,
		},
		{
			name:  "publish error",
			input: `{"topic":"test-topic", "data":{"message":"hello"}, "providerId":"test-provider"}`,
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
