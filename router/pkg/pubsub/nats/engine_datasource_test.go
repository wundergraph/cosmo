package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

func TestPublishAndRequestEventConfiguration_MarshalJSONTemplate(t *testing.T) {
	tests := []struct {
		name        string
		config      publishData
		wantPattern string
	}{
		{
			name: "simple configuration",
			config: publishData{
				Provider:  "test-provider",
				Subject:   "test-subject",
				Event:     Event{Data: json.RawMessage(`{"message":"hello"}`)},
				FieldName: "test-field",
			},
			wantPattern: `{"subject":"test-subject", "event": {"data": {"message":"hello"}}, "providerId":"test-provider", "rootFieldName":"test-field"}`,
		},
		{
			name: "with special characters",
			config: publishData{
				Provider:  "test-provider-id",
				Subject:   "subject-with-hyphens",
				Event:     Event{Data: json.RawMessage(`{"message":"special \"quotes\" here"}`)},
				FieldName: "test-field",
			},
			wantPattern: `{"subject":"subject-with-hyphens", "event": {"data": {"message":"special \"quotes\" here"}}, "providerId":"test-provider-id", "rootFieldName":"test-field"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := tt.config.MarshalJSONTemplate()
			assert.NoError(t, err)
			assert.Equal(t, tt.wantPattern, string(result))
		})
	}
}

func TestPublishData_PublishEventConfiguration(t *testing.T) {
	data := publishData{
		Provider:  "test-provider",
		Subject:   "test-subject",
		FieldName: "test-field",
	}

	evtCfg := &PublishAndRequestEventConfiguration{
		Provider:  data.Provider,
		Subject:   data.Subject,
		FieldName: data.FieldName,
	}

	assert.Equal(t, evtCfg, data.PublishEventConfiguration())
}

func TestNatsPublishDataSource_Load(t *testing.T) {
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
			input: `{"subject":"test-subject", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Publish", mock.Anything, mock.MatchedBy(func(event *PublishAndRequestEventConfiguration) bool {
					return event.ProviderID() == "test-provider" &&
						event.Subject == "test-subject"
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
			input: `{"subject":"test-subject", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Publish", mock.Anything, mock.Anything, mock.Anything).Return(errors.New("publish error"))
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

			dataSource := &NatsPublishDataSource{
				pubSub: mockAdapter,
			}

			ctx := context.Background()
			input := []byte(tt.input)
			var out bytes.Buffer

			err := dataSource.Load(ctx, input, &out)

			if tt.expectError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				if tt.expectedOutput != "" {
					assert.Equal(t, tt.expectedOutput, out.String())
				}
			}
		})
	}
}

func TestNatsPublishDataSource_LoadWithFiles(t *testing.T) {
	dataSource := &NatsPublishDataSource{}
	assert.Panics(t, func() {
		dataSource.LoadWithFiles(context.Background(), []byte{}, nil, &bytes.Buffer{})
	}, "Expected LoadWithFiles to panic with 'not implemented'")
}

func TestNatsRequestDataSource_Load(t *testing.T) {
	tests := []struct {
		name           string
		input          string
		mockSetup      func(*MockAdapter)
		expectError    bool
		expectedOutput string
	}{
		{
			name:  "successful request",
			input: `{"subject":"test-subject", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Request", mock.Anything, mock.MatchedBy(func(event *PublishAndRequestEventConfiguration) bool {
					return event.ProviderID() == "test-provider" &&
						event.Subject == "test-subject"
				}), mock.MatchedBy(func(event datasource.StreamEvent) bool {
					return event != nil && strings.EqualFold(string(event.GetData()), `{"message":"hello"}`)
				}), mock.Anything).Run(func(args mock.Arguments) {
					// Write response to the output buffer
					w := args.Get(3).(io.Writer)
					_, _ = w.Write([]byte(`{"response":"success"}`))
				}).Return(nil)
			},
			expectError:    false,
			expectedOutput: `{"response":"success"}`,
		},
		{
			name:  "request error",
			input: `{"subject":"test-subject", "event": {"data":{"message":"hello"}}, "providerId":"test-provider"}`,
			mockSetup: func(m *MockAdapter) {
				m.On("Request", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(errors.New("request error"))
			},
			expectError:    true,
			expectedOutput: "",
		},
		{
			name:           "invalid input json",
			input:          `{"invalid json":`,
			mockSetup:      func(m *MockAdapter) {},
			expectError:    true,
			expectedOutput: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := NewMockAdapter(t)
			provider := datasource.NewPubSubProvider("test-provider", "nats", mockAdapter, zap.NewNop(), testNatsEventBuilder)
			tt.mockSetup(mockAdapter)

			dataSource := &NatsRequestDataSource{
				pubSub: provider,
			}

			ctx := context.Background()
			input := []byte(tt.input)
			var out bytes.Buffer

			err := dataSource.Load(ctx, input, &out)

			if tt.expectError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				if tt.expectedOutput != "" {
					assert.Equal(t, tt.expectedOutput, out.String())
				}
			}
		})
	}
}

func TestNatsRequestDataSource_LoadWithFiles(t *testing.T) {
	dataSource := &NatsRequestDataSource{}
	assert.Panics(t, func() {
		dataSource.LoadWithFiles(context.Background(), []byte{}, nil, &bytes.Buffer{})
	}, "Expected LoadWithFiles to panic with 'not implemented'")
}
