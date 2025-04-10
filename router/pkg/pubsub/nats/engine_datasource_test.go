package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// EngineDataSourceMockAdapter is a mock implementation of AdapterInterface for testing
type EngineDataSourceMockAdapter struct {
	mock.Mock
}

func (m *EngineDataSourceMockAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	args := m.Called(ctx, event, updater)
	return args.Error(0)
}

func (m *EngineDataSourceMockAdapter) Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *EngineDataSourceMockAdapter) Request(ctx context.Context, event PublishAndRequestEventConfiguration, w io.Writer) error {
	args := m.Called(ctx, event, w)
	return args.Error(0)
}

func (m *EngineDataSourceMockAdapter) Shutdown(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

// MockSubscriptionUpdater implements resolve.SubscriptionUpdater
type MockSubscriptionUpdater struct {
	mock.Mock
}

func (m *MockSubscriptionUpdater) Update(data []byte) {
	m.Called(data)
}

func (m *MockSubscriptionUpdater) Done() {
	m.Called()
}

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
				Subject:    "test-subject",
				Data:       json.RawMessage(`{"message":"hello"}`),
			},
			wantPattern: `{"subject":"test-subject", "data": {"message":"hello"}, "providerId":"test-provider"}`,
		},
		{
			name: "with special characters",
			config: PublishEventConfiguration{
				ProviderID: "test-provider-id",
				Subject:    "subject-with-hyphens",
				Data:       json.RawMessage(`{"message":"special \"quotes\" here"}`),
			},
			wantPattern: `{"subject":"subject-with-hyphens", "data": {"message":"special \"quotes\" here"}, "providerId":"test-provider-id"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.MarshalJSONTemplate()
			assert.Equal(t, tt.wantPattern, result)
		})
	}
}

func TestPublishAndRequestEventConfiguration_MarshalJSONTemplate(t *testing.T) {
	tests := []struct {
		name        string
		config      PublishAndRequestEventConfiguration
		wantPattern string
	}{
		{
			name: "simple configuration",
			config: PublishAndRequestEventConfiguration{
				ProviderID: "test-provider",
				Subject:    "test-subject",
				Data:       json.RawMessage(`{"message":"hello"}`),
			},
			wantPattern: `{"subject":"test-subject", "data": {"message":"hello"}, "providerId":"test-provider"}`,
		},
		{
			name: "with special characters",
			config: PublishAndRequestEventConfiguration{
				ProviderID: "test-provider-id",
				Subject:    "subject-with-hyphens",
				Data:       json.RawMessage(`{"message":"special \"quotes\" here"}`),
			},
			wantPattern: `{"subject":"subject-with-hyphens", "data": {"message":"special \"quotes\" here"}, "providerId":"test-provider-id"}`,
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
			input:       `{"subjects":["subject1", "subject2"], "providerId":"test-provider"}`,
			expectError: false,
		},
		{
			name:          "missing subjects",
			input:         `{"providerId":"test-provider"}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
		{
			name:          "missing providerId",
			input:         `{"subjects":["subject1", "subject2"]}`,
			expectError:   true,
			expectedError: errors.New("Key path not found"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source := &SubscriptionSource{
				pubSub: &EngineDataSourceMockAdapter{},
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
		mockSetup   func(*EngineDataSourceMockAdapter)
		expectError bool
	}{
		{
			name:  "successful subscription",
			input: `{"subjects":["subject1", "subject2"], "providerId":"test-provider"}`,
			mockSetup: func(m *EngineDataSourceMockAdapter) {
				m.On("Subscribe", mock.Anything, SubscriptionEventConfiguration{
					ProviderID: "test-provider",
					Subjects:   []string{"subject1", "subject2"},
				}, mock.Anything).Return(nil)
			},
			expectError: false,
		},
		{
			name:  "adapter returns error",
			input: `{"subjects":["subject1"], "providerId":"test-provider"}`,
			mockSetup: func(m *EngineDataSourceMockAdapter) {
				m.On("Subscribe", mock.Anything, SubscriptionEventConfiguration{
					ProviderID: "test-provider",
					Subjects:   []string{"subject1"},
				}, mock.Anything).Return(errors.New("subscription error"))
			},
			expectError: true,
		},
		{
			name:        "invalid input json",
			input:       `{"invalid json":`,
			mockSetup:   func(m *EngineDataSourceMockAdapter) {},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := new(EngineDataSourceMockAdapter)
			tt.mockSetup(mockAdapter)

			source := &SubscriptionSource{
				pubSub: mockAdapter,
			}

			// Set up go context
			goCtx := context.Background()

			// Create a resolve.Context with the standard context
			resolveCtx := &resolve.Context{}
			resolveCtx = resolveCtx.WithContext(goCtx)

			// Create a proper mock updater
			updater := new(MockSubscriptionUpdater)
			updater.On("Done").Return()

			input := []byte(tt.input)
			err := source.Start(resolveCtx, input, updater)

			if tt.expectError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			mockAdapter.AssertExpectations(t)
		})
	}
}

func TestNatsPublishDataSource_Load(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		mockSetup       func(*EngineDataSourceMockAdapter)
		expectError     bool
		expectedOutput  string
		expectPublished bool
	}{
		{
			name:  "successful publish",
			input: `{"subject":"test-subject", "data":{"message":"hello"}, "providerId":"test-provider"}`,
			mockSetup: func(m *EngineDataSourceMockAdapter) {
				m.On("Publish", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
					return event.ProviderID == "test-provider" &&
						event.Subject == "test-subject" &&
						string(event.Data) == `{"message":"hello"}`
				})).Return(nil)
			},
			expectError:     false,
			expectedOutput:  `{"success": true}`,
			expectPublished: true,
		},
		{
			name:  "publish error",
			input: `{"subject":"test-subject", "data":{"message":"hello"}, "providerId":"test-provider"}`,
			mockSetup: func(m *EngineDataSourceMockAdapter) {
				m.On("Publish", mock.Anything, mock.Anything).Return(errors.New("publish error"))
			},
			expectError:     false, // The Load method doesn't return the publish error directly
			expectedOutput:  `{"success": false}`,
			expectPublished: true,
		},
		{
			name:            "invalid input json",
			input:           `{"invalid json":`,
			mockSetup:       func(m *EngineDataSourceMockAdapter) {},
			expectError:     true,
			expectPublished: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := new(EngineDataSourceMockAdapter)
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
				if tt.expectPublished {
					mockAdapter.AssertExpectations(t)
				}
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
		mockSetup      func(*EngineDataSourceMockAdapter)
		expectError    bool
		expectedOutput string
	}{
		{
			name:  "successful request",
			input: `{"subject":"test-subject", "data":{"message":"hello"}, "providerId":"test-provider"}`,
			mockSetup: func(m *EngineDataSourceMockAdapter) {
				m.On("Request", mock.Anything, mock.MatchedBy(func(event PublishAndRequestEventConfiguration) bool {
					return event.ProviderID == "test-provider" &&
						event.Subject == "test-subject" &&
						string(event.Data) == `{"message":"hello"}`
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
			input: `{"subject":"test-subject", "data":{"message":"hello"}, "providerId":"test-provider"}`,
			mockSetup: func(m *EngineDataSourceMockAdapter) {
				m.On("Request", mock.Anything, mock.Anything, mock.Anything).Return(errors.New("request error"))
			},
			expectError:    true,
			expectedOutput: "",
		},
		{
			name:           "invalid input json",
			input:          `{"invalid json":`,
			mockSetup:      func(m *EngineDataSourceMockAdapter) {},
			expectError:    true,
			expectedOutput: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAdapter := new(EngineDataSourceMockAdapter)
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
				mockAdapter.AssertExpectations(t)
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
