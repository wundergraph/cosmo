package core

import (
	"errors"
	"fmt"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"io"
	"net/http"
	"reflect"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

// Helper functions for creating proper request contexts

func createOperationContext(opType string) *operationContext {
	return &operationContext{
		name:    "TestOperation",
		opType:  opType,
		hash:    12345,
		content: "test content",
	}
}

func createRequestWithContext(opType string) (*http.Request, *requestContext) {
	req, _ := http.NewRequest("POST", "http://example.com/graphql", nil)
	logger := zap.NewNop()

	// Create operation context
	operationCtx := createOperationContext(opType)

	// Create request context using the buildRequestContext function
	reqCtx := buildRequestContext(requestContextOptions{
		operationContext: operationCtx,
		requestLogger:    logger,
		metricsEnabled:   false,
		traceEnabled:     false,
		mapper:           &attributeMapper{},
		w:                nil,
		r:                req,
	})

	// Attach the request context to the Go context
	ctx := withRequestContext(req.Context(), reqCtx)
	req = req.WithContext(ctx)

	return req, reqCtx
}

func TestBuildRetryFunction(t *testing.T) {
	t.Run("build function when retry is disabled", func(t *testing.T) {
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    false,
			Expression: "invalid expression ++++++",
		})
		assert.NoError(t, err)
		assert.Equal(t,
			reflect.ValueOf(noopRetryFunc).Pointer(),
			reflect.ValueOf(fn).Pointer(),
		)
	})

	t.Run("default expression behavior", func(t *testing.T) {
		// Use the default expression that would be in the config
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: defaultRetryExpression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test default behavior - should retry on 500
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		// Should not retry on 200
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))

		// Test with errors - only expression-defined errors are handled here
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil))
		assert.True(t, fn(errors.New("connection refused"), req, nil))
		assert.True(t, fn(errors.New("unexpected EOF"), req, nil)) // EOF is now handled at transport layer, not expression
		assert.False(t, fn(errors.New("some other error"), req, nil))
	})

	t.Run("expression-based retry", func(t *testing.T) {
		expression := "statusCode == 500 || statusCode == 503"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

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
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

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
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.Error(t, err)
		assert.Nil(t, fn)
		assert.Contains(t, err.Error(), "failed to compile retry expression")
	})

	t.Run("empty expression uses default", func(t *testing.T) {
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: "",
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test with retryable status code
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

	t.Run("expression that always returns false but the error is an eof error", func(t *testing.T) {
		expression := "false" // Don't retry
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		assert.True(t, fn(io.ErrUnexpectedEOF, req, nil))
	})

	t.Run("expression that always returns true", func(t *testing.T) {
		expression := "true" // Always retry
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)
		resp := &http.Response{StatusCode: 500}

		// Should retry when expression is true
		assert.True(t, fn(nil, req, resp))

		// Even for status codes that wouldn't normally retry
		resp.StatusCode = 200
		assert.True(t, fn(nil, req, resp))
	})

	t.Run("complex expression", func(t *testing.T) {
		expression := "(statusCode >= 500 && statusCode < 600) || IsConnectionError()"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

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

	t.Run("mutation never retries with proper context", func(t *testing.T) {
		// Use expression that would normally retry on 500 errors
		expression := "statusCode >= 500 || IsTimeout() || IsConnectionError()"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with mutation context
		req, _ := createRequestWithContext(OperationTypeMutation)

		// Test with 500 status - should NOT retry because it's a mutation
		resp := &http.Response{StatusCode: 500}
		assert.False(t, fn(nil, req, resp))

		// Test with timeout error - should NOT retry because it's a mutation
		assert.False(t, fn(syscall.ETIMEDOUT, req, nil))

		// Test with connection error - should NOT retry because it's a mutation
		assert.False(t, fn(errors.New("connection refused"), req, nil))

		// Test with expression that always returns true - should still NOT retry
		alwaysRetryFn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: "true",
		})
		assert.NoError(t, err)
		assert.False(t, alwaysRetryFn(nil, req, resp))
	})

	t.Run("query retries with proper context", func(t *testing.T) {
		expression := "statusCode >= 500 || IsTimeout()"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test with 500 status - should retry because it's a query
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		// Test with timeout error - should retry because it's a query
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil))

		// Test with 200 status - should not retry even for query
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))
	})

	t.Run("subscription retries with proper context", func(t *testing.T) {
		expression := "statusCode >= 500"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with subscription context
		req, _ := createRequestWithContext(OperationTypeSubscription)

		// Test with 500 status - should retry because it's a subscription (not mutation)
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		// Test with 200 status - should not retry
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))
	})

	t.Run("error logging with proper context", func(t *testing.T) {
		// Test that error logging works with proper request context
		expression := "statusCode >= 500"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create request with proper context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test that it works normally with proper context
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))
	})

	t.Run("request context with query operation", func(t *testing.T) {
		expression := "statusCode >= 500"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Should work with proper request context - expression should be evaluated normally
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))

		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))
	})

	t.Run("complex expression with mutation context", func(t *testing.T) {
		// Complex expression that would normally retry in many cases
		expression := "(statusCode >= 500 && statusCode < 600) || IsConnectionError() || IsTimeout() || statusCode == 429"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with mutation context
		req, _ := createRequestWithContext(OperationTypeMutation)

		// Test various conditions that would normally trigger retry
		resp := &http.Response{StatusCode: 500}
		assert.False(t, fn(nil, req, resp))

		resp.StatusCode = 503
		assert.False(t, fn(nil, req, resp))

		resp.StatusCode = 429
		assert.False(t, fn(nil, req, resp))

		assert.False(t, fn(syscall.ETIMEDOUT, req, nil))
		assert.False(t, fn(errors.New("connection refused"), req, nil))
	})

	t.Run("new operation with comprehensive retry conditions", func(t *testing.T) {
		// Create a new comprehensive operation to test all retry scenarios
		expression := "statusCode >= 500 || statusCode == 429 || IsTimeout() || IsConnectionError()"
		fn, err := BuildRetryFunction(retrytransport.RetryOptions{
			Enabled:    true,
			Expression: expression,
		})
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Test query operation - should retry on all conditions
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test 5xx errors
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp))
		resp.StatusCode = 503
		assert.True(t, fn(nil, req, resp))

		// Test rate limiting
		resp.StatusCode = 429
		assert.True(t, fn(nil, req, resp))

		// Test timeouts
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil))

		// Test connection errors
		assert.True(t, fn(errors.New("connection refused"), req, nil))

		// Test success - should not retry
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp))

		// Test client errors - should not retry
		resp.StatusCode = 404
		assert.False(t, fn(nil, req, resp))

		// Now test the same conditions with a mutation - should never retry
		mutationReq, _ := createRequestWithContext(OperationTypeMutation)

		resp.StatusCode = 500
		assert.False(t, fn(nil, mutationReq, resp))
		resp.StatusCode = 503
		assert.False(t, fn(nil, mutationReq, resp))
		resp.StatusCode = 429
		assert.False(t, fn(nil, mutationReq, resp))
		assert.False(t, fn(syscall.ETIMEDOUT, mutationReq, nil))
		assert.False(t, fn(errors.New("connection refused"), mutationReq, nil))
	})
}

