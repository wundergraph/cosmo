package core

import (
	"errors"
	"net/http"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

func TestBuildRetryFunction(t *testing.T) {
	logger := zap.NewNop()

	t.Run("default expression behavior", func(t *testing.T) {
		// Use the default expression that would be in the config
		fn, err := BuildRetryFunction(DefaultRetryExpression, logger)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Test default behavior - should retry on 500
		req, _ := http.NewRequest("GET", "http://example.com", nil)
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		// Should not retry on 200
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))

		// Note: Testing mutation behavior would require setting up a proper request context
		// which is beyond the scope of this unit test. The mutation check is tested
		// in integration tests.

		// Test with errors - only expression-defined errors are handled here
		req, _ = http.NewRequest("GET", "http://example.com", nil)
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil))
		assert.True(t, fn(errors.New("connection refused"), req, nil))
		assert.False(t, fn(errors.New("unexpected EOF"), req, nil)) // EOF is now handled at transport layer, not expression
		assert.False(t, fn(errors.New("some other error"), req, nil))
	})

	t.Run("expression-based retry", func(t *testing.T) {
		expression := "statusCode == 500 || statusCode == 503"
		fn, err := BuildRetryFunction(expression, logger)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		req, _ := http.NewRequest("GET", "http://example.com", nil)

		// Should retry on 500
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		// Should retry on 503
		resp.StatusCode = 503
		assert.True(t, fn(nil, req, resp))

		// Should not retry on 502
		resp.StatusCode = 502
		assert.False(t, fn(nil, req, resp))
	})

	t.Run("expression with error conditions", func(t *testing.T) {
		expression := "IsTimeout() || statusCode == 503"
		fn, err := BuildRetryFunction(expression, logger)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		req, _ := http.NewRequest("GET", "http://example.com", nil)

		// Should retry on timeout error
		err = syscall.ETIMEDOUT
		assert.True(t, fn(err, req, nil))

		// Should retry on 503
		resp := &http.Response{StatusCode: 503}
		assert.True(t, fn(nil, req, resp))

		// Should not retry on other errors
		err = errors.New("some other error")
		assert.False(t, fn(err, req, nil))
	})

	t.Run("invalid expression returns error", func(t *testing.T) {
		expression := "invalid syntax +++"
		fn, err := BuildRetryFunction(expression, logger)
		assert.Error(t, err)
		assert.Nil(t, fn)
		assert.Contains(t, err.Error(), "failed to compile retry expression")
	})

	t.Run("empty expression uses default", func(t *testing.T) {
		fn, err := BuildRetryFunction("", logger)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Test with retryable status code
		req, _ := http.NewRequest("GET", "http://example.com", nil)
		resp := &http.Response{StatusCode: 502}
		assert.True(t, fn(nil, req, resp))

		// Test with connection error
		err = errors.New("connection refused")
		assert.True(t, fn(err, req, nil))

		// Test with timeout error
		err = syscall.ETIMEDOUT
		assert.True(t, fn(err, req, nil))

		// Test with non-retryable error
		err = errors.New("some other error")
		assert.False(t, fn(err, req, nil))
	})

	t.Run("expression that always returns true", func(t *testing.T) {
		expression := "true" // Always retry
		fn, err := BuildRetryFunction(expression, logger)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		req, _ := http.NewRequest("GET", "http://example.com", nil)
		resp := &http.Response{StatusCode: 500}

		// Should retry when expression is true
		assert.True(t, fn(nil, req, resp))

		// Even for status codes that wouldn't normally retry
		resp.StatusCode = 200
		assert.True(t, fn(nil, req, resp))
	})

	t.Run("complex expression", func(t *testing.T) {
		expression := "(statusCode >= 500 && statusCode < 600) || IsConnectionError()"
		fn, err := BuildRetryFunction(expression, logger)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		req, _ := http.NewRequest("GET", "http://example.com", nil)

		// Test 5xx errors
		resp := &http.Response{StatusCode: 503}
		assert.True(t, fn(nil, req, resp))

		// Test connection error
		err = errors.New("connection refused")
		assert.True(t, fn(err, req, nil))

		// Test non-matching conditions
		resp.StatusCode = 404
		err = errors.New("some other error")
		assert.False(t, fn(err, req, resp))
	})
}
