package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestPublishAndRequestEventConfiguration_MarshalJSONTemplate(t *testing.T) {
	tests := []struct {
		name        string
		config      PublishAndRequestEventConfiguration
		wantPattern string
	}{
		{
			name: "simple configuration",
			config: PublishAndRequestEventConfiguration{
				Provider: "test-provider",
				Subject:  "test-subject",
				Event:    Event{Data: json.RawMessage(`{"message":"hello"}`)},
			},
			wantPattern: `{"subject":"test-subject", "event": {"data": {"message":"hello"}}, "providerId":"test-provider"}`,
		},
		{
			name: "with special characters",
			config: PublishAndRequestEventConfiguration{
				Provider: "test-provider-id",
				Subject:  "subject-with-hyphens",
				Event:    Event{Data: json.RawMessage(`{"message":"special \"quotes\" here"}`)},
			},
			wantPattern: `{"subject":"subject-with-hyphens", "event": {"data": {"message":"special \"quotes\" here"}}, "providerId":"test-provider-id"}`,
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
				m.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
					return event.ProviderID() == "test-provider" &&
						event.Subject == "test-subject" &&
						string(event.Event.Data) == `{"message":"hello"}`
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
				m.On("Request", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
					return event.ProviderID() == "test-provider" &&
						event.Subject == "test-subject" &&
						string(event.Event.Data) == `{"message":"hello"}`
				}), mock.Anything).Run(func(args mock.Arguments) {
					// Write response to the output buffer
					w := args.Get(2).(io.Writer)
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
				m.On("Request", mock.Anything, mock.Anything, mock.Anything).Return(errors.New("request error"))
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
			tt.mockSetup(mockAdapter)

			dataSource := &NatsRequestDataSource{
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

func TestNatsRequestDataSource_LoadWithFiles(t *testing.T) {
	dataSource := &NatsRequestDataSource{}
	assert.Panics(t, func() {
		dataSource.LoadWithFiles(context.Background(), []byte{}, nil, &bytes.Buffer{})
	}, "Expected LoadWithFiles to panic with 'not implemented'")
}
