package expr

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRetryExpressionManager(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		ctx        RetryContext
		expected   bool
		expectErr  bool
	}{
		{
			name:       "status code exact match",
			expression: "statusCode == 500",
			ctx:        RetryContext{StatusCode: 500},
			expected:   true,
		},
		{
			name:       "status code no match",
			expression: "statusCode == 500",
			ctx:        RetryContext{StatusCode: 200},
			expected:   false,
		},
		{
			name:       "OR condition - first true",
			expression: "statusCode == 500 || statusCode == 502",
			ctx:        RetryContext{StatusCode: 500},
			expected:   true,
		},
		{
			name:       "OR condition - second true",
			expression: "statusCode == 500 || statusCode == 502",
			ctx:        RetryContext{StatusCode: 502},
			expected:   true,
		},
		{
			name:       "OR condition - both false",
			expression: "statusCode == 500 || statusCode == 502",
			ctx:        RetryContext{StatusCode: 200},
			expected:   false,
		},
		{
			name:       "IsHttpReadTimeout helper function",
			expression: "IsHttpReadTimeout()",
			ctx:        RetryContext{Error: "timeout awaiting response headers"},
			expected:   true,
		},
		{
			name:       "IsHttpReadTimeout with different error",
			expression: "IsHttpReadTimeout()",
			ctx:        RetryContext{Error: "connection refused"},
			expected:   false,
		},
		{
			name:       "IsTimeout helper function",
			expression: "IsTimeout()",
			ctx:        LoadRetryContext(&mockTimeoutError{msg: "net timeout", timeout: true}, nil),
			expected:   true,
		},
		{
			name:       "IsTimeout helper function wrapped",
			expression: "IsTimeout()",
			ctx: LoadRetryContext(
				fmt.Errorf("wrapped error: %w", &mockTimeoutError{msg: "net timeout", timeout: true}), nil),
			expected: true,
		},
		{
			name:       "complex expression with helpers",
			expression: "statusCode == 500 || IsTimeout()",
			ctx:        LoadRetryContext(&mockTimeoutError{msg: "net timeout", timeout: true}, &http.Response{StatusCode: 200}),
			expected:   true,
		},
		{
			name:       "is5xxError helper",
			expression: "Is5xxError()",
			ctx:        RetryContext{StatusCode: 503},
			expected:   true,
		},
		{
			name:       "is5xxError with non-5xx",
			expression: "Is5xxError()",
			ctx:        RetryContext{StatusCode: 404},
			expected:   false,
		},
		{
			name:       "isConnectionError helper",
			expression: "IsConnectionError()",
			ctx:        RetryContext{Error: "connection refused"},
			expected:   true,
		},

		{
			name:       "isRetryableStatusCode helper",
			expression: "IsRetryableStatusCode()",
			ctx:        RetryContext{StatusCode: 429},
			expected:   false,
		},
		{
			name:       "range check",
			expression: "statusCode >= 500 && statusCode < 600",
			ctx:        RetryContext{StatusCode: 503},
			expected:   true,
		},
		{
			name:       "error string contains",
			expression: `error contains "timeout"`,
			ctx:        RetryContext{Error: "request timeout occurred"},
			expected:   true,
		},
		{
			name:       "error string exact match",
			expression: `error == "connection refused"`,
			ctx:        RetryContext{Error: "connection refused"},
			expected:   true,
		},
		{
			name:       "invalid expression",
			expression: "invalid syntax +++",
			expectErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			manager, err := NewRetryExpressionManager(tt.expression)
			if tt.expectErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, manager)

			result, err := manager.ShouldRetry(tt.ctx)
			assert.NoError(t, err)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestRetryExpressionManager_EmptyExpression(t *testing.T) {
	manager, err := NewRetryExpressionManager("")
	assert.NoError(t, err)
	assert.Nil(t, manager)
}

func TestLoadRetryContext(t *testing.T) {
	t.Run("with error and response", func(t *testing.T) {
		err := errors.New("connection timeout")
		resp := &http.Response{StatusCode: 500}

		ctx := LoadRetryContext(err, resp)

		assert.Equal(t, "connection timeout", ctx.Error)
		assert.Equal(t, 500, ctx.StatusCode)
	})

	t.Run("with only error", func(t *testing.T) {
		err := errors.New("network error")

		ctx := LoadRetryContext(err, nil)

		assert.Equal(t, "network error", ctx.Error)
		assert.Equal(t, 0, ctx.StatusCode)
	})

	t.Run("with only response", func(t *testing.T) {
		resp := &http.Response{StatusCode: 503}

		ctx := LoadRetryContext(nil, resp)

		assert.Equal(t, "", ctx.Error)
		assert.Equal(t, 503, ctx.StatusCode)
	})

	t.Run("with neither error nor response", func(t *testing.T) {
		ctx := LoadRetryContext(nil, nil)

		assert.Equal(t, "", ctx.Error)
		assert.Equal(t, 0, ctx.StatusCode)
	})
}

func TestRetryContext_SyscallErrorDetection(t *testing.T) {
	t.Run("IsConnectionRefused", func(t *testing.T) {
		tests := []struct {
			name     string
			err      error
			expected bool
		}{
			{
				name:     "direct ECONNREFUSED",
				err:      syscall.ECONNREFUSED,
				expected: true,
			},
			{
				name:     "wrapped ECONNREFUSED",
				err:      fmt.Errorf("connection failed: %w", syscall.ECONNREFUSED),
				expected: true,
			},
			{
				name: "ECONNREFUSED in net.OpError",
				err: &net.OpError{
					Err: &os.SyscallError{
						Err: syscall.ECONNREFUSED,
					},
				},
				expected: true,
			},
			{
				name:     "string fallback - connection refused",
				err:      errors.New("connection refused"),
				expected: true,
			},
			{
				name:     "string fallback - mixed case",
				err:      errors.New("Connection Refused by server"),
				expected: true,
			},
			{
				name:     "different error",
				err:      syscall.ECONNRESET,
				expected: false,
			},
			{
				name:     "nil error",
				err:      nil,
				expected: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx := LoadRetryContext(tt.err, nil)
				result := ctx.IsConnectionRefused()
				assert.Equal(t, tt.expected, result)
			})
		}
	})

	t.Run("IsConnectionReset", func(t *testing.T) {
		tests := []struct {
			name     string
			err      error
			expected bool
		}{
			{
				name:     "direct ECONNRESET",
				err:      syscall.ECONNRESET,
				expected: true,
			},
			{
				name:     "wrapped ECONNRESET",
				err:      fmt.Errorf("network error: %w", syscall.ECONNRESET),
				expected: true,
			},
			{
				name: "ECONNRESET in net.OpError",
				err: &net.OpError{
					Err: &os.SyscallError{
						Err: syscall.ECONNRESET,
					},
				},
				expected: true,
			},
			{
				name:     "string fallback - connection reset",
				err:      errors.New("connection reset by peer"),
				expected: true,
			},
			{
				name:     "string fallback - mixed case",
				err:      errors.New("Connection Reset By Peer"),
				expected: true,
			},
			{
				name:     "different error",
				err:      syscall.ECONNREFUSED,
				expected: false,
			},
			{
				name:     "nil error",
				err:      nil,
				expected: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx := LoadRetryContext(tt.err, nil)
				result := ctx.IsConnectionReset()
				assert.Equal(t, tt.expected, result)
			})
		}
	})
}

