package redis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
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
				Provider: "test-provider",
				Channel:  "test-channel",
				Event:    Event{Data: json.RawMessage(`{"message":"hello"}`)},
			},
			wantPattern: `{"channel":"test-channel", "event": {"data": {"message":"hello"}}, "providerId":"test-provider"}`,
		},
		{
			name: "with special characters",
			config: PublishEventConfiguration{
				Provider: "test-provider-id",
				Channel:  "channel-with-hyphens",
				Event:    Event{Data: json.RawMessage(`{"message":"special \"quotes\" here"}`)},
			},
			wantPattern: `{"channel":"channel-with-hyphens", "event": {"data": {"message":"special \"quotes\" here"}}, "providerId":"test-provider-id"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := tt.config.MarshalJSONTemplate()
			require.NoError(t, err)
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
			input:       `{"channels":["channel1", "channel2"], "providerId":"test-provider"}`,
			expectError: false,
		},
		{
			name:          "missing channels",
			input:         `{"providerId":"test-provider"}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
		{
			name:          "missing providerId",
			input:         `{"channels":["channel1", "channel2"]}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source := &SubscriptionDataSource{
				pubSub: datasource.NewMockProvider(t),
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
		mockSetup   func(*datasource.MockProvider, *datasource.MockSubscriptionEventUpdater)
		expectError bool
	}{
		{
			name:  "successful subscription",
			input: `{"channels":["channel1", "channel2"], "providerId":"test-provider"}`,
			mockSetup: func(m *datasource.MockProvider, updater *datasource.MockSubscriptionEventUpdater) {
				m.On("Subscribe", mock.Anything, &SubscriptionEventConfiguration{
					Provider: "test-provider",
					Channels: []string{"channel1", "channel2"},
				}, mock.Anything).Return(nil)
			},
			expectError: false,
		},
		{
			name:  "adapter returns error",
			input: `{"channels":["channel1"], "providerId":"test-provider"}`,
			mockSetup: func(m *datasource.MockProvider, updater *datasource.MockSubscriptionEventUpdater) {
				m.On("Subscribe", mock.Anything, &SubscriptionEventConfiguration{
					Provider: "test-provider",
					Channels: []string{"channel1"},
				}, mock.Anything).Return(errors.New("subscription error"))
			},
			expectError: true,
		},
		{
			name:        "invalid input json",
			input:       `{"invalid json":`,
			mockSetup:   func(m *datasource.MockProvider, updater *datasource.MockSubscriptionEventUpdater) {},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := datasource.NewMockProvider(t)
			updater := datasource.NewMockSubscriptionEventUpdater(t)
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

func TestRedisPublishDataSource_Load(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		mockSetup       func(*datasource.MockProvider)
		expectError     bool
		expectedOutput  string
		expectPublished bool
	}{
		{
			name:  "successful publish",
			input: `{"channel":"test-channel", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *datasource.MockProvider) {
				m.On("Publish", mock.Anything, mock.MatchedBy(func(event *PublishEventConfiguration) bool {
					return event.ProviderID() == "test-provider" &&
						event.Channel == "test-channel" &&
						string(event.Event.Data) == `{"message":"hello"}`
				}), mock.MatchedBy(func(events []datasource.StreamEvent) bool {
					return len(events) == 1 && strings.EqualFold(string(events[0].GetData()), `{"message":"hello"}`)
				})).Return(nil)
			},
			expectError:     false,
			expectedOutput:  `{"success": true}`,
			expectPublished: true,
		},
		{
			name:  "publish error",
			input: `{"channel":"test-channel", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *datasource.MockProvider) {
				m.On("Publish", mock.Anything, mock.Anything, mock.Anything).Return(errors.New("publish error"))
			},
			expectError:     false, // The Load method doesn't return the publish error directly
			expectedOutput:  `{"success": false}`,
			expectPublished: true,
		},
		{
			name:            "invalid input json",
			input:           `{"invalid json":`,
			mockSetup:       func(m *datasource.MockProvider) {},
			expectError:     true,
			expectPublished: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := datasource.NewMockProvider(t)
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

func TestRedisPublishDataSource_LoadWithFiles(t *testing.T) {
	t.Run("panic on not implemented", func(t *testing.T) {
		dataSource := &PublishDataSource{
			pubSub: datasource.NewMockProvider(t),
		}

		assert.Panics(t, func() {
			dataSource.LoadWithFiles(context.Background(), nil, nil, &bytes.Buffer{})
		})
	})
}