// This test is used to cross-check error detection behaviour
// from before the change and after the change
func TestRetriesForMigration(t *testing.T) {
	function, err := BuildRetryFunction(retrytransport.RetryOptions{
		Enabled:    true,
		Expression: defaultRetryExpression,
	})
	require.NoError(t, err)

	wrapperFunc := func(err error, resp *http.Response) bool {
		req, _ := createRequestWithContext(OperationTypeQuery)
		return function(err, req, resp)
	}

	t.Run("on syscall.ECONNREFUSED", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := syscall.ECONNREFUSED
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("failed to connect: %w", syscall.ECONNREFUSED)
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("layer5: %w",
				fmt.Errorf("layer4: %w",
					fmt.Errorf("layer3: %w",
						fmt.Errorf("layer2: %w",
							fmt.Errorf("layer1: %w", syscall.ECONNREFUSED)))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on syscall.ECONNRESET", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := syscall.ECONNRESET
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("connection lost: %w", syscall.ECONNRESET)
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("http client error: %w",
				fmt.Errorf("connection error: %w",
					fmt.Errorf("transport error: %w",
						fmt.Errorf("network error: %w",
							fmt.Errorf("system error: %w", syscall.ECONNRESET)))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on syscall.ETIMEDOUT", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := syscall.ETIMEDOUT
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("operation failed: %w", syscall.ETIMEDOUT)
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("request failed: %w",
				fmt.Errorf("client timeout: %w",
					fmt.Errorf("operation cancelled: %w",
						fmt.Errorf("deadline exceeded: %w",
							fmt.Errorf("system timeout: %w", syscall.ETIMEDOUT)))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on i/o timeout", func(t *testing.T) {
		t.Skip("The following tests don't work anymore, as we rely on the net.Error timeout interface now")

		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("i/o timeout")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("request failed: %w", errors.New("i/o timeout"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("http error: %w",
				fmt.Errorf("client error: %w",
					fmt.Errorf("transport error: %w",
						fmt.Errorf("connection error: %w",
							fmt.Errorf("io error: %w", errors.New("i/o timeout"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on no such host", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("no such host")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("dns lookup failed: %w", errors.New("no such host"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("request error: %w",
				fmt.Errorf("client error: %w",
					fmt.Errorf("dns error: %w",
						fmt.Errorf("lookup error: %w",
							fmt.Errorf("resolution error: %w", errors.New("no such host"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on handshake failure", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("handshake failure")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("tls error: %w", errors.New("handshake failure"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("connection error: %w",
				fmt.Errorf("tls error: %w",
					fmt.Errorf("crypto error: %w",
						fmt.Errorf("certificate error: %w",
							fmt.Errorf("validation error: %w", errors.New("handshake failure"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on handshake timeout", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("handshake timeout")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("tls error: %w", errors.New("handshake timeout"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("connection error: %w",
				fmt.Errorf("tls error: %w",
					fmt.Errorf("crypto error: %w",
						fmt.Errorf("certificate error: %w",
							fmt.Errorf("timing error: %w", errors.New("handshake timeout"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on timeout awaiting response headers", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("timeout awaiting response headers")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("request failed: %w", errors.New("timeout awaiting response headers"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("http error: %w",
				fmt.Errorf("client error: %w",
					fmt.Errorf("transport error: %w",
						fmt.Errorf("protocol error: %w",
							fmt.Errorf("response error: %w", errors.New("timeout awaiting response headers"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on unexpected EOF", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("unexpected EOF")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("read failed: %w", errors.New("unexpected EOF"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("http error: %w",
				fmt.Errorf("client error: %w",
					fmt.Errorf("transport error: %w",
						fmt.Errorf("stream error: %w",
							fmt.Errorf("read error: %w", errors.New("unexpected EOF"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on unexpected EOF reading trailer", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("unexpected EOF reading trailer")
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("read failed: %w", errors.New("unexpected EOF reading trailer"))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("http error: %w",
				fmt.Errorf("client error: %w",
					fmt.Errorf("transport error: %w",
						fmt.Errorf("stream error: %w",
							fmt.Errorf("trailer error: %w", errors.New("unexpected EOF reading trailer"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, true, result)
		})
	})

	t.Run("on non-retryable error", func(t *testing.T) {
		t.Run("unwrapped", func(t *testing.T) {
			err := errors.New("some random error")
			result := wrapperFunc(err, nil)
			require.Equal(t, false, result)
		})
		t.Run("wrapped", func(t *testing.T) {
			err := fmt.Errorf("operation failed: %w", errors.New("some random error"))
			result := wrapperFunc(err, nil)
			require.Equal(t, false, result)
		})
		t.Run("deeply nested", func(t *testing.T) {
			err := fmt.Errorf("application error: %w",
				fmt.Errorf("service error: %w",
					fmt.Errorf("handler error: %w",
						fmt.Errorf("processing error: %w",
							fmt.Errorf("validation error: %w", errors.New("some random error"))))))
			result := wrapperFunc(err, nil)
			require.Equal(t, false, result)
		})
	})

	// Test HTTP status code retries
	t.Run("on HTTP 429 Too Many Requests", func(t *testing.T) {
		t.Skip("Expected to fail as this is a known change")

		resp := &http.Response{StatusCode: http.StatusTooManyRequests}
		result := wrapperFunc(nil, resp)
		require.Equal(t, true, result)
	})

	t.Run("on HTTP 500 Internal Server Error", func(t *testing.T) {
		resp := &http.Response{StatusCode: http.StatusInternalServerError}
		result := wrapperFunc(nil, resp)
		require.Equal(t, true, result)
	})

	t.Run("on HTTP 502 Bad Gateway", func(t *testing.T) {
		resp := &http.Response{StatusCode: http.StatusBadGateway}
		result := wrapperFunc(nil, resp)
		require.Equal(t, true, result)
	})

	t.Run("on HTTP 503 Service Unavailable", func(t *testing.T) {
		resp := &http.Response{StatusCode: http.StatusServiceUnavailable}
		result := wrapperFunc(nil, resp)
		require.Equal(t, true, result)
	})

	t.Run("on HTTP 504 Gateway Timeout", func(t *testing.T) {
		resp := &http.Response{StatusCode: http.StatusGatewayTimeout}
		result := wrapperFunc(nil, resp)
		require.Equal(t, true, result)
	})

	t.Run("on non-retryable status code", func(t *testing.T) {
		resp := &http.Response{StatusCode: http.StatusBadRequest}
		result := wrapperFunc(nil, resp)
		require.Equal(t, false, result)
	})
}