func TestRetryContext_ImprovedErrorDetection(t *testing.T) {
	t.Run("IsConnectionError with syscall errors", func(t *testing.T) {
		tests := []struct {
			name     string
			err      error
			expected bool
		}{
			{
				name:     "ECONNREFUSED detected",
				err:      syscall.ECONNREFUSED,
				expected: true,
			},
			{
				name:     "ECONNRESET detected",
				err:      syscall.ECONNRESET,
				expected: true,
			},
			{
				name:     "wrapped ECONNREFUSED detected",
				err:      fmt.Errorf("dial error: %w", syscall.ECONNREFUSED),
				expected: true,
			},
			{
				name:     "string fallback still works",
				err:      errors.New("no such host"),
				expected: true,
			},
			{
				name:     "ETIMEDOUT not detected by IsConnectionError",
				err:      syscall.ETIMEDOUT,
				expected: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx := LoadRetryContext(tt.err, nil)
				result := ctx.IsConnectionError()
				assert.Equal(t, tt.expected, result)
			})
		}
	})

	t.Run("IsTimeout with syscall errors", func(t *testing.T) {
		tests := []struct {
			name     string
			err      error
			expected bool
		}{
			{
				name:     "ETIMEDOUT detected",
				err:      syscall.ETIMEDOUT,
				expected: true,
			},
			{
				name:     "wrapped ETIMEDOUT detected",
				err:      fmt.Errorf("read error: %w", syscall.ETIMEDOUT),
				expected: true,
			},
			{
				name: "ETIMEDOUT in net.OpError detected",
				err: &net.OpError{
					Err: &os.SyscallError{
						Err: syscall.ETIMEDOUT,
					},
				},
				expected: true,
			},
			{
				name:     "i/o timeout string not detected (no string matching)",
				err:      errors.New("i/o timeout"),
				expected: false,
			},
			{
				name:     "operation timed out string not detected (no string matching)",
				err:      errors.New("operation timed out"),
				expected: false,
			},
			{
				name:     "connection errors not detected by IsTimeout",
				err:      syscall.ECONNREFUSED,
				expected: false,
			},
			{
				name:     "deadline exceeded error should be detected as timeout",
				err:      os.ErrDeadlineExceeded,
				expected: true,
			},
			{
				name:     "HTTP read timeout detected by IsTimeout",
				err:      errors.New("timeout awaiting response headers"),
				expected: true,
			},
			{
				name:     "non-timeout error not detected",
				err:      errors.New("some other error"),
				expected: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx := LoadRetryContext(tt.err, nil)
				result := ctx.IsTimeout()
				assert.Equal(t, tt.expected, result)
			})
		}
	})

	t.Run("IsHttpReadTimeout with specific HTTP timeout", func(t *testing.T) {
		tests := []struct {
			name     string
			err      error
			expected bool
		}{
			{
				name:     "HTTP timeout awaiting response headers",
				err:      errors.New("timeout awaiting response headers"),
				expected: true,
			},
			{
				name:     "HTTP timeout awaiting response headers mixed case",
				err:      errors.New("Timeout Awaiting Response Headers"),
				expected: true,
			},
			{
				name:     "ETIMEDOUT not detected by IsHttpReadTimeout",
				err:      syscall.ETIMEDOUT,
				expected: false,
			},
			{
				name:     "nil error",
				err:      nil,
				expected: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx := LoadRetryContext(tt.err, nil)
				result := ctx.IsHttpReadTimeout()
				assert.Equal(t, tt.expected, result)
			})
		}
	})

	t.Run("IsTimeout with net timeout errors", func(t *testing.T) {
		// Mock net timeout error
		mockNetTimeoutErr := &mockTimeoutError{msg: "net timeout error", timeout: true}
		mockNetNonTimeoutErr := &mockTimeoutError{msg: "net regular error", timeout: false}

		tests := []struct {
			name     string
			err      error
			expected bool
		}{
			{
				name:     "net timeout error detected",
				err:      mockNetTimeoutErr,
				expected: true,
			},
			{
				name:     "net non-timeout error not detected",
				err:      mockNetNonTimeoutErr,
				expected: false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx := LoadRetryContext(tt.err, nil)
				result := ctx.IsTimeout()
				assert.Equal(t, tt.expected, result)
			})
		}
	})
}

