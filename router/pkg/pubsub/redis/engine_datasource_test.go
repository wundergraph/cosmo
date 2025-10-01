package redis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

func TestPublishEventConfiguration_MarshalJSONTemplate(t *testing.T) {
	tests := []struct {
		name        string
		config      publishData
		wantPattern string
	}{
		{
			name: "simple configuration",
			config: publishData{
				Provider: "test-provider",
				Channel:  "test-channel",
				Event:    Event{Data: json.RawMessage(`{"message":"hello"}`)},
				FieldName: "test-field",
			},
			wantPattern: `{"channel":"test-channel", "event": {"data": {"message":"hello"}}, "providerId":"test-provider", "rootFieldName":"test-field"}`,
		},
		{
			name: "with special characters",
			config: publishData{
				Provider: "test-provider-id",
				Channel:  "channel-with-hyphens",
				Event:    Event{Data: json.RawMessage(`{"message":"special \"quotes\" here"}`)},
				FieldName: "test-field",
			},
			wantPattern: `{"channel":"channel-with-hyphens", "event": {"data": {"message":"special \"quotes\" here"}}, "providerId":"test-provider-id", "rootFieldName":"test-field"}`,
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

func TestPublishData_PublishEventConfiguration(t *testing.T) {
	data := publishData{
		Provider:  "test-provider",
		Channel:   "test-channel",
		FieldName: "test-field",
	}

	evtCfg := &PublishEventConfiguration{
		Provider:  data.Provider,
		Channel:   data.Channel,
		FieldName: data.FieldName,
	}

	assert.Equal(t, evtCfg, data.PublishEventConfiguration())
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
						event.Channel == "test-channel"
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