// mockTimeoutError implements net.Error interface for testing
type mockTimeoutError struct {
	msg     string
	timeout bool
}

func (e *mockTimeoutError) Error() string {
	return e.msg
}

func (e *mockTimeoutError) Timeout() bool {
	return e.timeout
}

func (e *mockTimeoutError) Temporary() bool {
	return false // Not a temporary error for this test
}

func TestRetryExpressionManager_WithSyscallErrors(t *testing.T) {
	t.Run("expression with specific syscall error helpers", func(t *testing.T) {
		expression := "IsConnectionRefused() || IsConnectionReset() || IsTimeout()"
		manager, err := NewRetryExpressionManager(expression)
		require.NoError(t, err)
		require.NotNil(t, manager)

		// Test ECONNREFUSED
		ctx := LoadRetryContext(syscall.ECONNREFUSED, nil)
		result, err := manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.True(t, result)

		// Test ECONNRESET
		ctx = LoadRetryContext(syscall.ECONNRESET, nil)
		result, err = manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.True(t, result)

		// Test ETIMEDOUT
		ctx = LoadRetryContext(syscall.ETIMEDOUT, nil)
		result, err = manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.True(t, result)

		// Test unrelated error
		ctx = LoadRetryContext(errors.New("some other error"), nil)
		result, err = manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.False(t, result)
	})

	t.Run("expression combining status and syscall errors", func(t *testing.T) {
		expression := "statusCode == 500 || IsConnectionRefused()"
		manager, err := NewRetryExpressionManager(expression)
		require.NoError(t, err)
		require.NotNil(t, manager)

		// Test with status code
		ctx := LoadRetryContext(nil, &http.Response{StatusCode: 500})
		result, err := manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.True(t, result)

		// Test with syscall error
		ctx = LoadRetryContext(syscall.ECONNREFUSED, nil)
		result, err = manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.True(t, result)

		// Test with neither condition
		ctx = LoadRetryContext(nil, &http.Response{StatusCode: 200})
		result, err = manager.ShouldRetry(ctx)
		assert.NoError(t, err)
		assert.False(t, result)
	})
}
